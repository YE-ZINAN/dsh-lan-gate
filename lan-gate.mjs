#!/usr/bin/env node
/**
 * dsh-lan-gate · 局域网网关（第 3 步：带门禁）
 *
 * 作用：让手机/iPad 在同一 WiFi 下安全访问电脑上的 DSH。
 *
 * 设计要点（全部来自实测，不是推测）：
 *   1. DSH 本体仍只监听 127.0.0.1，不暴露到局域网 —— 本网关是唯一的入口。
 *   2. 未批准的设备连不上 DSH：网关先拦，只给「等待电脑批准」页。
 *   3. 批准动作只能在电脑上点（管理页与批准 API 都只接受回环地址）。
 *   4. 转发时固定改写 Host 与 Origin：
 *        Host   —— DSH 用 sha256(Host) 算会话 Cookie 名，固定后才闭环
 *        Origin —— DSH 的 /api 有来源信任栅栏，手机原生 Origin 会被 403
 *   5. DSH 的会话 Cookie 由网关自签（读 ~/.dsh/.credentials.yaml 的密钥），
 *      因此无需启动令牌、无需重启 DSH。
 *
 * 本步不做：手机端排版优化（下一步）、PWA（再下一步）。
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';

import { load, save, takeRateLimit, prunePending, saveDomReport, STATE_PATH } from './lib/store.mjs';
import {
  verifyDeviceToken, deviceCookieHeader, dshSessionCookiePair, parseCookies,
  clientIp, deviceLabel, newDeviceId,
} from './lib/auth.mjs';
import { waitingPage, adminPage, rateLimitedPage } from './lib/pages.mjs';
import { injectMobile, isMobileRequest } from './lib/mobile.mjs';
import { injectPwa, buildManifest, readIcon, MANIFEST_PATH } from './lib/pwa.mjs';

// ─────────────────────────── 配置 ───────────────────────────
const LISTEN_PORT = Number(process.env.LAN_GATE_PORT || 3089);
const LISTEN_HOST = process.env.LAN_GATE_HOST || '0.0.0.0';
const UPSTREAM_HOST = process.env.LAN_GATE_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.LAN_GATE_UPSTREAM_PORT || 19387);
const FORCED_AUTHORITY = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
const RATE_LIMIT = Number(process.env.LAN_GATE_RATE_LIMIT || 600);
const ADMIN_PATH = '/__langate/admin';
/** 手机排版策略：auto（按 UA）| on（强制）| off（关闭）。可用 ?mobile=1/0 临时覆盖。 */
const MOBILE_MODE = String(process.env.LAN_GATE_MOBILE || 'auto').toLowerCase();
/**
 * 网络守卫：只有本机 IP 命中这些前缀时才允许启动（逗号分隔；留空 = 不限制）。
 *
 * 为什么要它：本机防火墙三个 profile 全是关的，网关一旦监听 0.0.0.0:3089，
 * 在任意网络下端口都对同网设备开放。配合开机自启，就会出现「带着笔记本去
 * 咖啡厅，网关照样裸挂在公共网络上」。加上守卫后，换网络自动不开。
 */
