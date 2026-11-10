// 演示数据：只在不作为扩展运行（直接用浏览器打开 dashboard.html）时使用，全部是编造的数字。
import { DEFAULT_CONFIG } from './store.js';

const HOUR = 3600e3;

export function demoData(now = Date.now()) {
  const data = { config: DEFAULT_CONFIG, accounts: [], items: {}, snaps: {}, status: { bilibili: { lastOk: now } } };

  for (let h = 120; h >= 0; h -= 2) {
    data.accounts.push({ t: now - h * HOUR, platform: 'bilibili', followers: Math.round(2400 + (120 - h) * 0.15) });
  }

  const vids = [
    { id: 'DEMO0', title: '示例：最新一期（60 分钟长视频）', ageH: 46, dur: 3596, final: 150, k: 9 },
    { id: 'DEMO1', title: '示例：上一期', ageH: 24 * 12, dur: 1500, final: 900, k: 30 },
    { id: 'DEMO2', title: '示例：再上一期', ageH: 24 * 26, dur: 1845, final: 1400, k: 36 },
    { id: 'DEMO3', title: '示例：爆款', ageH: 24 * 45, dur: 1200, final: 5200, k: 60 },
    { id: 'DEMO4', title: '示例：普通一期', ageH: 24 * 70, dur: 1100, final: 780, k: 24 },
    { id: 'DEMO5', title: '示例：冷门一期', ageH: 24 * 95, dur: 900, final: 410, k: 20 },
  ];
  for (const v of vids) {
    const key = `bilibili:${v.id}`;
    const pubMs = now - v.ageH * HOUR;
    data.items[key] = { platform: 'bilibili', id: v.id, title: v.title, pubdate: Math.round(pubMs / 1000), duration: v.dur, url: '#' };
    const snaps = [];
    const step = v.ageH > 200 ? 12 : 2;
    for (let h = 1; h <= v.ageH; h += step) {
      const view = Math.round(v.final * (1 - Math.exp(-h / v.k)));
      snaps.push({
        t: pubMs + h * HOUR, view,
        like: Math.round(view * 0.065), coin: Math.round(view * 0.015), fav: Math.round(view * 0.05),
        reply: Math.round(view * 0.02), share: Math.round(view * 0.006), danmaku: 0,
      });
    }
    data.snaps[key] = snaps;
  }
  data.items['bilibili:DEMO0'].diag = {
    t: now, limited: false, limitReason: '', ctr: 0.0375, ctrMed: 0.02, ctrPass: 0.76,
    interact: 0.175, interactPass: 0.89, bounce: null, bouncePass: null, toFan: null, guestShare: null,
  };

  // 公众号
  data.status.wechat = { lastOk: now };
  data.daily = { wechat: {} };
  for (let d = 30; d >= 1; d--) {
    const day = new Date(now - d * 24 * HOUR).toISOString().slice(0, 10);
    data.daily.wechat[day] = { add: 3, cancel: 1, net: 2, total: 570 - d * 2 };
  }
  data.accounts.push({ t: now, platform: 'wechat', followers: 570 });
  const arts = [
    { id: 'A0', title: '示例：最新一篇', ageH: 22, sent: 564, view: 84, like: 7, wow: 2, share: 9 },
    { id: 'A1', title: '示例：上一篇', ageH: 24 * 11, sent: 300, view: 1020, like: 22, wow: 7, share: 55 },
    { id: 'A2', title: '示例：爆款一篇', ageH: 24 * 12, sent: 260, view: 5347, like: 57, wow: 41, share: 283 },
    { id: 'A3', title: '示例：早期一篇', ageH: 24 * 400, sent: 200, view: 766, like: 17, wow: 16, share: 10 },
    { id: 'A4', title: '示例：早期另一篇', ageH: 24 * 401, sent: 200, view: 420, like: 9, wow: 5, share: 6 },
  ];
  for (const a of arts) {
    const key = `wechat:${a.id}`;
    data.items[key] = { platform: 'wechat', id: a.id, title: a.title, pubdate: Math.round((now - a.ageH * HOUR) / 1000), url: '#', sent: a.sent };
    data.snaps[key] = [{ t: now, full: true, view: a.view, like: a.like, wow: a.wow, share: a.share, reply: 0 }];
  }
  return data;
}
