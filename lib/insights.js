// 复盘分析：纯函数，只依赖已采集的数据。
// 每条提示都带依据；数据不够下结论时直接说不够，不硬凑。

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export function median(arr) {
  const s = arr.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 发布后 hours 小时内的播放，来自创作中心的发布后播放曲线（item.early）。
// 48 小时内用逐小时数据，之后用逐日数据（按自然日，第 1 天是发布当天剩下的时间）；数据不够时返回 null
export function playsAtAge(item, hours) {
  const e = item && item.early;
  if (!e || !(hours > 0)) return null;
  const sum = (arr, n) => (arr && arr.length >= n ? arr.slice(0, n).reduce((a, b) => a + b, 0) : null);
  const h = Math.max(1, Math.round(hours));
  if (h <= 48 && e.hours && e.hours.length >= h) return sum(e.hours, h);
  return sum(e.days, Math.max(1, Math.ceil(hours / 24)));
}

export const lastSnap = (snaps) => (snaps && snaps.length ? snaps[snaps.length - 1] : null);

// 最近一条带点赞/投币/收藏的完整快照
export function lastFull(snaps) {
  for (let i = (snaps || []).length - 1; i >= 0; i--) if (snaps[i].full || snaps[i].coin != null) return snaps[i];
  return null;
}

// 互动率：B 站 =（点赞 + 投币 + 收藏）/ 播放；公众号 =（点赞 + 喜欢 + 分享）/ 阅读
export function engagement(s, platform = 'bilibili') {
  if (!s || !s.view || s.like == null) return null;
  let extra;
  if (platform === 'wechat') extra = (s.wow || 0) + (s.share || 0);
  else if (platform === 'xiaohongshu' || platform === 'douyin') extra = (s.fav || 0) + (s.reply || 0) + (s.share || 0);
  else if (platform === 'youtube' || platform === 'instagram') extra = s.reply || 0;
  else extra = (s.coin || 0) + (s.fav || 0);
  return (s.like + extra) / s.view;
}

export const LABELS = {
  bilibili: { view: '播放', item: '视频', eng: '（点赞 + 投币 + 收藏）/ 播放' },
  wechat: { view: '阅读', item: '文章', eng: '（点赞 + 喜欢 + 分享）/ 阅读' },
  douyin: { view: '播放', item: '作品', eng: '（点赞 + 收藏 + 评论 + 分享）/ 播放' },
  xiaohongshu: { view: '观看', item: '笔记', eng: '（点赞 + 收藏 + 评论 + 分享）/ 观看' },
  youtube: { view: '观看', item: '视频', eng: '（点赞 + 评论）/ 观看' },
  instagram: { view: '播放', item: '帖子', eng: '（点赞 + 评论）/ 播放' },
};

// 作品发布后第 hours 小时的数值（线性插值）；该时间点两侧没有快照就返回 null
export function valueAtAge(item, snaps, hours, field = 'view') {
  if (!item || !item.pubdate) return null;
  let lo = null;
  let hi = null;
  for (const s of snaps || []) {
    if (s[field] == null) continue;
    const h = (s.t - item.pubdate * 1000) / HOUR;
    if (h <= hours) lo = { h, v: s[field] };
    else {
      hi = { h, v: s[field] };
      break;
    }
  }
  if (lo && lo.h === hours) return lo.v;
  if (!lo || !hi) return null;
  return lo.v + ((hi.v - lo.v) * (hours - lo.h)) / (hi.h - lo.h);
}

export function fmtAge(hours) {
  if (hours < 48) return `${Math.max(1, Math.round(hours))} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

export function fmtDuration(sec) {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} 分钟` : `${sec} 秒`;
}

const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

// 某平台的作品列表，按发布时间从新到旧
export function videoRows(data, platform, now) {
  return Object.keys(data.items)
    .filter((k) => data.items[k].platform === platform)
    .map((key) => {
      const item = data.items[key];
      const snaps = data.snaps[key] || [];
      const last = lastSnap(snaps);
      const full = lastFull(snaps);
      return {
        key, item, snaps, last, full,
        view: last ? last.view : null,
        eng: engagement(full, platform),
        ageH: item.pubdate ? (now - item.pubdate * 1000) / HOUR : null,
      };
    })
    .filter((r) => r.item.pubdate && r.item.pubdate * 1000 <= now) // 定时发布、还没到时间的不算
    .sort((a, b) => b.item.pubdate - a.item.pubdate);
}

export function latestFollowers(data, platform) {
  const a = data.accounts.filter((x) => x.platform === platform);
  return a.length ? a[a.length - 1].followers : null;
}

// 返回 [{ level: 'warn' | 'good' | 'info', title, detail }]
export function analyze(data, now, platform = 'bilibili') {
  const out = [];
  const rows = videoRows(data, platform, now).filter((r) => r.view != null);
  if (!rows.length) {
    return [{ level: 'info', title: '还没有数据', detail: '采集到第一批数据后，这里会出现复盘提示。' }];
  }
  const n = rows[0];
  const others = rows.slice(1);
  const mature = others.filter((r) => r.ageH >= 14 * 24);
  const followers = latestFollowers(data, platform);
  const name = `《${n.item.title || n.item.id}》`;
  const L = LABELS[platform] || LABELS.bilibili;

  // 1. 曝光：和往期比
  let lowReach = false;
  const sameAge = others
    .map((r) => (r.ageH > n.ageH ? playsAtAge(r.item, n.ageH) ?? valueAtAge(r.item, r.snaps, n.ageH) : null))
    .filter((v) => v != null);
  if (sameAge.length >= 3) {
    const base = median(sameAge);
    const ratio = base ? n.view / base : null;
    if (ratio != null) {
      lowReach = ratio < 0.5;
      out.push({
        level: ratio < 0.5 ? 'warn' : ratio > 1.2 ? 'good' : 'info',
        title: `${name}发布 ${fmtAge(n.ageH)}，${L.view} ${n.view}，是往期同一时间点中位数的 ${pct(ratio)}`,
        detail: `对比对象：${sameAge.length} 期往期${L.item}在发布后 ${fmtAge(n.ageH)} 时的${L.view}，中位数 ${Math.round(base)}。这是同时间点的公平比较。`,
      });
    }
  } else if (mature.length >= 3) {
    const base = median(mature.map((r) => r.view));
    const ratio = base ? n.view / base : null;
    if (ratio != null) {
      lowReach = n.ageH > 72 && ratio < 0.3;
      out.push({
        level: lowReach ? 'warn' : 'info',
        title: `${name}发布 ${fmtAge(n.ageH)}，${L.view} ${n.view}；往期${L.item}累计${L.view}的中位数是 ${Math.round(base)}`,
        detail: `往期数字是长期累计的结果，新${L.item}还在涨，这个比较偏悲观。监控积累出往期“发布后同一时间”的曲线后，会自动换成公平比较。`,
      });
    }
  } else {
    out.push({
      level: 'info',
      title: `${name}发布 ${fmtAge(n.ageH)}，${L.view} ${n.view}`,
      detail: `往期${L.item}的数据还不够（少于 3 期），暂时没法判断这个数字算高还是低。`,
    });
  }

  if (followers && n.view < followers) {
    out.push({
      level: 'info',
      title: `${L.view}相当于粉丝数的 ${pct(n.view / followers, 1)}（${n.view} / ${followers}）`,
      detail: `这个比例只说明量级：${L.view}远小于粉丝数时，说明连已有粉丝也大多没看到或没点开。`,
    });
  }

  // 2. 互动率：看到的人反应如何
  if (n.eng != null) {
    const base = median(mature.map((r) => r.eng));
    const small = n.view < 300 ? `样本只有 ${n.view} 次${L.view}，波动会很大。` : '';
    if (base != null) {
      const holds = n.eng >= base * 0.8;
      out.push({
        level: holds ? 'good' : 'warn',
        title: `互动率 ${pct(n.eng, 1)}，往期中位数 ${pct(base, 1)}`,
        detail:
          `互动率 = ${L.eng}。${small}` +
          (holds && lowReach
            ? `${L.view}少但互动率没掉，说明看到的人反应不差——短板更可能在曝光或点击，而不是内容本身。这是推测。`
            : holds
              ? (n.eng >= base * 1.2 ? '看到的人反应比往期更好。' : '看到的人反应和往期差不多。')
              : '互动率低于往期，内容或受众匹配可能有问题。'),
      });
    } else {
      out.push({
        level: 'info',
        title: `互动率 ${pct(n.eng, 1)}`,
        detail: `互动率 = ${L.eng}。${small}往期${L.item}的完整数据还没采齐，暂时没有基准可比。`,
      });
    }
  }

  // 3. 流量是否已经停了
  const viewSnaps = n.snaps.filter((s) => s.view != null);
  const ref = [...viewSnaps].reverse().find((s) => now - s.t >= 12 * HOUR && now - s.t <= 36 * HOUR);
  if (ref) {
    const spanH = (now - ref.t) / HOUR;
    const perDay = ((n.view - ref.view) / spanH) * 24;
    const stalled = n.ageH < 7 * 24 && perDay < 0.03 * n.view;
    out.push({
      level: stalled ? 'warn' : 'info',
      title: stalled
        ? `最近一天只涨了约 ${Math.round(perDay)} 次${L.view}，流量基本停了`
        : `最近一天涨了约 ${Math.round(perDay)} 次${L.view}`,
      detail: `依据：过去 ${Math.round(spanH)} 小时${L.view}从 ${ref.view} 到 ${n.view}。${stalled ? '发布一周内日增不到总量的 3%，说明平台已经不再继续推。' : ''}`,
    });
  }

  // 4. 时长
  const dur = n.item.duration;
  const medDur = median(mature.map((r) => r.item.duration));
  if (dur && ((medDur && dur >= medDur * 1.5) || (!medDur && dur >= 30 * 60))) {
    out.push({
      level: 'info',
      title: medDur
        ? `这期 ${fmtDuration(dur)}，是往期中位数（${fmtDuration(medDur)}）的 ${(dur / medDur).toFixed(1)} 倍`
        : `这期时长 ${fmtDuration(dur)}`,
      detail: '长视频更依赖完播率和点击率才能拿到推荐。时长是否拖累了这期，要看创作中心的完播率和平均观看时长，公开数据里没有。',
    });
  }

  // 5. 涨粉
  const acc = data.accounts.filter((a) => a.platform === platform && a.followers != null);
  if (acc.length >= 2) {
    const pubMs = n.item.pubdate * 1000;
    const start = acc.find((a) => a.t >= pubMs) || acc[0];
    const end = acc[acc.length - 1];
    if (end.t - start.t >= 6 * HOUR) {
      const delta = end.followers - start.followers;
      const since = start === acc[0] && start.t - pubMs > 6 * HOUR ? '开始监控' : '这期发布';
      out.push({
        level: delta > 0 ? 'good' : 'info',
        title: `自${since}以来粉丝 ${delta >= 0 ? '+' : ''}${delta}（${start.followers} → ${end.followers}）`,
        detail: `统计区间 ${fmtAge((end.t - start.t) / HOUR)}。`,
      });
    }
  }

  // 6. 平台自己的诊断
  if (platform === 'bilibili') out.push(...bilibiliDiag(n, lowReach));
  if (platform === 'wechat') out.push(...wechatExtra(data, n, mature));
  if (platform === 'xiaohongshu') out.push(...xhsExtra(data, n));
  return out;
}

// B 站创作中心“稿件分析”里的官方诊断
function bilibiliDiag(n, lowReach) {
  const d = n.item.diag;
  if (!d) {
    return [{
      level: 'info',
      title: '要判断是不是“限流”，还缺创作中心的数据',
      detail: '创作中心有官方的“流量状态”和封标点击率、3 秒跳出率。在这个 Chrome 里登录 B 站创作中心后，下次采集会自动带上。',
    }];
  }
  const out = [];
  out.push(d.limited
    ? { level: 'warn', title: `B 站官方标记这期流量受限${d.limitReason ? `：${d.limitReason}` : ''}`, detail: '来自创作中心“稿件分析”的流量状态。' }
    : { level: 'good', title: 'B 站官方流量状态：正常，没有被限流', detail: '来自创作中心“稿件分析”的流量状态。这只说明没有被处罚性限流，不代表平台给的推荐量大。' });
  if (d.ctrPass != null) {
    out.push({
      level: d.ctrPass >= 0.5 ? 'good' : d.ctrPass < 0.3 ? 'warn' : 'info',
      title: `封标点击率超过了 ${pct(d.ctrPass)} 的同类稿件`,
      detail: `封标点击率 = 看到封面和标题的人里点进来的比例。${d.ctrPass >= 0.5 ? '封面和标题不是短板。' : '封面和标题可能是短板。'}`,
    });
  }
  if (d.interactPass != null) {
    out.push({
      level: d.interactPass >= 0.5 ? 'good' : d.interactPass < 0.3 ? 'warn' : 'info',
      title: `互动率超过了 ${pct(d.interactPass)} 的同类稿件${d.interact != null ? `（创作中心口径 ${pct(d.interact, 1)}）` : ''}`,
      detail: '创作中心的互动率口径和上面的不同，以它的同类排名为准。',
    });
  }
  out.push(d.bounce != null
    ? { level: d.bouncePass != null && d.bouncePass < 0.3 ? 'warn' : 'info', title: `3 秒跳出率 ${pct(d.bounce, 1)}${d.bouncePass != null ? `，优于 ${pct(d.bouncePass)} 的同类稿件` : ''}`, detail: '点进来 3 秒内就走的比例，反映开头是否留得住人。' }
    : { level: 'info', title: '3 秒跳出率、播转粉率还没出数', detail: '创作中心在发稿次日 12 点更新这两项，出数后会自动显示。' });
  if (!d.limited && d.ctrPass >= 0.5 && d.interactPass >= 0.5) {
    out.push({
      level: 'info',
      title: '综合判断：没被限流，封面标题和互动都高于同类',
      detail: lowReach
        ? '点击和互动都不差而播放少，说明问题不在内容质量或封面，更可能是平台给的初始曝光池小（题材受众窄、发布时段、账号近期活跃度）。这是推测，可以用下一期换发布时间或拆短来验证。'
        : '如果播放仍然偏少，原因更可能在平台给的初始曝光量（题材受众窄、发布时段、账号近期活跃度），而不是内容质量或封面。这是推测。',
    });
  }
  return out;
}

// 公众号特有：送达后的阅读比例、分享带来的扩散、是否被关闭推荐
function wechatExtra(data, n, mature) {
  const out = [];
  const s = n.full;
  if (n.item.sent && s) {
    out.push({
      level: 'info',
      title: `群发送达 ${n.item.sent} 人，阅读 ${s.view}，相当于送达人数的 ${pct(s.view / n.item.sent, 1)}`,
      detail: '阅读里也包含非粉丝（分享、搜索、推荐带来的），所以这个比例是粉丝打开率的上限。',
    });
  }
  if (s && s.view) {
    const rate = (s.share || 0) / s.view;
    const base = median(mature.map((r) => (r.full && r.full.view ? (r.full.share || 0) / r.full.view : null)));
    out.push({
      level: base != null && rate >= base ? 'good' : 'info',
      title: `分享率 ${pct(rate, 1)}（${s.share || 0} 次分享 / ${s.view} 次阅读）${base != null ? `，往期中位数 ${pct(base, 1)}` : ''}`,
      detail: '公众号没有付费投流，粉丝之外的阅读主要靠分享和平台推荐，分享率是最能自己影响的一项。',
    });
  }
  if (n.item.noRecommend) {
    out.push({ level: 'warn', title: '这篇文章被标记为不参与平台推荐', detail: '后台数据里 disable_recommend 为开启状态。' });
  }
  const daily = (data.daily && data.daily.wechat) || {};
  const days = Object.keys(daily).sort();
  const pubDay = new Date(n.item.pubdate * 1000).toISOString().slice(0, 10);
  const after = days.filter((d) => d >= pubDay);
  if (after.length) {
    const add = after.reduce((a, d) => a + daily[d].add, 0);
    const cancel = after.reduce((a, d) => a + daily[d].cancel, 0);
    out.push({
      level: add - cancel > 0 ? 'good' : 'info',
      title: `这篇发布以来新增关注 ${add}，取关 ${cancel}，净增 ${add - cancel}`,
      detail: `统计 ${after[0]} 至 ${after[after.length - 1]}，来自后台“用户分析”，数据到昨天为止。`,
    });
  }
  return out;
}

// 小红书：近 7 天账号曝光与封面点击率；新笔记的曝光、点击率、2 秒退出率
function xhsExtra(data, n) {
  const out = [];
  const a = data.status && data.status.xiaohongshu && data.status.xiaohongshu.account7;
  if (a && a.impressions != null) {
    out.push({
      level: 'info',
      title: `近 7 天账号曝光 ${a.impressions}，观看 ${a.views ?? '—'}，封面点击率 ${a.ctr != null ? pct(a.ctr, 1) : '—'}`,
      detail: '来自小红书创作服务平台“数据中心”。曝光是笔记被展示的次数，封面点击率 = 点进来的人 ÷ 看到的人。',
    });
  }
  const d = n.item.deep;
  if (d && d.impressions != null) {
    out.push({
      level: d.ctr != null && a && a.ctr != null && d.ctr < a.ctr * 0.7 ? 'warn' : 'info',
      title: `这篇曝光 ${d.impressions}，封面点击率 ${d.ctr != null ? pct(d.ctr, 1) : '—'}${d.exit2s != null ? `，2 秒退出率 ${pct(d.exit2s, 1)}` : ''}`,
      detail: '曝光少说明平台推得少；曝光多但点击率低，是封面和标题的问题；点进来很快就走，是开头的问题。',
    });
  } else if (!n.item.deep) {
    out.push({
      level: 'info',
      title: '这篇没有曝光和点击率数据',
      detail: '小红书只给发布后一段时间内的笔记提供详细指标；更早发布的笔记只有观看、点赞、收藏、评论、分享。新笔记发布后扩展会把这些指标存下来。',
    });
  }
  return out;
}