const ALLOW_NET = String(process.env.LAN_GATE_ALLOW_NET || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const startedAt = Date.now();
const stats = { http: 0, ws: 0, blocked: 0, autoLogin: 0, upstreamErrors: 0 };

let state = load();
if (prunePending(state)) save(state);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** 本机所有非内部 IPv4 地址。 */
function localIPv4s() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

/**
 * 「这台电脑自己」的地址集合：回环 + 本机各网卡地址。
 *
 * 为什么需要：从本机用局域网 IP 访问自己时，来源 IP 不是 127.0.0.1，
 * 会被门禁当成一台**新设备**登记进状态文件——测试脚本（端到端场景 3）
 * 每次跑都会留下一台假设备。本机自己发起的流量不该算「设备」。
 */
const SELF_IPS = new Set(['127.0.0.1', '::1', 'localhost', ...localIPv4s()]);
const isSelf = (ip) => SELF_IPS.has(ip);

/**
 * 网络守卫。返回 true = 放行；false = 拒绝启动（调用方应直接退出，端口都不要开）。
 * 调用时机必须在 listen 之前 —— 「先监听再关闭」会留下一个可被扫到的窗口。
 */
function passNetworkGuard() {
  if (ALLOW_NET.length === 0) return true;
  const ips = localIPv4s();
  const hit = ips.find((ip) => ALLOW_NET.some((p) => ip.startsWith(p)));
  if (hit) {
    log(`网络守卫通过: 本机 ${hit} 命中允许网段 [${ALLOW_NET.join(', ')}]`);
    return true;
  }
  log(`网络守卫拦截: 本机 IP [${ips.join(', ') || '无'}] 都不在允许网段 [${ALLOW_NET.join(', ')}]`);
  log('  这是为了防止在不可信网络下暴露 3089 端口。确实要启动就清掉环境变量 LAN_GATE_ALLOW_NET。');
  return false;
}

// ─────────────────────────── 客户端注入 ───────────────────────────
const CLIENT_PATCH = `<script>
(function () {
  if (!window.crypto) window.crypto = {};
  if (typeof window.crypto.randomUUID !== 'function') {
    window.crypto.randomUUID = function () {
      var b = new Uint8Array(16);
      if (window.crypto.getRandomValues) window.crypto.getRandomValues(b);
      else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    };
  }

  // iPad 兜底：iPadOS 的 Safari 默认把自己伪装成 Mac（UA 里既没有 iPad 也没有 Mobile），
  // 服务端按 UA 判定时认不出来，会给出桌面版布局。
  // 这里用「触点数 > 1 且 UA 像 Mac」识别 iPad（Mac 笔记本没有多点触控），
  // 带一次 ?mobile=1 重新加载；真正的窄屏判断仍交给 CSS 的 860px 媒体查询。
  try {
    if (document.getElementById('langate-mobile-css')) return;      // 已按移动端注入过
    var touch = (navigator.maxTouchPoints || 0) > 1;
    var macLike = /Macintosh|Mac OS X/.test(navigator.userAgent);
    var notPhone = !/Android|iPhone|iPod/i.test(navigator.userAgent);
    var shortEdge = Math.min(screen.width || 0, screen.height || 0);
    var q = location.search || '';
    if (touch && macLike && notPhone && shortEdge > 0 && shortEdge <= 1024 && q.indexOf('mobile=') === -1) {
      // 保留已有参数（例如 ?dev=1），只追加 mobile=1
      var base = location.pathname + q;
      location.replace(base + (q ? '&' : '?') + 'mobile=1' + (location.hash || ''));
    }
  } catch (e) { /* 忽略 */ }
})();
</script>`;

// ─────────────────────────── 转发工具 ───────────────────────────
/**
 * 改写发给上游的请求头。
 * host / origin / referer 三处必须改：见文件头注释第 4 点。
 */
function upstreamHeaders(raw, { cookie } = {}) {
  const h = { ...raw, host: FORCED_AUTHORITY };
  const self = `http://${FORCED_AUTHORITY}`;
  if (h.origin !== undefined) h.origin = self;
  if (h.referer !== undefined) h.referer = self + '/';
  if (cookie) h.cookie = cookie;
  delete h['accept-encoding'];
  return h;
}

const DSH_COOKIE = dshSessionCookiePair(FORCED_AUTHORITY);

function collect(stream) {
  return new Promise((resolve, reject) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => (body += c));
    stream.on('end', () => resolve(body));
    stream.on('error', reject);
  });
}

function fetchUpstream(pathname, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: 'GET', path: pathname,
        headers: upstreamHeaders(extraHeaders, { cookie: DSH_COOKIE }),
      },
      async (res) => resolve({ status: res.statusCode || 502, headers: res.headers, body: await collect(res) })
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('上游超时')); });
    req.end();
  });
}

function sendHtml(res, { status = 200, body, setCookies = [], headers = {}, req, mobile }) {
  const patched = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, CLIENT_PATCH + '</body>') : body + CLIENT_PATCH;
  // 排版样式一律注入（手机版带 860px 断点、平板版由客户端脚本按触控能力打开）。
  // 不再按 UA 决定是否注入 —— iPad 的 UA 是 Mac，服务端认不出来。
  // 只有显式 mobile:false（即 ?mobile=0）才完全不注入，作为紧急回退开关。
  const enabled = typeof mobile === 'boolean' ? mobile : true;
  const withMobile = enabled ? injectMobile(patched, 'on') : patched;
  // PWA 标签始终注入（桌面端加了也无害：图标 + 主题色）
  const buf = Buffer.from(injectPwa(withMobile), 'utf8');
  const out = { ...headers };
  delete out['content-length'];
  delete out['content-encoding'];
  delete out['transfer-encoding'];
  out['content-type'] = 'text/html; charset=utf-8';
  out['content-length'] = String(buf.length);
  // 强禁用缓存：手机浏览器会缓存 HTML，导致改动不生效（踩过）
  out['cache-control'] = 'no-store, no-cache, must-revalidate, max-age=0';
  out['pragma'] = 'no-cache';
  out['expires'] = '0';
  if (setCookies.length) out['set-cookie'] = setCookies;
  res.writeHead(status, out);
  res.end(buf);
}

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
  });
  res.end(buf);
}

