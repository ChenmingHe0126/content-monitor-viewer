// 推送到手机。三种方式任选一种，都只是一次 HTTPS 请求：
//   ntfy       iOS / 安卓通用，免注册；主题名相当于密码
//   Bark       仅 iPhone
//   Server酱   推送到微信（“方糖”服务号）
import { buildDailyReport, buildDotReport, findAlerts, localDate } from './report.js';

export const CHANNELS = {
  none: '不推送',
  ntfy: 'ntfy（iPhone / 安卓通用，免注册）',
  bark: 'Bark（仅 iPhone）',
  serverchan: 'Server酱（推送到微信）',
};

const TOPIC_RE = /^[-_A-Za-z0-9]{6,64}$/;

export function pushReady(p) {
  if (!p) return false;
  if (p.channel === 'ntfy') return TOPIC_RE.test(p.ntfyTopic || '');
  if (p.channel === 'bark') return !!(p.barkKey || '').trim();
  if (p.channel === 'serverchan') return !!(p.sckey || '').trim();
  return false;
}

// 给 ChatGPT Dot 的详细数据：单独一个 ntfy 主题，不推到手机，由 Dot 自己来读
export function dotReady(p) {
  return !!(p && p.dotEnabled && TOPIC_RE.test(p.dotTopic || ''));
}

export function randomTopic(prefix = 'cm') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

async function check(r) {
  const text = await r.text();
  if (!r.ok) throw new Error(`推送失败：HTTP ${r.status} ${text.slice(0, 120)}`);
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    // ntfy 等返回非 JSON 也算成功
  }
  // Bark 成功是 200，Server酱 成功是 0
  if (j && j.code != null && j.code !== 0 && j.code !== 200) {
    throw new Error(`推送失败：${j.message || j.info || j.code}`);
  }
}

// JSON 方式发布，标题和正文都可以是中文
export async function sendNtfy(topic, title, message, fetchImpl = fetch) {
  const r = await fetchImpl('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message }),
  });
  await check(r);
}

export function postDot(p, text, fetchImpl = fetch) {
  return sendNtfy(p.dotTopic, '内容数据详细版', text, fetchImpl);
}

export async function sendPush(p, { title, body }, fetchImpl = fetch) {
  let r;
  if (p.channel === 'ntfy') {
    return sendNtfy(p.ntfyTopic, title, body, fetchImpl);
  } else if (p.channel === 'bark') {
    r = await fetchImpl(`https://api.day.app/${encodeURIComponent(p.barkKey.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ title, body, group: '内容监控' }),
    });
  } else if (p.channel === 'serverchan') {
    // desp 是 Markdown，单个换行不分段，所以换成空行
    r = await fetchImpl(`https://sctapi.ftqq.com/${encodeURIComponent(p.sckey.trim())}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title, desp: body.replace(/\n/g, '\n\n') }).toString(),
    });
  } else {
    throw new Error('还没有设置推送方式');
  }
  await check(r);
}

// 每轮采集后调用：该发的日报和提醒发出去，记录在 data.status.push
export async function deliver(data, now, send = sendPush, sendDot = postDot) {
  const p = data.config.push;
  const phone = pushReady(p);
  const dot = dotReady(p);
  if (!phone && !dot) return [];
  const st = (data.status.push ||= {});
  const sent = (st.sent ||= {});
  const log = [];
  const msgs = [];
  const today = localDate(now);
  const due = new Date(now).getHours() >= p.dailyHour;
  if (phone && p.alerts) msgs.push(...findAlerts(data, now).filter((a) => !sent[a.key]));
  if (phone && due && st.lastDaily !== today) msgs.push({ daily: true, ...buildDailyReport(data, now) });
  if (dot && due && st.lastDot !== today) {
    try {
      await sendDot(p, buildDotReport(data, now));
      st.lastDot = today;
      st.dotError = null;
      log.push('已发给 Dot：详细数据');
    } catch (e) {
      st.dotError = e.message;
      log.push(`发给 Dot 失败：${e.message}`);
    }
  }
  for (const m of msgs) {
    try {
      await send(p, m);
      if (m.daily) st.lastDaily = today;
      else sent[m.key] = now;
      st.error = null;
      log.push(`已推送：${m.title}`);
    } catch (e) {
      st.error = e.message;
      log.push(e.message);
    }
  }
  // 登录提醒按天去重，旧记录清掉；限流提醒每个稿件只推一次，保留
  for (const k of Object.keys(sent)) if (k.startsWith('login:') && now - sent[k] > 7 * 24 * 3600e3) delete sent[k];
  return log;
}
