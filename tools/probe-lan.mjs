/** 看走局域网 IP 时实际返回的是什么内容 */
import http from 'node:http';

function get(host, port, path, headers = {}, jar = {}) {
  return new Promise((resolve) => {
    const h = {
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
      ...headers,
    };
    const ks = Object.keys(jar);
    if (ks.length) h.cookie = ks.map((k) => `${k}=${jar[k]}`).join('; ');
    const req = http.request({ host, port, path, method: 'GET', headers: h }, (res) => {
      for (const c of res.headers['set-cookie'] || []) {
        const pair = c.split(';')[0]; const at = pair.indexOf('=');
        if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
      }
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        res.on('end', () => {
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? new URL(loc) : new URL(loc, `http://${host}:${port}${path}`);
          console.log('  → 重定向到 ' + next.href);
          resolve(get(next.hostname, Number(next.port) || port, next.pathname + next.search, headers, jar));
        });
        return;
      }
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

// 局域网 IP 从命令行取，不写死。用法: node tools/probe-lan.mjs 192.168.1.23
const HOST_ARG = process.argv[2];
if (!HOST_ARG) {
  console.log('用法: node tools/probe-lan.mjs <本机局域网IP>');
  console.log('  例: node tools/probe-lan.mjs 192.168.1.23');
  console.log('（本机 IP 可用 ipconfig 查看，或看网关 status 输出）');
  process.exit(1);
}

console.log(`=== 走局域网 IP ${HOST_ARG}:3089 ===`);
const r = await get(HOST_ARG, 3089, '/');
console.log('  HTTP ' + r.status);
console.log('  字节 ' + Buffer.byteLength(r.body || '', 'utf8'));
const b = r.body || '';
console.log('  是等待批准页: ' + /等待电脑批准/.test(b));
console.log('  是 DSH 页面:  ' + /assets\/index-/.test(b));
console.log('  是 401 文案:  ' + /authentication required/.test(b));
console.log('  含移动CSS:    ' + /langate-mobile-css/.test(b));
console.log('  开头 300 字符:');
console.log('    ' + b.slice(0, 300).replace(/\s+/g, ' '));

console.log('\n=== 对照：回环 127.0.0.1:3089 ===');
const r2 = await get('127.0.0.1', 3089, '/');
console.log('  HTTP ' + r2.status + '  字节 ' + Buffer.byteLength(r2.body || '', 'utf8'));