// ─────────────────────────── 设备登记 ───────────────────────────
function findApprovedByIp(ip) {
  return Object.values(state.devices).find((d) => d.ip === ip && d.status === 'approved');
}

function registerPending(ip, userAgent) {
  // 同一 IP 上已有记录就复用，避免每次刷新都新增一条
  const existing = Object.values(state.devices).find((d) => d.ip === ip && d.status === 'pending');
  if (existing) return existing;
  const device = {
    id: newDeviceId(),
    ip,
    label: deviceLabel(userAgent),
    userAgent: String(userAgent || '').slice(0, 300),
    status: 'pending',
    firstSeen: Date.now(),
  };
  state.devices[device.id] = device;
  save(state);
  log(`新设备待批准: ${device.label} @ ${ip}  (${device.id})`);
  return device;
}

// ─────────────────────────── 管理 API（仅回环） ───────────────────────────
function listDevices() {
  const all = Object.values(state.devices);
  const by = (s) => all.filter((d) => d.status === s).sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0));
  return { pending: by('pending'), approved: by('approved'), denied: by('denied') };
}

async function handleAdmin(req, res, ip) {
  if (!isSelf(ip)) {
    log(`拒绝非本机访问管理接口: ${ip}`);
    return sendJson(res, 403, { error: '管理接口只允许在电脑本机访问' });
  }

  const url = new URL(req.url || '/', 'http://x');

  if (req.method === 'GET' && (url.pathname === ADMIN_PATH || url.pathname === ADMIN_PATH + '/')) {
    const { pending, approved, denied } = listDevices();
    return sendHtml(res, {
      body: adminPage({ pending, approved, denied, listenPort: LISTEN_PORT, upstream: FORCED_AUTHORITY }),
    });
  }

  if (req.method === 'POST' && url.pathname === '/__langate/admin/action') {
    let payload = {};
    try { payload = JSON.parse(await collect(req)); } catch { /* 空体也接受 */ }
    const action = payload.action;
    const id = payload.id;

    if (action === 'revoke-all') {
      const n = Object.values(state.devices).filter((d) => d.status === 'approved').length;
      for (const d of Object.values(state.devices)) if (d.status === 'approved') d.status = 'denied';
      save(state);
      log(`撤销全部已批准设备（${n} 台）`);
      return sendJson(res, 200, { ok: true, revoked: n });
    }

    const device = id ? state.devices[id] : undefined;
    if (!device) return sendJson(res, 404, { error: '找不到该设备' });

    if (action === 'approve') {
      device.status = 'approved';
      device.approvedAt = Date.now();
      save(state);
      log(`已批准: ${device.label} @ ${device.ip}`);
    } else if (action === 'deny') {
      device.status = 'denied';
      save(state);
      log(`已拒绝: ${device.label} @ ${device.ip}`);
    } else if (action === 'revoke') {
      device.status = 'denied';
      save(state);
      log(`已撤销: ${device.label} @ ${device.ip}`);
    } else {
      return sendJson(res, 400, { error: '未知动作' });
    }
    return sendJson(res, 200, { ok: true, device: { id: device.id, status: device.status } });
  }

  return sendJson(res, 404, { error: 'not found' });
}

/** 等待批准页面轮询用：只暴露状态，不暴露其他信息。 */
function handleStatusPoll(res, deviceId) {
  const d = deviceId ? state.devices[deviceId] : undefined;
  sendJson(res, 200, { status: d ? d.status : 'unknown' });
}

