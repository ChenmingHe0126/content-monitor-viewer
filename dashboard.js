import { loadAll, saveConfig, isExtension, DEFAULT_CONFIG } from './lib/store.js';
import { analyze, videoRows, latestFollowers, median, fmtDuration, LABELS, HOUR } from './lib/insights.js';
import { buildDailyReport, buildDotReport, buildDotPrompt, followerChange, viewsChange, ageText, PLATFORM_NAMES } from './lib/report.js';
import { sendPush, pushReady, dotReady, postDot, randomTopic, CHANNELS } from './lib/push.js';
import { decryptJson, fetchGist, WrongPasswordError, cloudReady, viewerLink } from './lib/cloud.js';

let PLATFORM = 'bilibili';
let current = null;
let demoConfig = null;

const L = () => LABELS[PLATFORM];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('zh-CN'));
const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${num(Math.abs(v))}`);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (t) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const fmtDate = (sec) => new Date(sec * 1000).toLocaleDateString('zh-CN');
const fmtAgo = (t, now) => {
  const m = (now - t) / 60000;
  if (m < 1) return '刚刚';
  if (m < 60) return `${Math.round(m)} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return fmtTime(t);
};

// ---------- 封面 ----------
function cover(it) {
  const initial = esc((it.title || '?').trim().slice(0, 1));
  if (!it.cover) return `<span class="ph">${initial}</span>`;
  return `<img class="cv" src="${esc(it.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`;
}
function wireCovers(root) {
  root.querySelectorAll('img.cv').forEach((img) =>
    img.addEventListener('error', () => {
      const s = document.createElement('span');
      s.className = 'ph';
      s.textContent = img.dataset.initial;
      img.replaceWith(s);
    }, { once: true }));
}

