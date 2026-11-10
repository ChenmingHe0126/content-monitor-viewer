// 日报与提醒：把已采集的数据整理成一条适合在手机通知里读的短文本。纯函数，便于测试。
import { analyze, videoRows, latestFollowers, median, LABELS, HOUR } from './insights.js';
import { longTermFindings } from './analysis.js';

export const PLATFORM_NAMES = { bilibili: 'B站', wechat: '公众号', douyin: '抖音', xiaohongshu: '小红书', youtube: 'YouTube', instagram: 'Instagram' };
const ORDER = ['bilibili', 'wechat', 'douyin', 'xiaohongshu', 'youtube', 'instagram'];

const fmt = (v) => (v == null ? '—' : Math.round(v).toLocaleString('zh-CN'));
const sgn = (v) => (v >= 0 ? `+${fmt(v)}` : `−${fmt(-v)}`);
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const short = (s, n = 18) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
export const ageText = (h) => (h < 48 ? `${Math.max(1, Math.round(h))} 小时` : `${Math.round(h / 24)} 天`);

// 本机时区的日期 YYYY-MM-DD
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 大约 hours 小时前的值：取 0.8～2 倍时间窗内离目标最近的点；没有就返回 null
export function valueAgo(points, now, hours, field) {
  let best = null;
  let bestGap = Infinity;
  for (const p of points || []) {
    if (p[field] == null) continue;
    const age = (now - p.t) / HOUR;
    if (age < hours * 0.8 || age > hours * 2) continue;
    const gap = Math.abs(age - hours);
    if (gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best ? best[field] : null;
}

export function viewsChange(snaps, now, hours = 24) {
  const last = [...(snaps || [])].reverse().find((s) => s.view != null);
  const before = valueAgo(snaps, now, hours, 'view');
  return last && before != null ? last.view - before : null;
}

// 粉丝变化：优先用自己记录的 24 小时差；没有就用后台的“每日粉丝”最后一天
export function followerChange(data, platform, now) {
  const acc = data.accounts.filter((a) => a.platform === platform && a.followers != null);
  const last = acc[acc.length - 1];
  const before = valueAgo(acc, now, 24, 'followers');
  if (last && before != null) return { label: '近 24 小时', value: last.followers - before };
  const daily = (data.daily && data.daily[platform]) || {};
  const days = Object.keys(daily).sort();
  if (days.length) {
    const day = days[days.length - 1];
    return { label: `${Number(day.slice(5, 7))}/${Number(day.slice(8))} 当天`, value: daily[day].net };
  }
  return null;
}

export function platformsWithData(data) {
  return ORDER.filter(
    (p) => data.accounts.some((a) => a.platform === p) || Object.values(data.items).some((i) => i.platform === p),
  );
}

function loginProblem(data, p) {
  const st = data.status[p] || {};
  if (st.errMsg && /登录/.test(st.errMsg)) return st.errMsg;
  if (st.creator && !st.creator.ok && /登录/.test(st.creator.msg || '')) return st.creator.msg;
  return null;
}

export function buildDailyReport(data, now) {
  const lines = [];
  for (const p of platformsWithData(data)) {
    const L = LABELS[p];
    const fc = followerChange(data, p, now);
    lines.push(`【${PLATFORM_NAMES[p]}】粉丝 ${fmt(latestFollowers(data, p))}${fc ? `（${fc.label} ${sgn(fc.value)}）` : ''}`);
    const login = loginProblem(data, p);
    if (login) lines.push(`⚠️ ${login}，请在电脑的 Chrome 里重新登录`);

    const rows = videoRows(data, p, now).filter((r) => r.view != null);
    const n = rows[0];
    if (n) {
      const ch = viewsChange(n.snaps, now, 24);
      lines.push(
        `最新《${short(n.item.title)}》发布 ${ageText(n.ageH)}：${L.view} ${fmt(n.view)}` +
          `${ch != null ? `（24 小时 ${sgn(ch)}）` : ''}${n.eng != null ? `，互动率 ${pct(n.eng)}` : ''}`,
      );
      const d = n.item.diag;
      if (p === 'bilibili' && d) {
        const parts = [d.limited ? '⚠️ 流量受限' : '流量正常'];
        if (d.ctrPass != null) parts.push(`封标点击超过 ${pct(d.ctrPass, 0)} 同类`);
        if (d.interactPass != null) parts.push(`互动超过 ${pct(d.interactPass, 0)} 同类`);
        lines.push(parts.join(' · '));
      }
      const mover = rows
        .slice(1)
        .map((r) => ({ r, ch: viewsChange(r.snaps, now, 24) }))
        .filter((x) => x.ch > 0)
        .sort((a, b) => b.ch - a.ch)[0];
      if (mover) lines.push(`旧作涨得最多：《${short(mover.r.item.title)}》${sgn(mover.ch)}`);
    }
    for (const w of analyze(data, now, p).filter((i) => i.level === 'warn').slice(0, 2)) lines.push(`⚠️ ${w.title}`);
    lines.push('');
  }
  const d = new Date(now);
  return {
    title: `内容日报 ${d.getMonth() + 1}/${d.getDate()}`,
    body: lines.join('\n').trim() || '还没有采集到数据。',
  };
}

// 需要立刻提醒的事；key 用于去重，同一个 key 只推一次
export function findAlerts(data, now) {
  const out = [];
  for (const it of Object.values(data.items)) {
    if (it.platform === 'bilibili' && it.diag && it.diag.limited) {
      out.push({
        key: `limit:${it.id}`,
        title: 'B站稿件流量受限',
        body: `《${short(it.title, 30)}》被创作中心标记为流量受限${it.diag.limitReason ? `：${it.diag.limitReason}` : ''}。到创作中心「稿件分析」查看原因。`,
      });
    }
  }
  const day = localDate(now);
  for (const p of ORDER) {
    const msg = loginProblem(data, p);
    if (msg) {
      out.push({
        key: `login:${p}:${day}`,
        title: `${PLATFORM_NAMES[p]}需要重新登录`,
        body: `${msg}。在电脑的 Chrome 里重新登录后，会自动恢复采集。`,
      });
    }
  }
  return out;
}

// ---------- 给 ChatGPT Dot 的详细数据 ----------
// ntfy.sh 单条消息上限 4096 字节，超过会变成附件（附件过几小时就失效），所以控制在这个以内
export const DOT_MAX_BYTES = 3800;
const byteLen = (s) => new TextEncoder().encode(s).length;
// 今年的只写月/日，往年的带上年份
const md = (sec, now) => {
  const d = new Date(sec * 1000);
  const y = d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}/` : '';
  return `${y}${d.getMonth() + 1}/${d.getDate()}`;
};
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时区';
  } catch {
    return '本机时区';
  }
};

function itemLine(p, r, now) {
  const f = r.full || {};
  const ch = viewsChange(r.snaps, now, 24);
  const parts = [`${md(r.item.pubdate, now)}《${short(r.item.title, 24)}》`];
  if (r.item.duration) parts.push(`${Math.round(r.item.duration / 60)}分钟`);
  parts.push(`${LABELS[p].view}${fmt(r.view)}${ch ? `(24h${sgn(ch)})` : ''}`);
  if (p === 'wechat') {
    if (r.item.sent) parts.push(`送达${fmt(r.item.sent)}`);
    if (r.full) parts.push(`赞${fmt(f.like)} 喜欢${fmt(f.wow)} 分享${fmt(f.share)} 评${fmt(f.reply)}`);
  } else if (p === 'youtube' || p === 'instagram') {
    if (r.full) parts.push(`赞${fmt(f.like)} 评${fmt(f.reply)}`);
  } else if (p === 'xiaohongshu' || p === 'douyin') {
    if (r.full) parts.push(`赞${fmt(f.like)} 藏${fmt(f.fav)} 评${fmt(f.reply)} 分享${fmt(f.share)}`);
    const d = r.item.deep;
    if (d && d.impressions != null) parts.push(`曝光${fmt(d.impressions)} 封面点击率${d.ctr != null ? pct(d.ctr) : '—'}`);
  } else if (r.full) {
    parts.push(`赞${fmt(f.like)} 币${fmt(f.coin)} 藏${fmt(f.fav)} 评${fmt(f.reply)} 分享${fmt(f.share)}`);
  }
  if (r.eng != null) parts.push(`互动率${pct(r.eng)}`);
  return parts.join(' ');
}

function diagLine(d) {
  const rate = (v, pass) => `${v != null ? pct(v) : '未出数'}${pass != null ? `(超过${pct(pass, 0)}同类)` : ''}`;
  return [
    d.limited ? `流量受限${d.limitReason ? `:${d.limitReason}` : ''}` : '流量正常未限流',
    `封标点击率${rate(d.ctr, d.ctrPass)}`,
    `互动率${rate(d.interact, d.interactPass)}`,
    `3秒跳出率${rate(d.bounce, d.bouncePass)}`,
    `游客占比${d.guestShare != null ? pct(d.guestShare) : '未出数'}`,
  ].join('；');
}

export function buildDotReport(data, now, maxBytes = DOT_MAX_BYTES) {
  const t = new Date(now);
  const head = [
    `内容数据详细版 ${localDate(now)} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}（${localTimeZone()}）`,
    '口径：B站互动率=(赞+币+藏)/播放；公众号互动率=(赞+喜欢+分享)/阅读；24h=近24小时增量；“超过X%同类”来自B站创作中心。',
  ];
  const sections = [];
  for (const p of platformsWithData(data)) {
    const L = LABELS[p];
    const top = [];
    const fc = followerChange(data, p, now);
    top.push(`[${PLATFORM_NAMES[p]}] 粉丝${fmt(latestFollowers(data, p))}${fc ? `（${fc.label}${sgn(fc.value)}）` : ''}`);
    const login = loginProblem(data, p);
    if (login) top.push(`采集问题：${login}`);
    const rows = videoRows(data, p, now).filter((r) => r.view != null);
    const others = [];
    if (rows[0]) {
      top.push(`最新一期（发布${ageText(rows[0].ageH)}）：${itemLine(p, rows[0], now)}`);
      if (p === 'bilibili' && rows[0].item.diag) top.push(`官方诊断：${diagLine(rows[0].item.diag)}`);
      const past = rows.slice(1).filter((r) => r.ageH >= 14 * 24);
      if (past.length) {
        top.push(`往期（发布满14天的${past.length}期）${L.view}中位数${fmt(median(past.map((r) => r.view)))}，互动率中位数${(() => {
          const m = median(past.map((r) => r.eng));
          return m != null ? pct(m) : '—';
        })()}`);
      }
      for (const r of rows.slice(1, 9)) others.push(`- ${itemLine(p, r, now)}`);
    }
    const tips = analyze(data, now, p)
      .filter((i) => i.level !== 'info')
      .slice(0, 4)
      .map((i) => `- ${i.level === 'warn' ? '注意' : '亮点'}：${i.title}`);
    // 长期分析（B 站）：时长影响、进步还是退步、新粉丝来源
    if (p === 'bilibili') {
      const lt = longTermFindings(data, now);
      if (lt.length > 1) tips.push('长期分析：', ...lt.slice(0, 5).map((i) => `- ${i.title}`));
    }
    sections.push({ top, others, tips });
  }

  const render = () => [
    ...head,
    ...sections.flatMap((s) => [
      '',
      ...s.top,
      ...(s.others.length ? ['之前几期：', ...s.others] : []),
      ...(s.tips.length ? ['规则提示：', ...s.tips] : []),
    ]),
  ].join('\n');

  // 超长时先砍“之前几期”里最旧的，砍完还超就截断
  let text = render();
  while (byteLen(text) > maxBytes) {
    const s = sections.reduce((a, b) => (b.others.length > a.others.length ? b : a), sections[0] || { others: [] });
    if (!s || !s.others.length) break;
    s.others.pop();
    text = render();
  }
  while (byteLen(text) > maxBytes) text = text.slice(0, -20);
  return text;
}

// 粘贴给 Dot 的每日任务指令
export function buildDotPrompt(topic, dailyHour, tz = localTimeZone()) {
  const readHour = (dailyHour + 1) % 24;
  return `每天 ${readHour}:00（时区 ${tz}）执行一次：

1. 打开这个网址：https://ntfy.sh/${topic}/json?poll=1&since=24h
   返回内容每一行是一条 JSON，取最后一行的 message 字段。那是我 B 站和微信公众号的数据详细版，由我电脑上的扩展每天 ${dailyHour}:00 左右发出。
2. 读完后用中文给我发一条消息：
   - 第一句说今天最重要的变化（粉丝增减、最新一期表现）。
   - 判断最新一期好不好，问题更可能出在哪一环：平台给的曝光、封面标题的点击、内容留存、还是互动。只根据数据里有的数说话，数据不够就直接说不够，不要编。
   - 给 1～2 条下一期能直接试的具体做法。
   - 不超过 200 字，不要客套话。
3. 如果网址没有返回内容，或者最后一条不是今天的，就只发一句：“今天没收到数据，电脑可能没开，或 Chrome 没在后台运行。”

这个网址相当于密码，不要发给别人，也不要贴到公开的地方。`;
}
