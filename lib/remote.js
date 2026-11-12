// 手机遥控更新：手机查看页点“更新”，往一个随机生成的 ntfy 主题发一条 collect；
// 电脑上的扩展每分钟查一次这个主题，收到就马上采集全部平台并加密上传，手机页看到新数据后自动刷新。
// 主题名只放在加密上传的数据里，只有输对查看密码的手机才拿得到。消息内容只有 “collect”，不含任何数据。
import { randomTopic } from './push.js';

export const REMOTE_MIN_GAP_MS = 3 * 60e3; // 两次遥控采集至少隔 3 分钟，连点只算一次
export const REMOTE_COMMAND = 'collect';

// 没有遥控主题就生成一个；返回是否新生成（需要保存配置）
export function ensureRemoteTopic(config) {
  if (config.remote && /^[-_A-Za-z0-9]{6,64}$/.test(config.remote.topic || '')) return false;
  config.remote = { ...(config.remote || {}), topic: randomTopic('cm-cmd') };
  return true;
}

// 查一次有没有手机发来的更新指令。返回 true 表示应该马上采集
export async function pollRemote(data, { now = Date.now(), fetchImpl = fetch } = {}) {
  const topic = data.config.remote && data.config.remote.topic;
  if (!topic) return false;
  const st = (data.status.remote ||= {});
  // 第一次只看最近 2 分钟，避免把很久以前的指令当成新的
  const since = st.lastId || '2m';
  const r = await fetchImpl(`https://ntfy.sh/${topic}/json?poll=1&since=${encodeURIComponent(since)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`读取手机指令失败：HTTP ${r.status}`);
  const text = await r.text();
  const msgs = text
    .split('\n')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.event === 'message');
  if (!msgs.length) return false;
  st.lastId = msgs[msgs.length - 1].id;
  const commands = msgs.filter((m) => String(m.message || '').trim() === REMOTE_COMMAND);
  if (!commands.length) return false;
  st.lastCmdAt = commands[commands.length - 1].time ? commands[commands.length - 1].time * 1000 : now;
  if (st.lastRunAt && now - st.lastRunAt < REMOTE_MIN_GAP_MS) return false;
  return true;
}

// 决定这一分钟要不要为手机采集，并记下来（会改 st）。
// pendingAt：手机的请求还没完成；完整采集一轮后由后台清掉。没完成的最多补跑 2 次、30 分钟内有效
export const REMOTE_MAX_ATTEMPTS = 2;
export function nextRemoteRun(st, gotCommand, now = Date.now()) {
  if (gotCommand) {
    st.pendingAt = now;
    st.attempts = 0;
  } else if (!st.pendingAt) {
    return false;
  } else if ((st.attempts || 0) >= REMOTE_MAX_ATTEMPTS || now - st.pendingAt > 30 * 60e3) {
    st.error = '手机遥控的采集没能跑完，请再点一次“更新”';
    delete st.pendingAt;
    delete st.attempts;
    return false;
  }
  st.attempts = (st.attempts || 0) + 1;
  st.lastRunAt = now;
  if (gotCommand) delete st.error;
  return true;
}

// 手机端的遥控主题来自上传的数据。当前主题还没上传过（刚生成、或者上次是旧版本上传的）就要补传，
// 否则手机点“更新”找不到主题。上传失败后 10 分钟内不重试，免得每分钟都打 GitHub
export function needsTopicUpload(data, now = Date.now()) {
  const topic = data.config.remote && data.config.remote.topic;
  const cs = data.status.cloud || {};
  if (!topic || cs.topic === topic) return false;
  return !(cs.lastErr && cs.lastErr > (cs.lastOk || 0) && now - cs.lastErr < 10 * 60e3);
}

// 手机页用：发一条更新指令（纯文本 POST，不触发跨域预检）
export async function sendRemoteCommand(topic, fetchImpl = fetch) {
  const r = await fetchImpl(`https://ntfy.sh/${topic}`, { method: 'POST', body: REMOTE_COMMAND });
  if (!r.ok) throw new Error(`发送更新指令失败：HTTP ${r.status}`);
}
