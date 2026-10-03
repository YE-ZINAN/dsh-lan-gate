/**
 * 认证层，两套独立的凭据：
 *
 *  A. 设备令牌（本网关签发，管「这台设备被批准过吗」）
 *     - 值 = `${deviceId}.${expiresAt}.${hmac(secret, deviceId.expiresAt)}`
 *     - 密钥首次运行随机生成并落盘（~/.dsh/lan-gate-secret），不复用 DSH 的密钥
 *
 *  B. DSH 会话 Cookie（转发给上游用，管「DSH 认不认这个界面请求」）
 *     - 读 ~/.dsh/.credentials.yaml 里 client-connection/browser-session.secret
 *     - 按 DSH 自己的格式自签：dsh-auth-<sha256(authority)> = v1.<body>.<hmac>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DSH_DIR = path.join(os.homedir(), '.dsh');
const GATE_SECRET_PATH = path.join(DSH_DIR, 'lan-gate-secret');
const CRED_PATH = path.join(DSH_DIR, '.credentials.yaml');

export const COOKIE_DSH_PREFIX = 'dsh-auth-';
const COOKIE_PAYLOAD_VERSION = 1;
const SECRET_BYTES = 32;

export const DEVICE_COOKIE = 'langate_device';
export const DEVICE_COOKIE_MAX_AGE_SEC = 180 * 24 * 3600; // 半年

// ───────────────────────── 通用编码 ─────────────────────────
export const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const b64urlDecode = (v) => {
  const pad = v.length % 4 === 0 ? '' : '='.repeat(4 - (v.length % 4));
  return Buffer.from(v.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64');
};

// ───────────────────────── A. 设备令牌 ─────────────────────────
let gateSecretCache;
export function gateSecret() {
  if (gateSecretCache) return gateSecretCache;
  try {
    const raw = fs.readFileSync(GATE_SECRET_PATH, 'utf8').trim();
    const buf = b64urlDecode(raw);
    if (buf.byteLength === SECRET_BYTES) { gateSecretCache = buf; return buf; }
  } catch { /* 下面生成 */ }
  const created = crypto.randomBytes(SECRET_BYTES);
  fs.mkdirSync(DSH_DIR, { recursive: true });
  fs.writeFileSync(GATE_SECRET_PATH, b64url(created), { encoding: 'utf8', mode: 0o600 });
  gateSecretCache = created;
  return created;
}

function sign(secret, text) {
  return b64url(crypto.createHmac('sha256', secret).update(text).digest());
}

export function issueDeviceToken(deviceId) {
  const expiresAt = Date.now() + DEVICE_COOKIE_MAX_AGE_SEC * 1000;
  return `${deviceId}.${expiresAt}.${sign(gateSecret(), `${deviceId}.${expiresAt}`)}`;
}

/** 校验设备令牌，返回 deviceId 或 undefined。 */
export function verifyDeviceToken(token) {
  if (typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [deviceId, expiresRaw, sig] = parts;
  const expiresAt = Number(expiresRaw);
  if (!deviceId || !Number.isSafeInteger(expiresAt)) return undefined;
  const expected = sign(gateSecret(), `${deviceId}.${expiresAt}`);
  if (sig.length !== expected.length) return undefined;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  if (expiresAt <= Date.now()) return undefined;
  return deviceId;
}

export function deviceCookieHeader(deviceId) {
  const expires = new Date(Date.now() + DEVICE_COOKIE_MAX_AGE_SEC * 1000).toUTCString();
  return `${DEVICE_COOKIE}=${issueDeviceToken(deviceId)}; Max-Age=${DEVICE_COOKIE_MAX_AGE_SEC}; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax`;
}

// ───────────────────────── Cookie 解析 ─────────────────────────
export function parseCookies(headerValue) {
  const out = {};
  if (!headerValue) return out;
  for (const seg of String(headerValue).split(';')) {
    const at = seg.indexOf('=');
    if (at === -1) continue;
    out[seg.slice(0, at).trim()] = seg.slice(at + 1).trim();
  }
  return out;
}

// ───────────────────────── B. DSH 会话 Cookie ─────────────────────────
let dshSecretCache;
export function readDshSecret() {
  if (dshSecretCache) return dshSecretCache;
  const text = fs.readFileSync(CRED_PATH, 'utf8');
  const lines = text.split('\n');
  let inside = false, baseIndent = 0;
  for (const line of lines) {
    if (/client-connection\/browser-session\s*:/.test(line)) {
      inside = true;
      baseIndent = line.match(/^ */)[0].length;
      continue;
    }
    if (!inside) continue;
    const indent = line.match(/^ */)[0].length;
    if (line.trim() && indent <= baseIndent) { inside = false; continue; }
    const m = line.match(/^\s*secret:\s*(.+?)\s*$/);
    if (m) {
      const secret = b64urlDecode(m[1].replace(/^["']|["']$/g, ''));
      if (secret.byteLength !== SECRET_BYTES) throw new Error(`DSH secret 解码后 ${secret.byteLength} 字节，期望 ${SECRET_BYTES}`);
      dshSecretCache = secret;
      return secret;
    }
  }
  throw new Error('未在 ' + CRED_PATH + ' 找到 client-connection/browser-session.secret');
}

export function mintDshSessionCookie(authority, days = 7) {
  const secret = readDshSecret();
  const name = COOKIE_DSH_PREFIX + b64url(crypto.createHash('sha256').update(authority).digest());
  const now = Date.now();
  const payload = { version: COOKIE_PAYLOAD_VERSION, authority, issuedAt: now, expiresAt: now + days * 24 * 3600 * 1000 };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { name, value: `v1.${body}.${sign(secret, body)}` };
}

export function dshSessionCookiePair(authority, days = 7) {
  const { name, value } = mintDshSessionCookie(authority, days);
  return `${name}=${value}`;
}

// ───────────────────────── 设备标识 ─────────────────────────
export function clientIp(req) {
  const raw = req.socket?.remoteAddress || '';
  // ::ffff:192.168.1.23 → 192.168.1.23 ； ::1 → 127.0.0.1
  if (raw === '::1') return '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

export function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const osName = /iPad/i.test(ua) ? 'iPad' : /iPhone/i.test(ua) ? 'iPhone'
    : /Android/i.test(ua) ? 'Android' : /Macintosh/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows' : '未知设备';
  const browser = /EdgA?\//i.test(ua) ? 'Edge' : /CriOS|Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : '';
  return browser ? `${osName} · ${browser}` : osName;
}

export function newDeviceId() {
  return crypto.randomBytes(9).toString('hex');
}
