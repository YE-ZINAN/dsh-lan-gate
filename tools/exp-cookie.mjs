/**
 * 实验（只读）：用凭据文件里的 browser-session 密钥，按 DSH 自己的格式签一个合法 Cookie，
 * 看能否跳过启动令牌直接通过鉴权。
 *
 * 判据：401 = 不行（必须重启换令牌）；303 = 成功（无需重启）
 * 全程只读：读凭据文件 + 发一个探测请求。不写任何文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const CRED = path.join(os.homedir(), '.dsh', '.credentials.yaml');
const UPSTREAM = { host: '127.0.0.1', port: 19387 };
const AUTHORITY = '127.0.0.1:19387';

const COOKIE_PREFIX = 'dsh-auth-';
const COOKIE_PAYLOAD_VERSION = 1;
const SECRET_BYTES = 32;

const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const b64urlDecode = (v) => {
  const pad = v.length % 4 === 0 ? '' : '='.repeat(4 - (v.length % 4));
  return Buffer.from(v.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64');
};

// ── 从凭据文件读 browser-session 的 secret ──
const raw = fs.readFileSync(CRED, 'utf8');
function extractSecret(text) {
  const lines = text.split('\n');
  let inside = false, baseIndent = 0;
  for (const line of lines) {
    if (/client-connection\/browser-session\s*:/.test(line)) { inside = true; baseIndent = line.match(/^ */)[0].length; continue; }
    if (!inside) continue;
    const indent = line.match(/^ */)[0].length;
    if (line.trim() && indent <= baseIndent) { inside = false; continue; }
    const m = line.match(/^\s*secret:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
}
const secretRaw = extractSecret(raw);
if (!secretRaw) { console.error('✗ 凭据文件里没找到 browser-session.secret'); process.exit(1); }
const secret = b64urlDecode(secretRaw);
console.log('凭据文件 secret: 长度 ' + secretRaw.length + '，解码后 ' + secret.byteLength + ' 字节（期望 ' + SECRET_BYTES + '）');
if (secret.byteLength !== SECRET_BYTES) { console.error('✗ 字节数不符，解析位置可能不对，终止'); process.exit(1); }

// ── 按 DSH 的格式构造 Cookie ──
const cookieName = COOKIE_PREFIX + b64url(crypto.createHash('sha256').update(AUTHORITY).digest());
const now = Date.now();
const payload = { version: COOKIE_PAYLOAD_VERSION, authority: AUTHORITY, issuedAt: now, expiresAt: now + 7 * 24 * 3600 * 1000 };
const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
const cookieValue = `v1.${body}.${sig}`;
console.log('Cookie 名: ' + cookieName);
console.log('Cookie 值: v1.<' + body.length + ' 字符>.<' + sig.length + ' 字符>');

// ── 探测 ──
function probe(cookieHeader, label) {
  return new Promise((resolve) => {
    const headers = { host: AUTHORITY };
    if (cookieHeader) headers.cookie = cookieHeader;
    const req = http.request({ ...UPSTREAM, path: '/', method: 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ label, status: res.statusCode, location: res.headers.location, setCookie: res.headers['set-cookie'], body: b.trim().slice(0, 90) }));
    });
    req.on('error', (e) => resolve({ label, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ label, error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  console.log('\n=== 结果 ===');
  const forged = await probe(cookieName + '=' + cookieValue, '自签 Cookie');
  console.log('  [自签 Cookie]  ' + (forged.error ? 'ERR ' + forged.error : forged.status + (forged.location ? '  → Location: ' + forged.location : '') + (forged.status === 401 ? '  body: ' + forged.body : '')));

  const none = await probe(null, '无 Cookie');
  console.log('  [无 Cookie ]  ' + none.status + (none.status === 401 ? '  （预期，作为对照）' : ''));

  console.log('\n判定: ' + (forged.status === 303 ? '✅ 成功 —— 无需重启 DSH' : forged.status === 401 ? '❌ 失败 —— 必须重启换新令牌' : '⚠️ 意外状态 ' + forged.status));
})();
