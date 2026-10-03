/**
 * 端到端验证：模拟手机（不带任何凭据）访问网关，检查是否自动完成认证并拿到界面。
 */
import http from 'node:http';
import { GATE_HOST, GATE_PORT, LAN_IP, LAN_HOST, hasLanIp, detectLanIp } from './config.mjs';

const GATE = { host: GATE_HOST, port: GATE_PORT };

function get(host, port, path, headers = {}, jar = {}) {
  // 模拟真实浏览器：带 Accept: text/html、自动跟随 302、保存 Cookie
  const h = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
    ...headers,
  };
  const jarKeys = Object.keys(jar);
  if (jarKeys.length) h.cookie = jarKeys.map((k) => `${k}=${jar[k]}`).join('; ');

  return new Promise((resolve) => {
    const req = http.request({ host, port, path, method: 'GET', headers: h }, (res) => {
      for (const c of res.headers['set-cookie'] || []) {
        const pair = c.split(';')[0];
        const at = pair.indexOf('=');
        if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
      }
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        res.on('end', () => {
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? new URL(loc) : new URL(loc, `http://${host}:${port}${path}`);
          resolve(get(next.hostname, Number(next.port) || port, next.pathname + next.search, headers, jar));
        });
        return;
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (n, ok, d) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' → ' + d : '')); } };

  console.log('=== 场景 1：手机首次访问（无任何 Cookie）===');
  const first = await get(GATE.host, GATE.port, '/', { host: LAN_HOST });
  if (first.error) { console.log('  ERR ' + first.error); process.exit(1); }
  console.log('  HTTP ' + first.status);
  const setCookie = first.headers['set-cookie'];
  console.log('  Set-Cookie: ' + (setCookie ? setCookie.map((c) => c.split(';')[0].slice(0, 34) + '…').join(' | ') : '(无)'));
  console.log('  Content-Type: ' + first.headers['content-type']);
  console.log('  正文字节数: ' + Buffer.byteLength(first.body, 'utf8'));
  console.log('  是否已注入网关注入（polyfill / 移动端）: ' + (/randomUUID/.test(first.body) ? '✓ 是' : '✗ 否'));
  console.log('  移动端注入（langate-mobile-css）: ' + (/langate-mobile-css/.test(first.body) ? '✓ 有' : '（桌面 UA 时正常无）'));
  console.log('  是否含 DSH 前端入口: ' + (/<script|assets\//.test(first.body) ? '✓ 是' : '✗ 否'));
  console.log('  是否仍是 401 文案: ' + (first.body.includes('authentication required') ? '✗ 是（失败）' : '✓ 否'));

  console.log('\n=== 场景 2：手机带着 Cookie 再次访问 ===');
  if (setCookie) {
    const cookiePair = setCookie.map((c) => c.split(';')[0]).join('; ');
    const second = await get(GATE.host, GATE.port, '/', { host: LAN_HOST, cookie: cookiePair });
    console.log('  HTTP ' + (second.status || 'ERR ' + second.error));
    console.log('  正文字节数: ' + (second.body ? Buffer.byteLength(second.body, 'utf8') : 0));
  } else {
    console.log('  （没有 Cookie，跳过）');
  }

  console.log('\n=== 场景 3：走局域网 IP（真实手机路径）===');
  let lan = null;
  if (!hasLanIp) {
    console.log('  （跳过：未提供本机局域网 IP）');
    console.log('   要跑这条用例：$env:DSH_LAN_IP=\'' + (detectLanIp() || '你的局域网IP') + '\'; node test\\run-all.mjs');
  } else {
    lan = await get(LAN_IP, GATE.port, '/', { host: LAN_HOST });
    if (lan.error) { console.log('  ERR ' + lan.error); }
    else {
      console.log('  HTTP ' + lan.status);
      console.log('  正文字节数: ' + Buffer.byteLength(lan.body, 'utf8'));
      console.log('  注入补丁: ' + (/randomUUID/.test(lan.body) ? '✓' : '✗'));
    }
  }

  console.log('\n=== 场景 4：静态资源能否透传（抽一个 assets 路径）===');
  let assetOk = null;
  const m = first.body && first.body.match(/src="([^"]*assets\/[^"]+)"/);
  if (m) {
    const p = m[1].startsWith('/') ? m[1] : '/' + m[1];
    const asset = await get(GATE.host, GATE.port, p, { host: LAN_HOST });
    assetOk = asset.status;
    console.log('  路径 ' + p.slice(0, 50) + ' → HTTP ' + (asset.status || 'ERR ' + asset.error) + '  ' + (asset.headers ? asset.headers['content-type'] : ''));
  } else {
    console.log('  （首页里没找到 assets 引用，跳过）');
  }

  console.log('\n=== 断言 ===');
  check('场景1 首次访问返回 200（无需令牌即完成认证）', first.status === 200, 'status=' + first.status);
  check('场景1 含有网关注入（randomUUID polyfill）', /randomUUID/.test(first.body || ''));
  check('场景1 含手机排版注入', /langate-mobile-css/.test(first.body || ''));
  check('场景1 含 DSH 前端入口', /<script|assets\//.test(first.body || ''));
  check('场景1 不是 401 文案', !(first.body || '').includes('authentication required'));
  if (hasLanIp) {
    check('场景3 走局域网 IP 也返回 200', lan && lan.status === 200, lan ? 'status=' + lan.status : 'ERR');
  } else {
    console.log('  - 场景3 已跳过（未提供 DSH_LAN_IP）');
  }
  if (assetOk !== null) check('场景4 静态资源可透传（200）', assetOk === 200, 'status=' + assetOk);

  console.log('\n────────────────────────');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