// ─────────────────────────── 主处理 ───────────────────────────
const server = http.createServer(async (clientReq, clientRes) => {
  stats.http++;
  const ip = clientIp(clientReq);
  const url = new URL(clientReq.url || '/', 'http://x');

  // 0) 限流（管理接口不限，免得被自己锁住）
  if (!url.pathname.startsWith('/__langate')) {
    const rl = takeRateLimit(state, ip, RATE_LIMIT);
    if (!rl.allowed) {
      stats.blocked++;
      return sendHtml(clientRes, { status: 429, body: rateLimitedPage({ retryAfterSec: rl.retryAfterSec }) });
    }
  }

  // 1) 网关自有资源：PWA 清单与图标（公开，供主屏幕图标抓取）
  //    宿主自己那个 `<link rel="manifest" href="./manifest.webmanifest">` 排在前面，
  //    浏览器只认第一个，所以这里**直接接管该路径** —— 同一个链接返回我们的清单。
  if (url.pathname === MANIFEST_PATH || url.pathname === '/manifest.webmanifest') {
    const body = Buffer.from(JSON.stringify(buildManifest(), null, 2), 'utf8');
    clientRes.writeHead(200, {
      'content-type': 'application/manifest+json; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-cache',
    });
    return clientRes.end(body);
  }
  // 图标：从 assets/ 读取真图（tools/make-icons.py 生成）
  const icon = readIcon(url.pathname);
  if (icon) {
    // 记一笔：iOS「添加到主屏幕」会不会来取图标，看这条日志就能确认
    log(`图标请求: ${url.pathname} ← ${ip} ${deviceLabel(clientReq.headers['user-agent'])}`);
    clientRes.writeHead(200, {
      'content-type': icon.type,
      'content-length': String(icon.buf.length),
      'cache-control': 'public, max-age=86400',
    });
    return clientRes.end(icon.buf);
  }

  // 2) 管理接口与诊断：管理接口只允许电脑本机；DOM 上报允许已批准设备提交
  if (url.pathname.startsWith('/__langate')) {
    if (url.pathname === '/__langate/status') return handleStatusPoll(clientRes, url.searchParams.get('d'));

    if (url.pathname === '/__langate/domreport' && clientReq.method === 'POST') {
      try {
        const raw = await collect(clientReq);
        const payload = JSON.parse(raw);
        saveDomReport({ ip, ...payload });
        log(`收到 DOM 上报: 视口 ${payload.vw}×${payload.vh}，节点 ${(payload.tree || []).length} 个`);
      } catch (e) {
        log('DOM 上报解析失败: ' + e.message);
      }
      return sendJson(clientRes, 200, { ok: true });
    }

    return handleAdmin(clientReq, clientRes, ip);
  }

  // 2) 设备门禁：本机直通；否则必须有已批准的设备令牌
  if (isSelf(ip)) {
    // 这台电脑自己访问（回环或本机网卡地址）：直接走代理，不登记为「设备」
  } else {
    const cookies = parseCookies(clientReq.headers.cookie);
    const deviceId = verifyDeviceToken(cookies.langate_device);
    const device = deviceId ? state.devices[deviceId] : undefined;

    if (!device || device.status !== 'approved') {
      // 同一 IP 已批准过 → 自动认领（防止浏览器丢 Cookie 后静态资源被卡）
      // 注意排除本机：本机访问本来就走直通，不应参与 IP 认领（踩过：导致本机被 302）
      const known = isSelf(ip) ? undefined : findApprovedByIp(ip);
      if (known) {
        if (url.pathname === '/' || String(clientReq.headers.accept || '').includes('text/html')) {
          clientRes.writeHead(302, { location: '/', 'set-cookie': deviceCookieHeader(known.id), 'cache-control': 'no-store' });
          return clientRes.end();
        }
        // 资源请求：本响应无法种 Cookie 生效，仍放行以保证页面可用
      } else {
        const pending = device && device.status === 'pending'
          ? device
          : device && device.status === 'denied'
            ? device
            : registerPending(ip, clientReq.headers['user-agent']);

        if (pending.status === 'denied') {
          stats.blocked++;
          return sendHtml(clientRes, {
            status: 403,
            body: `<!doctype html><meta charset="utf-8"><title>已拒绝</title>
<body style="font:15px system-ui;padding:28px;background:#f5f6f8">
<h1 style="font-size:18px">这台设备已被拒绝</h1>
<p>如需访问，请在电脑上重新批准。</p></body>`,
          });
        }

        stats.blocked++;
        return sendHtml(clientRes, {
          status: 200,
          body: waitingPage({ ip: pending.ip, label: pending.label, deviceId: pending.id }),
        });
      }
    }
  }

  // 3) 已通过门禁 → 转发到 DSH，并带上自签会话 Cookie
  const headers = upstreamHeaders(clientReq.headers, { cookie: DSH_COOKIE });

  const upstream = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: clientReq.method, path: clientReq.url, headers },
    async (upstreamRes) => {
      // 未认证 + 页面导航 → 替它补登录并回首页；API/资源的 401 原样透传
      if (upstreamRes.statusCode === 401) {
        const accept = String(clientReq.headers.accept || '');
        const isNavigation =
          clientReq.method === 'GET' && accept.includes('text/html') && !String(clientReq.url || '').startsWith('/api');
        if (!isNavigation) {
          const h = { ...upstreamRes.headers };
          delete h['content-encoding'];
          clientRes.writeHead(401, h);
          upstreamRes.pipe(clientRes);
          return;
        }
        stats.autoLogin++;
        upstreamRes.resume();
        try {
          const page = await fetchUpstream('/');
          sendHtml(clientRes, { body: page.body, headers: page.headers, setCookies: [DSH_COOKIE + '; Path=/; HttpOnly; SameSite=Lax'], req: clientReq });
        } catch (e) {
          sendJson(clientRes, 502, { error: '自动登录失败: ' + e.message });
        }
        return;
      }

      const outHeaders = { ...upstreamRes.headers };
      if (outHeaders['set-cookie']) {
        outHeaders['set-cookie'] = outHeaders['set-cookie'].map((v) =>
          v.split(';').filter((p) => {
            const k = p.trim().toLowerCase();
            return !k.startsWith('domain=') && !k.startsWith('secure');
          }).join(';')
        );
      }

      const isHtml = typeof outHeaders['content-type'] === 'string' && outHeaders['content-type'].includes('text/html');
      if (!isHtml) {
        delete outHeaders['content-encoding'];
        clientRes.writeHead(upstreamRes.statusCode || 502, outHeaders);
        upstreamRes.pipe(clientRes);
        return;
      }
      const body = await collect(upstreamRes);
      // 手机排版：env 策略 + 允许 ?mobile=1/0 临时覆盖（便于手机上一键对比效果）
      const q = url.searchParams.get('mobile');
      const mobileOverride = q === '1' ? true : q === '0' ? false : undefined;
      sendHtml(clientRes, {
        status: upstreamRes.statusCode || 200, body, headers: outHeaders, req: clientReq,
        mobile: mobileOverride !== undefined ? mobileOverride
          : MOBILE_MODE === 'on' ? true
          : MOBILE_MODE === 'off' ? false
          : undefined,
      });
    }
  );

  upstream.on('error', (e) => {
    stats.upstreamErrors++;
    log('上游错误: ' + e.message);
    if (!clientRes.headersSent) sendJson(clientRes, 502, { error: '无法连接上游 DSH: ' + e.message });
    else clientRes.end();
  });

  clientReq.pipe(upstream);
});

