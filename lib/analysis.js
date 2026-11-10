// 长期分析：用创作中心的深层指标和发布后播放曲线，看时长影响、长期进步还是退步、新粉丝从哪来。
// 纯函数；每条结论都带依据，样本不够时直接说不够。
import { median, playsAtAge, HOUR } from './insights.js';

const DAY = 24 * HOUR;
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const fmt = (v) => (v == null ? '—' : Math.round(v).toLocaleString('zh-CN'));
const short = (s, n = 16) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

// 每期 B 站视频一行，按发布时间从旧到新
export function videoFacts(data, now) {
  return Object.values(data.items)
    .filter((it) => it.platform === 'bilibili' && it.pubdate && it.pubdate * 1000 <= now)
    .map((it) => {
      const ageH = (now - it.pubdate * 1000) / HOUR;
      const snaps = data.snaps[`bilibili:${it.id}`] || [];
      const last = [...snaps].reverse().find((s) => s.view != null);
      const d = it.deep || {};
      return {
        id: it.id,
        title: it.title || it.id,
        pub: it.pubdate,
        dur: it.duration || null,
        ageH,
        view: last ? last.view : null,
        h24: ageH >= 24 ? playsAtAge(it, 24) : null,
        d7: ageH >= 7 * 24 ? playsAtAge(it, 7 * 24) : null,
        d30: ageH >= 30 * 24 ? playsAtAge(it, 30 * 24) : null,
        ctr: d.ctr ?? null,
        ctrPass: d.ctrPass ?? null,
        bounce: d.bounce ?? null,
        interact: d.interact ?? null,
        guestShare: d.guestShare ?? null,
        follows: d.follows ?? null,
        fullPlay: d.fullPlay ?? null,
      };
    })
    .sort((a, b) => a.pub - b.pub);
}

// 斯皮尔曼等级相关系数：只看排序，不怕个别爆款把结果带偏
export function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const rank = (v) => {
    const order = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs);
  const b = rank(ys);
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - mean) * (b[i] - mean);
    da += (a[i] - mean) ** 2;
    db += (b[i] - mean) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export const DURATION_BUCKETS = [
  { label: '10 分钟以内', lo: 0, hi: 600 },
  { label: '10–40 分钟', lo: 600, hi: 2400 },
  { label: '40 分钟以上', lo: 2400, hi: Infinity },
];

export function durationTable(rows) {
  return DURATION_BUCKETS.map((b) => {
    const g = rows.filter((r) => r.d7 != null && r.dur != null && r.dur >= b.lo && r.dur < b.hi).map((r) => r.d7);
    return { ...b, n: g.length, median: median(g), min: g.length ? Math.min(...g) : null, max: g.length ? Math.max(...g) : null };
  });
}

const describeRho = (r) => (r == null ? '无法计算' : Math.abs(r) < 0.2 ? '几乎无关' : Math.abs(r) < 0.4 ? (r > 0 ? '弱正相关' : '弱负相关') : r > 0 ? '正相关' : '负相关');

// 最近 recentN 期和之前相比；higherIsBetter 决定涨了算进步还是退步
function compareRecent(rows, field, recentN, higherIsBetter) {
  const has = rows.filter((r) => r[field] != null);
  if (has.length < recentN + 3) return null;
  const recent = has.slice(-recentN);
  const before = has.slice(0, -recentN);
  const a = median(recent.map((r) => r[field]));
  const b = median(before.map((r) => r[field]));
  if (a == null || b == null || b === 0) return null;
  const ratio = a / b;
  const better = higherIsBetter ? ratio > 1.15 : ratio < 0.87;
  const worse = higherIsBetter ? ratio < 0.87 : ratio > 1.15;
  return { recent: a, before: b, ratio, better, worse, n: recent.length, m: before.length };
}

