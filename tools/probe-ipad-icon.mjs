/**
 * 诊断：iPad 实际拿到的图标相关标签与图标响应。
 * 用 iPad 真实 UA（Macintosh + Safari 26）请求。
 */
import http from 'node:http';

const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15';
// 默认走回环：回环绕过门禁，不会把本机登记成一台「设备」污染状态文件。
// 要测真实局域网路径（会在状态文件里留下一台待批准设备）：
//   node tools/probe-ipad-icon.mjs <你的局域网IP>
const HOST = process.argv[2] || '127.0.0.1';
const PORT = 3089;

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request(
      { host: HOST, port: PORT, path, method: 'GET',
        headers: { host: `${HOST}:${PORT}`, 'user-agent': IPAD_UA, accept: '*/*', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(15000, () => { r.destroy(); resolve({ error: 'timeout' }); });
    r.end();
  });
}

console.log('=== 1. 页面里所有 icon / manifest 标签（按出现顺序）===');
const page = await get('/?mobile=1', { accept: 'text/html' });
const html = page.body.toString('utf8');
const tags = html.match(/<link[^>]*(?:icon|manifest)[^>]*>|<base[^>]*>/gi) || [];
tags.forEach((t, i) => console.log('  ' + (i + 1) + '. ' + t));

const ati = tags.filter((t) => /apple-touch-icon/i.test(t));
console.log('\n  apple-touch-icon 数量: ' + ati.length + (ati.length > 1 ? '  ← 多个，iOS 取最后一个' : ''));
console.log('  base 标签: ' + (tags.find((t) => /<base/i.test(t)) || '(无)'));

console.log('\n=== 2. 图标资源能否取到 ===');
for (const p of ['/__langate/icon-180.png', '/__langate/icon-192.png', '/__langate/icon-512.png', '/__langate/icon-maskable-512.png']) {
  const r = await get(p);
  if (r.error) { console.log('  ' + p + '  ERR ' + r.error); continue; }
  const isPng = r.body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const cl = Number(r.headers['content-length']);
  console.log('  ' + p);
  console.log('      HTTP ' + r.status + '  type=' + r.headers['content-type'] + '  实际字节=' + r.body.length +
              '  content-length=' + cl + (cl === r.body.length ? ' ✓一致' : ' ✗不一致'));
  console.log('      是 PNG: ' + isPng + (isPng ? ('  尺寸 ' + r.body.readUInt32BE(16) + 'x' + r.body.readUInt32BE(20)) : ''));
}

console.log('\n=== 3. manifest ===');
const man = await get('/manifest.webmanifest');
console.log('  HTTP ' + man.status + '  type=' + man.headers['content-type']);
try {
  const j = JSON.parse(man.body.toString('utf8'));
  console.log('  name=' + j.name + '  display=' + j.display);
  (j.icons || []).forEach((i) => console.log('    icon ' + i.sizes + '  ' + i.purpose + '  ' + i.src));
} catch (e) { console.log('  解析失败: ' + e.message); }