// ─────────────────────────── WebSocket ───────────────────────────
server.on('upgrade', (clientReq, clientSocket, head) => {
  const ip = clientIp(clientReq);
  // WS 也要过门禁：本机直通，否则必须已批准
  if (!isSelf(ip)) {
    const cookies = parseCookies(clientReq.headers.cookie);
    const deviceId = verifyDeviceToken(cookies.langate_device);
    const device = deviceId ? state.devices[deviceId] : undefined;
    const ok = (device && device.status === 'approved') || !!findApprovedByIp(ip);
    if (!ok) {
      stats.blocked++;
      log(`拒绝未批准设备的 WS: ${ip}`);
      clientSocket.destroy();
      return;
    }
  }

  stats.ws++;
  log('WS 升级: ' + clientReq.url);

  const upstreamSocket = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headers = upstreamHeaders(clientReq.headers, { cookie: DSH_COOKIE });
    const lines = [`GET ${clientReq.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((vv) => lines.push(`${k}: ${vv}`));
      else lines.push(`${k}: ${v}`);
    }
    upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  const kill = (why) => {
    try { clientSocket.destroy(); } catch {}
    try { upstreamSocket.destroy(); } catch {}
    if (why) log('WS 断开: ' + why);
  };
  upstreamSocket.on('error', (e) => kill('上游 ' + e.message));
  clientSocket.on('error', (e) => kill('客户端 ' + e.message));
  clientSocket.on('close', () => kill());
});

// ─────────────────────────── 启动 ───────────────────────────
// 守卫必须在 listen 之前：先监听再关闭会留下一个能被扫到的窗口
if (!passNetworkGuard()) process.exit(0);

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  log(`lan-gate 已启动（门禁开启）→ 上游 ${FORCED_AUTHORITY}`);
  log(`管理台（仅本机）: http://127.0.0.1:${LISTEN_PORT}${ADMIN_PATH}`);
  for (const ip of ips) log(`手机访问: http://${ip}:${LISTEN_PORT}`);
  log(`状态文件: ${STATE_PATH}`);
  const { pending, approved } = listDevices();
  log(`设备: 已批准 ${approved.length} · 待批准 ${pending.length}`);
});

process.on('SIGINT', () => {
  const sec = Math.round((Date.now() - startedAt) / 1000);
  log(`退出。运行 ${sec}s · HTTP ${stats.http} · WS ${stats.ws} · 拦截 ${stats.blocked} · 自动登录 ${stats.autoLogin} · 上游错误 ${stats.upstreamErrors}`);
  process.exit(0);
});