// 返回 [{ level, title, detail }]
export function longTermFindings(data, now) {
  const rows = videoFacts(data, now);
  const done = rows.filter((r) => r.d7 != null);
  if (done.length < 6) {
    return [{ level: 'info', title: '长期分析的数据还在积累', detail: `需要至少 6 期有“发布后 7 天播放”数据的视频，现在有 ${done.length} 期。扩展每轮会补取几期，几个小时后再看。` }];
  }
  const out = [];
  const RECENT = 5;

  // 1. 时长
  const durRows = done.filter((r) => r.dur != null);
  const rho = spearman(durRows.map((r) => r.dur), durRows.map((r) => r.d7));
  const tbl = durationTable(done).filter((b) => b.n > 0);
  const fullRows = durRows.filter((r) => r.fullPlay != null);
  const rhoFull = spearman(fullRows.map((r) => r.dur), fullRows.map((r) => r.fullPlay));
  out.push({
    level: rho != null && rho < -0.4 ? 'warn' : 'info',
    title: rho != null && rho < -0.2
      ? `时长越长，前 7 天播放越少（${describeRho(rho)}，系数 ${rho.toFixed(2)}）`
      : `时长和前 7 天播放${describeRho(rho)}（系数 ${rho == null ? '—' : rho.toFixed(2)}），长视频没有被明显压低`,
    detail: `${tbl.map((b) => `${b.label} ${b.n} 期，前 7 天播放中位数 ${fmt(b.median)}`).join('；')}。`
      + (rhoFull != null && rhoFull < -0.3 ? `不过越长的视频完播指标越低（系数 ${rhoFull.toFixed(2)}），能看完的人少。` : '')
      + '这是你自己历史视频的统计，不同题材混在一起，只能说明“时长不是决定因素”，不能证明某个时长最好。',
  });

  // 2. 前 7 天播放：进步还是退步
  const d7 = compareRecent(done, 'd7', RECENT, true);
  if (d7) {
    out.push({
      level: d7.better ? 'good' : d7.worse ? 'warn' : 'info',
      title: `最近 ${d7.n} 期前 7 天播放中位数 ${fmt(d7.recent)}，之前 ${d7.m} 期是 ${fmt(d7.before)}（${d7.better ? '在进步' : d7.worse ? '在下滑' : '基本持平'}）`,
      detail: '用“发布后同样 7 天”比较，不受发布早晚影响。爆款会让平均数失真，所以用中位数。',
    });
  }

  // 3. 封面标题吸引力（同类排名）
  const ctr = compareRecent(rows, 'ctrPass', RECENT, true);
  if (ctr) {
    out.push({
      level: ctr.better ? 'good' : ctr.worse ? 'warn' : 'info',
      title: `封标点击率的同类排名：最近 ${ctr.n} 期中位数超过 ${pct(ctr.recent)} 同类，之前是 ${pct(ctr.before)}（${ctr.better ? '在进步' : ctr.worse ? '在下滑' : '基本持平'}）`,
      detail: '这是 B 站创作中心算的“封面和标题的点击率超过了多少同类稿件”，反映封面标题有没有吸引力。',
    });
  }

  // 4. 开头留人能力
  const bounce = compareRecent(rows, 'bounce', RECENT, false);
  if (bounce) {
    out.push({
      level: bounce.better ? 'good' : bounce.worse ? 'warn' : 'info',
      title: `3 秒跳出率：最近 ${bounce.n} 期中位数 ${pct(bounce.recent, 1)}，之前 ${pct(bounce.before, 1)}（${bounce.better ? '开头更留得住人了' : bounce.worse ? '开头更留不住人了' : '基本持平'}）`,
      detail: '点进来 3 秒内就走的比例，越低越好。偏离你常做题材的视频通常更高。',
    });
  }

  // 5. 新粉丝从哪来
  const fol = rows.filter((r) => r.follows != null);
  const total = fol.reduce((s, r) => s + r.follows, 0);
  if (total > 0) {
    const top = [...fol].sort((a, b) => b.follows - a.follows).slice(0, 3);
    const topSum = top.reduce((s, r) => s + r.follows, 0);
    out.push({
      level: 'info',
      title: `${top.length} 期视频带来了 ${pct(topSum / total)} 的新粉丝（共 ${fmt(total)} 个）`,
      detail: `${top.map((r) => `《${short(r.title)}》${fmt(r.follows)}`).join('、')}。涨粉几乎全靠少数“入口型”视频，其余每期只带来个位数到几十个。`,
    });
  }

  // 6. 爆款
  const med7 = median(done.map((r) => r.d7));
  const hits = done.filter((r) => r.d7 >= 3 * med7);
  if (hits.length) {
    out.push({
      level: 'info',
      title: `前 7 天播放超过中位数 3 倍的有 ${hits.length} 期`,
      detail: `${hits.map((r) => `《${short(r.title, 20)}》${fmt(r.d7)}`).join('、')}（中位数 ${fmt(med7)}）。可以对照它们的题材、标题和发布节奏找共同点。`,
    });
  }

  // 7. 发布节奏
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push((rows[i].pub - rows[i - 1].pub) / 86400);
  const recentGaps = gaps.slice(-RECENT);
  const longGaps = rows.slice(1).filter((r, i) => gaps[i] > 60 && now - r.pub * 1000 < 2 * 365 * DAY).length;
  if (recentGaps.length) {
    out.push({
      level: median(recentGaps) > 30 ? 'warn' : 'info',
      title: `最近 ${recentGaps.length} 次发布间隔中位数 ${Math.round(median(recentGaps))} 天；两年内有 ${longGaps} 次断更超过 60 天`,
      detail: '更新间隔越长，老粉丝越容易流失，账号也越难积累稳定的推荐。这是常见经验，具体影响多大要靠后面几期验证。',
    });
  }
  return out;
}