// ---------- 提示框 ----------
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.min(x + 14, window.innerWidth - w - 8)}px`;
  tip.style.top = `${Math.max(8, y - h - 12)}px`;
}
const hideTip = () => { tip.hidden = true; };

// ---------- 折线图 ----------
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// series: [{ name, color, points: [{ x, y, label? }] }]
function lineChart(host, series, { tickFmt, tipFmt = tickFmt, yFmt = num, zero = false, emptyText, height = 230 }) {
  host.innerHTML = '';
  const drawable = series.filter((s) => s.points.length >= 2);
  if (!drawable.length) {
    host.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }
  const all = drawable.flatMap((s) => s.points);
  const W = Math.max(300, host.clientWidth || 560);
  const H = height;
  const m = { l: 46, r: 58, t: 12, b: 26 };
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = zero ? 0 : Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const ints = ys.every((v) => Number.isInteger(v));
  const step = Math.max(ints ? 1 : 0, niceStep((y1 - y0) / 4));
  y0 = zero ? 0 : Math.floor(y0 / step) * step;
  y1 = Math.ceil(y1 / step) * step;
  const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const single = drawable.length === 1;
  const gid = `g-${host.id}`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  if (single) {
    svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${drawable[0].color}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${drawable[0].color}" stop-opacity="0"/></linearGradient></defs>`;
  }
  for (let v = y0; v <= y1 + step / 2; v += step) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === y0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>`;
    svg += `<text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  [x0, (x0 + x1) / 2, x1].forEach((t, i) => {
    const anchor = ['start', 'middle', 'end'][i];
    svg += `<text x="${X(t)}" y="${H - 6}" text-anchor="${anchor}">${esc(tickFmt(t, x1 - x0))}</text>`;
  });
  for (const s of drawable) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    if (single) {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      svg += `<path d="${d}L${X(last.x).toFixed(1)},${Y(y0)}L${X(first.x).toFixed(1)},${Y(y0)}Z" fill="url(#${gid})"/>`;
    }
    const end = s.points[s.points.length - 1];
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += `<circle cx="${X(end.x)}" cy="${Y(end.y)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    svg += `<text class="dl" x="${X(end.x) + 9}" y="${Y(end.y) + 4}">${esc(yFmt(end.y))}</text>`;
  }
  svg += `<line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>`;
  svg += `<g class="hov"></g>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
  host.innerHTML = svg;

  const el = host.querySelector('svg');
  const xh = el.querySelector('.xh');
  const hov = el.querySelector('.hov');
  el.addEventListener('mousemove', (ev) => {
    const box = el.getBoundingClientRect();
    const vx = x0 + ((((ev.clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const nearest = (pts) => pts.reduce((a, b) => (Math.abs(b.x - vx) < Math.abs(a.x - vx) ? b : a));
    const anchor = nearest(all);
    xh.setAttribute('x1', X(anchor.x));
    xh.setAttribute('x2', X(anchor.x));
    xh.setAttribute('visibility', 'visible');
    const picks = drawable.map((s) => ({ s, p: nearest(s.points) }));
    hov.innerHTML = picks
      .map(({ s, p }) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`)
      .join('');
    const rows = picks.map(({ s, p }) => `<div><i style="background:${s.color}"></i>${esc(s.name)}：<b>${esc(yFmt(p.y))}</b></div>`).join('');
    showTip(`<div class="t">${esc(anchor.label || tipFmt(anchor.x))}</div>${rows}`, ev.clientX, ev.clientY);
  });
  el.addEventListener('mouseleave', () => {
    xh.setAttribute('visibility', 'hidden');
    hov.innerHTML = '';
    hideTip();
  });
}

function sparkline(points, color) {
  if (!points || points.length < 2) return '';
  const W = 200;
  const H = 30;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (v) => ((v - x0) / (x1 - x0 || 1)) * W;
  const Y = (v) => H - 2 - ((v - y0) / (y1 - y0 || 1)) * (H - 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}L${W},${H}L0,${H}Z" fill="${color}" fill-opacity="0.1"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" vector-effect="non-scaling-stroke"/></svg>`;
}

// 后台自带的每日粉丝数（有历史）+ 自己记录的快照
function followerPoints(data) {
  let pts = data.accounts
    .filter((a) => a.platform === PLATFORM && a.followers != null)
    .map((a) => ({ x: a.t, y: a.followers, label: fmtTime(a.t) }));
  const daily = (data.daily && data.daily[PLATFORM]) || {};
  const hist = Object.keys(daily).sort().map((d) => ({ x: new Date(`${d}T23:59:00`).getTime(), y: daily[d].total, label: `${d.slice(5).replace('-', '/')} 当天结束` }));
  if (hist.length) {
    const lastHist = hist[hist.length - 1].x;
    pts = hist.concat(pts.filter((p) => p.x > lastHist));
  }
  return pts;
}

// ---------- 各部分 ----------
const ICON = { good: '✓', warn: '!', info: 'i' };
const chip = (kind, html) => `<span class="chip ${kind}">${kind ? `<span class="ico">${ICON[kind]}</span>` : ''}${html}</span>`;

function renderHero(rows, now) {
  const host = $('hero');
  const n = rows[0];
  if (!n) {
    host.innerHTML = `<div class="empty" style="grid-column:1/-1">还没有${L().item}数据。点右上角“立即采集”试试。</div>`;
    return;
  }
  const it = n.item;
  const chips = [];
  if (PLATFORM === 'bilibili') {
    const d = it.diag;
    if (d) {
      chips.push(d.limited
        ? chip('warn', `<b>流量受限</b>${d.limitReason ? ` · ${esc(d.limitReason)}` : ''}`)
        : chip('good', '<b>流量正常</b> · 未限流'));
      if (d.ctrPass != null) chips.push(chip(d.ctrPass >= 0.5 ? 'good' : d.ctrPass < 0.3 ? 'warn' : '', `封标点击超过 <b>${pct(d.ctrPass, 0)}</b> 同类`));
      if (d.interactPass != null) chips.push(chip(d.interactPass >= 0.5 ? 'good' : d.interactPass < 0.3 ? 'warn' : '', `互动超过 <b>${pct(d.interactPass, 0)}</b> 同类`));
      chips.push(chip('', d.bounce != null ? `3 秒跳出 <b>${pct(d.bounce)}</b>` : '3 秒跳出率次日出数'));
    } else {
      chips.push(chip('', '登录 B 站创作中心后显示限流状态和点击率'));
    }
  } else {
    chips.push(chip('', it.sent ? `群发送达 <b>${num(it.sent)}</b> 人` : '没有群发记录'));
    if (it.sent && n.view != null) chips.push(chip('', `阅读 / 送达 <b>${pct(n.view / it.sent)}</b>`));
    if (it.noRecommend) chips.push(chip('warn', '<b>未参与平台推荐</b>'));
  }

  const chg = viewsChange(n.snaps, now, 24);
  const past = rows.slice(1).filter((r) => r.ageH >= 14 * 24 && r.view != null);
  const med = median(past.map((r) => r.view));
  const f = n.full || {};
  const metrics = [
    { l: L().view, v: num(n.view), s: chg != null ? `近 24 小时 ${signed(chg)}` : '近 24 小时：积累中' },
    { l: '互动率', v: pct(n.eng), s: L().eng },
    { l: `往期${L().view}中位数`, v: num(med), s: med ? `${past.length} 期累计，这期才发 ${ageText(n.ageH)}` : '往期数据不足' },
    PLATFORM === 'wechat'
      ? { l: '点赞 · 喜欢 · 分享', v: `${num(f.like)} · ${num(f.wow)} · ${num(f.share)}`, s: `评论 ${num(f.reply)}`, sm: true }
      : { l: '点赞 · 投币 · 收藏', v: `${num(f.like)} · ${num(f.coin)} · ${num(f.fav)}`, s: `评论 ${num(f.reply)} · 分享 ${num(f.share)}`, sm: true },
  ];

  host.innerHTML = `
    <a class="cover" href="${esc(it.url)}" target="_blank" rel="noopener">${cover(it)}</a>
    <div>
      <div class="eyebrow">最新一期 · 发布 ${ageText(n.ageH)}</div>
      <h2><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title || it.id)}</a></h2>
      <div class="meta">${new Date(it.pubdate * 1000).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}${it.duration ? ` · ${esc(fmtDuration(it.duration))}` : ''}</div>
      <div class="chips">${chips.join('')}</div>
      <div class="metrics">${metrics
        .map((x) => `<div class="metric"><div class="l">${esc(x.l)}</div><div class="v${x.sm ? ' sm' : ''}">${esc(x.v)}</div><div class="s" title="${esc(x.s)}">${esc(x.s)}</div></div>`)
        .join('')}</div>
    </div>`;
  wireCovers(host);
}

function renderKpis(data, rows, now) {
  const fc = followerChange(data, PLATFORM, now);
  const total = rows.reduce((s, r) => s + (r.view || 0), 0);
  const last30 = rows.filter((r) => r.ageH <= 30 * 24).length;
  const gapDays = rows[1] ? (rows[0].item.pubdate - rows[1].item.pubdate) / 86400 : null;
  const engMed = median(rows.map((r) => r.eng));
  const deltaHtml = fc
    ? `<span class="delta ${fc.value > 0 ? 'up' : ''}">${fc.value > 0 ? '▲ ' : fc.value < 0 ? '▼ ' : ''}${signed(fc.value)}</span> ${esc(fc.label)}`
    : '变化数据积累中';
  const tiles = [
    { l: '粉丝', v: num(latestFollowers(data, PLATFORM)), s: deltaHtml, spark: sparkline(followerPoints(data).slice(-60), cssVar('--series-1')) },
    { l: `累计${L().view}`, v: num(total), s: esc(`${rows.length} 个${L().item}`) },
    { l: '近 30 天发布', v: `${last30} 期`, s: esc(gapDays != null ? `最近两期相隔 ${Math.max(0, Math.round(gapDays))} 天` : '') },
    { l: '互动率中位数', v: pct(engMed), s: esc(L().eng) },
  ];
  $('kpis').innerHTML = tiles
    .map((t) => `<div class="card kpi"><div class="l">${esc(t.l)}</div><div class="v">${esc(t.v)}</div><div class="s">${t.s}</div>${t.spark || ''}</div>`)
    .join('');
}

function renderInsights(data, now) {
  const list = analyze(data, now, PLATFORM);
  const groups = [['warn', '需要注意'], ['good', '做得好的'], ['info', '参考信息']];
  $('insights').innerHTML = groups
    .map(([lv, name]) => {
      const items = list.filter((i) => i.level === lv);
      return `<div class="ins-col ${lv}">
        <div class="ins-head"><span class="ico">${ICON[lv]}</span>${name}<span class="count">${items.length}</span></div>
        ${items.length
          ? items.map((i) => `<div class="ins"><div class="t">${esc(i.title)}</div><div class="d">${esc(i.detail)}</div></div>`).join('')
          : '<div class="none">暂无</div>'}
      </div>`;
    })
    .join('');
}

function renderFollowers(data) {
  lineChart($('chart-followers'), [{ name: '粉丝', color: cssVar('--series-1'), points: followerPoints(data) }], {
    tickFmt: (t, span) => (span < 2 * 86400e3 ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : fmtDay(t)),
    tipFmt: fmtTime,
    emptyText: '数据积累中：每 30 分钟记录一次，过一两个小时这里就有曲线。',
  });
}

function renderCurve(rows) {
  const colors = [cssVar('--series-1'), cssVar('--series-2'), cssVar('--series-3')];
  const n = rows[0];
  const xmax = n ? Math.min(168, Math.max(48, n.ageH)) : 168;
  const toPts = (r) => r.snaps
    .filter((s) => s.view != null)
    .map((s) => ({ x: (s.t - r.item.pubdate * 1000) / HOUR, y: s.view }))
    .filter((p) => p.x >= 0 && p.x <= xmax);
  const series = rows
    .map((r) => ({ r, points: toPts(r) }))
    .filter((s) => s.points.length >= 2)
    .slice(0, 3)
    .map((s, i) => ({ name: s.r.item.title || s.r.item.id, color: colors[i], points: s.points }));
  $('legend-curve').innerHTML = series.length >= 2
    ? series.map((s) => `<span title="${esc(s.name)}"><i style="background:${s.color}"></i>${esc(s.name.length > 16 ? `${s.name.slice(0, 16)}…` : s.name)}</span>`).join('')
    : '';
  lineChart($('chart-curve'), series, {
    tickFmt: (h) => `${Math.round(h)} 小时`,
    tipFmt: (h) => `发布后 ${Math.round(h)} 小时`,
    zero: true,
    emptyText: `数据积累中：从现在起，每期${L().item}发布后的起量过程都会被记录下来，之后可以逐期对比。`,
  });
}

function renderBars(rows) {
  const host = $('chart-bars');
  const list = rows.filter((r) => r.view != null).slice(0, 12);
  if (!list.length) {
    host.innerHTML = '<div class="empty">还没有数据。</div>';
    return;
  }
  const max = Math.max(...list.map((r) => r.view), 1);
  const med = median(list.map((r) => r.view));
  host.innerHTML =
    list
      .map((r, i) => `
      <div class="bar-row${i === 0 ? ' latest' : ''}" data-i="${i}">
        <div class="thumb">${cover(r.item)}</div>
        <div class="name">${i === 0 ? '<span class="tag">最新</span>' : ''}${esc(r.item.title || r.item.id)}</div>
        <div class="track"><div class="fill" style="width:${(r.view / max) * 100}%"></div><div class="median" style="left:${(med / max) * 100}%"></div></div>
        <div class="num">${num(r.view)}</div>
      </div>`)
      .join('') + `<div class="median-note">虚线：中位数 ${num(med)}</div>`;
  host.querySelectorAll('.bar-row').forEach((el) => {
    const r = list[+el.dataset.i];
    el.addEventListener('mousemove', (ev) =>
      showTip(`<div><b>${esc(r.item.title || r.item.id)}</b></div><div class="t">${fmtDate(r.item.pubdate)}${r.item.duration ? ` · ${esc(fmtDuration(r.item.duration))}` : ''}</div><div>${L().view} ${num(r.view)} · 互动率 ${pct(r.eng)}</div>`, ev.clientX, ev.clientY));
    el.addEventListener('mouseleave', hideTip);
  });
  wireCovers(host);
}

function renderTable(rows, followers) {
  const wx = PLATFORM === 'wechat';
  const head = wx
    ? ['文章', '发布', '送达', '阅读', '阅读/送达', '点赞', '喜欢', '分享', '评论', '互动率']
    : ['视频', '发布', '时长', '播放', '播放/粉丝', '点赞', '投币', '收藏', '评论', '分享', '互动率'];
  const body = rows
    .map((r) => {
      const f = r.full || {};
      const link = `<a href="${esc(r.item.url)}" target="_blank" rel="noopener"><span class="thumb">${cover(r.item)}</span><span>${esc(r.item.title || r.item.id)}</span></a>`;
      const cells = wx
        ? [fmtDate(r.item.pubdate), num(r.item.sent || null), num(r.view),
          r.item.sent && r.view != null ? pct(r.view / r.item.sent) : '—',
          num(f.like), num(f.wow), num(f.share), num(f.reply), pct(r.eng)]
        : [fmtDate(r.item.pubdate), esc(fmtDuration(r.item.duration)), num(r.view),
          followers && r.view != null ? pct(r.view / followers) : '—',
          num((r.last || {}).like), num(f.coin), num(f.fav), num(r.last ? r.last.reply : null), num(f.share), pct(r.eng)];
      return `<tr><td class="title">${link}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    })
    .join('');
  $('table').innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
  wireCovers($('table'));
}

function renderStatus(data, now) {
  const parts = [];
  for (const p of ['bilibili', 'wechat']) {
    const st = data.status[p] || {};
    let cls = 'ok';
    let text;
    if (st.backoffUntil && now < st.backoffUntil) { cls = 'err'; text = `被平台风控，${fmtTime(st.backoffUntil)} 后再试`; }
    else if (st.errMsg) { cls = 'err'; text = /登录/.test(st.errMsg) ? `${st.errMsg}，请重新登录` : st.errMsg; }
    else if (p === 'bilibili' && st.creator && !st.creator.ok) { cls = 'err'; text = `${st.creator.msg}（公开数据正常）`; }
    else if (st.lastOk) text = `${fmtAgo(st.lastOk, now)}更新`;
    else { cls = ''; text = '还没有采集过'; }
    parts.push(`<span class="st ${cls}"><i></i>${PLATFORM_NAMES[p]} · ${esc(text)}</span>`);
  }
  if (data.__viewer) {
    $('status').innerHTML = parts.join('');
    return;
  }
  const p = data.config.push;
  const ps = data.status.push || {};
  const cs = data.status.cloud || {};
  if (cloudReady(data.config.cloud)) {
    parts.push(`<span class="st ${cs.error ? 'err' : cs.lastOk ? 'ok' : ''}"><i></i>手机查看 · ${esc(cs.error || (cs.lastOk ? `${fmtAgo(cs.lastOk, now)}上传` : '还没上传'))}</span>`);
  }
  parts.push(pushReady(p)
    ? `<span class="st ${ps.error ? 'err' : 'ok'}"><i></i>推送 · ${esc(ps.error || `每天 ${p.dailyHour}:00 发日报`)}</span>`
    : '<span class="st"><i></i>未设置手机推送</span>');
  if (dotReady(p)) {
    parts.push(`<span class="st ${ps.dotError ? 'err' : 'ok'}"><i></i>ChatGPT Dot · ${esc(ps.dotError || `每天 ${p.dailyHour}:00 发详细数据`)}</span>`);
  }
  $('status').innerHTML = parts.join('');
}

// ---------- 推送设置 ----------
const dlg = $('dlg');
const msg = (text, err = false) => {
  $('p-msg').textContent = text;
  $('p-msg').classList.toggle('err', err);
};

function fillSettings() {
  const p = current.config.push;
  $('p-channel').innerHTML = Object.entries(CHANNELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('p-channel').value = p.channel;
  $('p-ntfy').value = p.ntfyTopic || '';
  $('p-bark').value = p.barkKey || '';
  $('p-sc').value = p.sckey || '';
  $('p-hour').innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${h}:00</option>`).join('');
  $('p-hour').value = String(p.dailyHour);
  $('p-alerts').checked = !!p.alerts;
  $('p-dot').checked = !!p.dotEnabled;
  dotTopic = p.dotTopic || '';
  syncChannel();
  syncDot();
  const r = buildDailyReport(current, nowOf(current));
  $('p-preview').textContent = `${r.title}\n\n${r.body}`;
  msg('');
}

let dotTopic = '';

function syncChannel() {
  const ch = $('p-channel').value;
  if (ch === 'ntfy' && !$('p-ntfy').value) $('p-ntfy').value = randomTopic();
  document.querySelectorAll('[data-ch]').forEach((el) => { el.hidden = el.dataset.ch !== ch; });
  $('p-when').hidden = ch === 'none' && !$('p-dot').checked;
}

function syncDot() {
  const on = $('p-dot').checked;
  if (on && !dotTopic) dotTopic = randomTopic('cm-dot');
  $('p-dot-box').hidden = !on;
  $('p-when').hidden = $('p-channel').value === 'none' && !on;
  if (!on) return;
  $('p-dot-prompt').textContent = buildDotPrompt(dotTopic, Number($('p-hour').value));
  $('p-dot-preview').textContent = buildDotReport(current, nowOf(current));
}

function readSettings() {
  return {
    channel: $('p-channel').value,
    ntfyTopic: $('p-ntfy').value.trim(),
    barkKey: $('p-bark').value.trim(),
    sckey: $('p-sc').value.trim(),
    dailyHour: Number($('p-hour').value),
    alerts: $('p-alerts').checked,
    dotEnabled: $('p-dot').checked,
    dotTopic,
  };
}

$('btn-settings').addEventListener('click', () => {
  fillSettings();
  dlg.showModal();
});
$('p-channel').addEventListener('change', syncChannel);
$('p-dot').addEventListener('change', syncDot);
$('p-hour').addEventListener('change', syncDot);
$('p-dot-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('p-dot-prompt').textContent);
    msg('指令已复制，去 Dot 里粘贴');
  } catch {
    msg('复制失败，请手动选中上面的指令复制', true);
  }
});
$('p-dot-test').addEventListener('click', async () => {
  if (!isExtension) return msg('预览模式不发送，装成扩展后可用', true);
  $('p-dot-test').disabled = true;
  msg('发送中…');
  try {
    await postDot(readSettings(), buildDotReport(current, Date.now()));
    msg('已发出。可以让 Dot 现在按指令读一次试试');
  } catch (e) {
    msg(e.message, true);
  } finally {
    $('p-dot-test').disabled = false;
  }
});
$('p-save').addEventListener('click', async () => {
  const p = readSettings();
  if (p.dotEnabled && !dotReady(p)) return msg('Dot 主题名生成失败，请关掉再打开一次', true);
  if (p.channel !== 'none' && !pushReady(p)) return msg(p.channel === 'ntfy' ? '主题名只能用字母、数字、- 和 _，至少 6 位' : '请先填写上面的 key', true);
  current.config = { ...current.config, push: p };
  if (isExtension) await saveConfig(current.config);
  else demoConfig = current.config;
  msg('已保存');
  renderStatus(current, nowOf(current));
});
$('p-test').addEventListener('click', async () => {
  const p = readSettings();
  if (!pushReady(p)) return msg('请先选择推送方式并填写主题名或 key', true);
  if (!isExtension) return msg('预览模式不发送，装成扩展后可用', true);
  $('p-test').disabled = true;
  msg('发送中…');
  try {
    const r = buildDailyReport(current, Date.now());
    await sendPush(p, { title: `【测试】${r.title}`, body: r.body });
    msg('已发送，看看手机有没有收到');
  } catch (e) {
    msg(e.message, true);
  } finally {
    $('p-test').disabled = false;
  }
});

// ---------- 入口 ----------
const nowOf = (data) => data.__now || Date.now();

// ---------- 手机查看模式 ----------
// 网址 #g=<Gist id>：从 Gist 取密文，用查看密码解密。?env=<文件> 只用于本地测试
const hashParams = new URLSearchParams(location.hash.slice(1));
const queryParams = new URLSearchParams(location.search);
const PASS_KEY = 'cm-view-pass';
const GIST_KEY = 'cm-view-gist';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 无痕模式等 */ } };
// 发布在网上的手机页（不是扩展、不是本机预览）。从主屏幕图标打开时网址可能不带 #g=，用记住的那个
const PUBLISHED = !isExtension && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !queryParams.has('demo');
let gistId = hashParams.get('g');
if (gistId && !isExtension) lsSet(GIST_KEY, gistId);
else if (PUBLISHED) gistId = lsGet(GIST_KEY);
const VIEWER = !isExtension && (gistId || queryParams.get('env') || PUBLISHED)
  ? { gist: gistId, envUrl: queryParams.get('env') }
  : null;

// 还不知道数据在哪个 Gist：请用户粘贴电脑上复制的网址
function askLink() {
  return new Promise(() => {
    $('lock').hidden = false;
    $('lock-form').hidden = true;
    $('link-form').hidden = false;
    document.querySelector('main').hidden = true;
    $('banner').hidden = true;
    $('link-form').onsubmit = (ev) => {
      ev.preventDefault();
      const m = /[#&?]g=([0-9a-zA-Z]+)/.exec($('link-in').value.trim());
      if (!m) {
        $('link-msg').textContent = '没认出来。请粘贴完整网址，结尾应有 #g= 和一串字母数字';
        return;
      }
      lsSet(GIST_KEY, m[1]);
      location.hash = `g=${m[1]}`; // 触发 hashchange，页面重新加载
    };
  });
}
let cached = null;
let pendingViewer = null;
// 只改 # 后面的部分时浏览器不会重新加载页面，这里手动重载，让新的 Gist 生效
window.addEventListener('hashchange', () => location.reload());

function askPassword(env) {
  return new Promise((resolve) => {
    $('lock').hidden = false;
    $('link-form').hidden = true;
    $('lock-form').hidden = false;
    document.querySelector('main').hidden = true;
    $('lock-pw').value = '';
    $('lock-msg').textContent = '';
    $('lock-pw').focus();
    $('lock-form').onsubmit = async (ev) => {
      ev.preventDefault();
      $('lock-btn').disabled = true;
      $('lock-msg').textContent = '解密中…';
      try {
        const data = await decryptJson(env, $('lock-pw').value);
        if ($('lock-remember').checked) lsSet(PASS_KEY, $('lock-pw').value);
        $('lock').hidden = true;
        document.querySelector('main').hidden = false;
        resolve(data);
      } catch (e) {
        $('lock-msg').textContent = e instanceof WrongPasswordError ? '密码不对，再试一次' : e.message;
      } finally {
        $('lock-btn').disabled = false;
      }
    };
  });
}

async function loadViewer() {
  $('banner').hidden = false;
  $('banner').classList.remove('err');
  $('banner').textContent = '正在读取数据…';
  if (!VIEWER.gist && !VIEWER.envUrl) await askLink();
  let env;
  let updatedAt = null;
  if (VIEWER.gist) {
    try {
      ({ env, updatedAt } = await fetchGist(VIEWER.gist));
    } catch (e) {
      // 记住的网址失效了（比如电脑上重建了 Gist），让用户重新粘贴新网址
      if (!hashParams.get('g') && /找不到数据/.test(e.message)) {
        lsSet(GIST_KEY, null);
        await askLink();
      }
      throw e;
    }
  }
  else env = await fetch(VIEWER.envUrl, { cache: 'no-store' }).then((r) => r.json());
  let data = null;
  const saved = lsGet(PASS_KEY);
  if (saved) {
    try {
      data = await decryptJson(env, saved);
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      lsSet(PASS_KEY, null);
    }
  }
  if (!data) data = await askPassword(env);
  data.config = { ...DEFAULT_CONFIG, ...(data.config || {}), push: { ...DEFAULT_CONFIG.push }, cloud: { ...DEFAULT_CONFIG.cloud } };
  data.daily ||= {};
  data.status ||= {};
  data.__viewer = true;
  const up = Date.parse(data.exportedAt) || Date.parse(updatedAt);
  $('banner').textContent = `手机查看 · 电脑 ${up ? fmtAgo(up, Date.now()) : '—'}上传的数据`;
  return data;
}

async function load(force = false) {
  if (isExtension) return loadAll();
  if (cached && !force) return cached;
  if (VIEWER) {
    // 输密码时手机键盘弹出会触发 resize → render，共用同一次加载，别重复取数据、重复弹密码页
    pendingViewer ||= loadViewer().finally(() => { pendingViewer = null; });
    return (cached = await pendingViewer);
  }
  // 预览模式：?data=导出文件 显示导出的真实数据，否则显示演示数据
  const src = new URLSearchParams(location.search).get('data');
  let data;
  if (src) {
    data = await fetch(src).then((r) => r.json());
    const c = data.config || {};
    data.config = { ...DEFAULT_CONFIG, ...c, push: { ...DEFAULT_CONFIG.push, ...(c.push || {}) } };
    data.daily ||= {};
    data.__now = Date.parse(data.exportedAt) || Date.now();
    $('banner').textContent = `正在预览导出的数据文件（导出于 ${fmtTime(data.__now)}）。`;
  } else {
    const { demoData } = await import('./lib/demo.js');
    data = demoData();
    $('banner').innerHTML = '当前显示的是<strong>演示数据</strong>（编造的数字）。作为 Chrome 扩展打开时显示真实数据。';
  }
  $('banner').hidden = false;
  if (demoConfig) data.config = demoConfig;
  return (cached = data);
}

async function render(force = false) {
  let data;
  try {
    data = current = await load(force);
  } catch (e) {
    $('banner').hidden = false;
    $('banner').classList.add('err');
    $('banner').textContent = e.message;
    return;
  }
  const now = nowOf(data);
  const rows = videoRows(data, PLATFORM, now);
  $('h-curve').textContent = `发布后${L().view}曲线`;
  $('h-bars').textContent = `各期${L().view}`;
  $('h-table').textContent = `全部${L().item}`;
  renderStatus(data, now);
  renderHero(rows, now);
  renderKpis(data, rows, now);
  renderInsights(data, now);
  renderFollowers(data);
  renderCurve(rows);
  renderBars(rows);
  renderTable(rows, latestFollowers(data, PLATFORM));
}

document.querySelectorAll('.seg-btn[data-platform]').forEach((b) =>
  b.addEventListener('click', () => {
    PLATFORM = b.dataset.platform;
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));

// ---------- 手机查看设置（电脑上） ----------
const dlgCloud = $('dlg-cloud');
const cmsg = (text, err = false) => {
  $('c-msg').textContent = text;
  $('c-msg').classList.toggle('err', err);
};
function showLink() {
  const link = viewerLink(current.config.cloud, (current.status.cloud || {}).gistId);
  $('c-url-box').hidden = !link;
  $('c-copy').hidden = !link;
  $('c-url').value = link;
}
$('btn-cloud').addEventListener('click', () => {
  const c = current.config.cloud;
  $('c-on').checked = !!c.enabled;
  $('c-token').value = c.token || '';
  $('c-pass').value = c.passphrase || '';
  showLink();
  cmsg('');
  dlgCloud.showModal();
});
$('c-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('c-url').value);
    cmsg('网址已复制，发到手机上打开');
  } catch {
    cmsg('复制失败，请手动选中网址复制', true);
  }
});
$('c-save').addEventListener('click', async () => {
  const c = { ...current.config.cloud, enabled: $('c-on').checked, token: $('c-token').value.trim(), passphrase: $('c-pass').value };
  if (c.enabled && !c.token) return cmsg('请先填 GitHub token', true);
  if (c.enabled && c.passphrase.length < 8) return cmsg('查看密码至少 8 位', true);
  current.config = { ...current.config, cloud: c };
  if (!isExtension) {
    demoConfig = current.config;
    return cmsg('预览模式不上传，装成扩展后可用', true);
  }
  await saveConfig(current.config);
  if (!c.enabled) return cmsg('已关闭手机查看');
  $('c-save').disabled = true;
  cmsg('正在加密上传…');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'syncCloud' });
    if (!r || !r.ok) throw new Error((r && r.error) || '上传失败');
    if (r.cloud.error) throw new Error(r.cloud.error);
    current.status.cloud = r.cloud;
    showLink();
    cmsg('已上传。把下面的网址发到手机上打开');
  } catch (e) {
    cmsg(e.message, true);
  } finally {
    $('c-save').disabled = false;
  }
});

if (VIEWER) {
  for (const id of ['btn-cloud', 'btn-settings', 'btn-export', 'btn-collect']) $(id).hidden = true;
  $('btn-refresh').hidden = false;
  $('btn-lock').hidden = false;
}
$('btn-refresh').addEventListener('click', () => render(true));
$('btn-lock').addEventListener('click', () => {
  lsSet(PASS_KEY, null);
  render(true);
});

$('btn-collect').disabled = !isExtension;
$('btn-collect').addEventListener('click', async () => {
  const b = $('btn-collect');
  b.disabled = true;
  b.textContent = '采集中…';
  try {
    await chrome.runtime.sendMessage({ type: 'collect' });
  } finally {
    b.disabled = false;
    b.textContent = '立即采集';
    render();
  }
});

$('btn-export').addEventListener('click', () => {
  if (!current) return;
  const { __now, __viewer, ...rest } = current;
  // 导出文件不带 token 和查看密码
  const config = { ...rest.config, cloud: { ...rest.config.cloud, token: undefined, passphrase: undefined } };
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...rest, config }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `content-monitor-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

if (isExtension) chrome.storage.onChanged.addListener(() => render());
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

render();
