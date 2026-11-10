// 手机查看：电脑把数据加密后存到用户自己 GitHub 账号下的私密 Gist，手机网页取回后用查看密码解密。
// GitHub 上只有密文；加密用 PBKDF2-SHA256 派生的 AES-GCM 256 位密钥，压缩后再加密。

export const GIST_FILE = 'content-monitor.enc.json';
export const ITER = 210000;
const HOUR = 3600e3;
const te = new TextEncoder();
const td = new TextDecoder();

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encryptJson(obj, pass, iter = ITER) {
  const plain = te.encode(JSON.stringify(obj));
  const gz = typeof CompressionStream !== 'undefined';
  const body = gz ? await pipe(plain, new CompressionStream('gzip')) : plain;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body);
  return { v: 1, kdf: 'PBKDF2-SHA256', iter, gz, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export class WrongPasswordError extends Error {}

export async function decryptJson(env, pass) {
  if (!env || env.v !== 1) throw new Error('数据格式不认识，可能需要更新网页');
  const key = await deriveKey(pass, unb64(env.salt), env.iter);
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct)));
  } catch {
    throw new WrongPasswordError('密码不对');
  }
  if (env.gz) bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(bytes));
}

export async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', te.encode(text)));
}

// 越旧的快照存得越稀：3 天内全留，30 天内每 6 小时一条，更早每天一条
export function thin(points, now, keyOf = () => '') {
  const out = new Map();
  for (const p of points || []) {
    const age = now - p.t;
    const bucket = age <= 72 * HOUR ? `a${p.t}` : age <= 30 * 24 * HOUR ? `b${Math.floor(p.t / (6 * HOUR))}` : `c${Math.floor(p.t / (24 * HOUR))}`;
    out.set(`${keyOf(p)}|${bucket}`, p);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

// 上传到云端的内容：不含 token、查看密码、推送主题等任何密钥
export function snapshotForCloud(data, now) {
  const snaps = {};
  for (const [k, v] of Object.entries(data.snaps || {})) snaps[k] = thin(v, now);
  const pick = (o, keys) => (o ? Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) : undefined);
  return {
    exportedAt: new Date(now).toISOString(),
    config: { intervalMin: data.config.intervalMin },
    accounts: thin(data.accounts, now, (a) => a.platform),
    items: data.items,
    snaps,
    daily: data.daily || {},
    status: {
      bilibili: pick(data.status.bilibili, ['lastOk', 'lastErr', 'errMsg', 'backoffUntil', 'creator']),
      wechat: pick(data.status.wechat, ['lastOk', 'lastErr', 'errMsg']),
      douyin: pick(data.status.douyin, ['lastOk', 'lastErr', 'errMsg']),
      xiaohongshu: pick(data.status.xiaohongshu, ['lastOk', 'lastErr', 'errMsg', 'account7']),
    },
  };
}

const ghHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

class GistGoneError extends Error {}

// 新建或更新 Gist，返回 Gist id
export async function uploadGist(token, gistId, content, fetchImpl = fetch) {
  const r = await fetchImpl(gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists', {
    method: gistId ? 'PATCH' : 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: '内容数据（已加密，需查看密码）',
      files: { [GIST_FILE]: { content } },
      ...(gistId ? {} : { public: false }),
    }),
  });
  const text = await r.text();
  if (r.status === 401) throw new Error('GitHub token 无效或已过期，请重新生成');
  if (r.status === 404 && gistId) throw new GistGoneError('之前的 Gist 不见了');
  if (r.status === 403 || r.status === 404) throw new Error('GitHub token 没有 Gist 权限');
  if (!r.ok) throw new Error(`上传失败：HTTP ${r.status} ${text.slice(0, 120)}`);
  return JSON.parse(text).id;
}

export async function fetchGist(gistId, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, { headers: ghHeaders(), cache: 'no-store' });
  if (r.status === 404) throw new Error('找不到数据：网址不完整，或电脑还没上传过');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub 访问太频繁，过几分钟再刷新');
  if (!r.ok) throw new Error(`读取失败：HTTP ${r.status}`);
  const j = await r.json();
  const f = j.files && j.files[GIST_FILE];
  if (!f) throw new Error('Gist 里没有数据文件');
  const content = f.truncated ? await (await fetchImpl(f.raw_url, { cache: 'no-store' })).text() : f.content;
  return { env: JSON.parse(content), updatedAt: j.updated_at };
}

export function cloudReady(c) {
  return !!(c && c.enabled && (c.token || '').trim() && (c.passphrase || '').length >= 8);
}

export function viewerLink(c, gistId) {
  if (!c || !gistId) return '';
  const base = (c.viewerUrl || '').replace(/#.*$/, '');
  return `${base}#g=${gistId}`;
}

// 每轮采集后调用。数据有变化，或距上次上传超过 3 小时，才上传
export async function syncCloud(data, now, { force = false, fetchImpl = fetch } = {}) {
  const c = data.config.cloud;
  if (!cloudReady(c)) return [];
  const st = (data.status.cloud ||= {});
  const snap = snapshotForCloud(data, now);
  // 只看“最新的数”有没有变：各平台最新粉丝、每个作品最后一条快照、作品信息、每日粉丝
  const noT = (o) => (o ? { ...o, t: undefined } : o);
  const lastFollowers = {};
  for (const a of data.accounts) lastFollowers[a.platform] = a.followers;
  const hash = await sha256(JSON.stringify({
    f: lastFollowers,
    s: Object.fromEntries(Object.entries(data.snaps || {}).map(([k, v]) => [k, noT(v[v.length - 1])])),
    i: Object.fromEntries(Object.entries(data.items).map(([k, v]) => [k, { ...v, diag: noT(v.diag) }])),
    d: data.daily || {},
  }));
  if (!force && st.gistId && st.hash === hash && now - (st.lastOk || 0) < 3 * HOUR) return [];
  try {
    const content = JSON.stringify(await encryptJson(snap, c.passphrase));
    let id;
    try {
      id = await uploadGist(c.token.trim(), st.gistId || null, content, fetchImpl);
    } catch (e) {
      if (!(e instanceof GistGoneError)) throw e;
      id = await uploadGist(c.token.trim(), null, content, fetchImpl);
    }
    Object.assign(st, { gistId: id, hash, lastOk: now, error: null });
    return ['已上传手机查看数据'];
  } catch (e) {
    Object.assign(st, { error: e.message, lastErr: now });
    return [`手机查看数据上传失败：${e.message}`];
  }
}
