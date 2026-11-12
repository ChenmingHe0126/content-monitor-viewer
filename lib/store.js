// 本地存储封装。扩展里用 chrome.storage.local；
// 不在扩展里（直接用浏览器打开 dashboard.html 预览）时退回内存，配合演示数据。

const hasChrome =
  typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

export const isExtension = hasChrome;

const mem = {};

export async function get(keys) {
  if (hasChrome) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of [].concat(keys)) if (k in mem) out[k] = mem[k];
  return out;
}

export async function set(obj) {
  if (hasChrome) return chrome.storage.local.set(obj);
  Object.assign(mem, obj);
}

export const DEFAULT_CONFIG = {
  intervalMin: 30,
  autoCollect: true, // false：只在手机点“更新”或电脑点“立即采集”时采集
  remote: { topic: '' }, // 手机遥控更新用的 ntfy 主题，第一次运行时自动生成
  bilibili: {
    mid: 0, // B 站 UID（公开主页地址里的数字）
    seedBvids: [], // 列表接口取不到时，至少跟踪这些视频
  },
  push: {
    channel: 'none', // none | ntfy | bark | serverchan
    ntfyTopic: '',
    barkKey: '',
    sckey: '',
    dailyHour: 9, // 每天几点（本机时间）发日报
    alerts: true, // 限流、登录过期时立即提醒
    dotEnabled: false, // 每天给 ChatGPT Dot 一份详细数据
    dotTopic: '',
  },
  cloud: {
    enabled: false, // 手机查看：加密上传到自己的私密 Gist
    token: '', // 只有 gist 权限的 GitHub token，只存在本机
    passphrase: '', // 查看密码，手机上输入它来解密
    viewerUrl: 'https://chenminghe0126.github.io/content-monitor-viewer/',
  },
};

// 数据结构：
//   accounts: [{ t, platform, followers, likes, videos }]
//   items:    { "bilibili:BVxxx": { platform, id, title, pubdate(秒), duration(秒), url } }
//   snaps:    { "bilibili:BVxxx": [{ t, view, like, coin, fav, reply, share, danmaku }] }
//             列表接口只给播放和评论，这类快照没有 like 等字段
//   daily:    { wechat: { '2026-11-09': { add, cancel, net, total } } }  后台自带的每日粉丝数
//   status:   { bilibili: { lastOk, lastErr, errMsg, backoffUntil, lastList } }
export async function loadAll() {
  const d = await get(['config', 'accounts', 'items', 'snaps', 'status', 'daily']);
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...(d.config || {}),
      push: { ...DEFAULT_CONFIG.push, ...((d.config && d.config.push) || {}) },
      cloud: { ...DEFAULT_CONFIG.cloud, ...((d.config && d.config.cloud) || {}) },
      remote: { ...DEFAULT_CONFIG.remote, ...((d.config && d.config.remote) || {}) },
    },
    accounts: d.accounts || [],
    items: d.items || {},
    snaps: d.snaps || {},
    status: d.status || {},
    daily: d.daily || {},
  };
}

export async function saveConfig(config) {
  await set({ config });
}

export async function saveAll(data) {
  await set({
    accounts: data.accounts,
    items: data.items,
    snaps: data.snaps,
    status: data.status,
    daily: data.daily || {},
  });
}
