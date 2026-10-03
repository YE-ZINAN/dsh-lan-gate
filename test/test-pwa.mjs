/**
 * PWA 验证：manifest 可解析、图标可读取且尺寸正确、HTML 注入了必需标签。
 */
import http from 'node:http';

const PORT = 3089;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method: 'GET', headers: { host: '127.0.0.1:3089', 'user-agent': MOBILE_UA, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(20000, () => { r.destroy(); resolve({ error: 'timeout' }); });
    r.end();
  });
}

/** 从 PNG 头部读尺寸（IHDR 在偏移 16/20）。 */
function pngSize(buf) {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' → ' + d : '')); } };

console.log('=== 1. manifest ===');
const m = await get('/__langate/manifest.webmanifest');
check('HTTP 200', m.status === 200, 'got ' + m.status);
check('Content-Type 正确', /application\/manifest\+json/.test(m.headers['content-type'] || ''), m.headers['content-type']);
let man = null;
try { man = JSON.parse(m.body.toString('utf8')); check('JSON 可解析', true); } catch (e) { check('JSON 可解析', false, e.message); }
if (man) {
  check('name 非空', !!man.name, man.name);
  check('short_name ≤ 12 字符', (man.short_name || '').length <= 12, man.short_name);
  check('display = standalone', man.display === 'standalone', man.display);
  check('scope = /', man.scope === '/', man.scope);
  check('含 192 图标', (man.icons || []).some((i) => i.sizes === '192x192'));
  check('含 512 图标', (man.icons || []).some((i) => i.sizes === '512x512'));
  check('含 maskable 图标', (man.icons || []).some((i) => i.purpose === 'maskable'));
  check('theme_color 存在', !!man.theme_color, man.theme_color);
  check('background_color 存在', !!man.background_color, man.background_color);
}

console.log('\n=== 2. 图标（真实图片，非自绘）===');
const iconSpecs = [
  ['/__langate/icon-192.png', 192],
  ['/__langate/icon-512.png', 512],
  ['/__langate/icon-180.png', 180],
  ['/__langate/icon-maskable-512.png', 512],
];
for (const [path, size] of iconSpecs) {
  const r = await get(path);
  const ok = r.status === 200;
  check(path + ' → HTTP 200', ok, 'got ' + r.status);
  if (!ok) continue;
  check(path + ' → PNG 魔数', r.body.slice(0, 8).equals(PNG_MAGIC));
  const [w, h] = pngSize(r.body);
  check(path + ' → 尺寸 ' + size + 'x' + size, w === size && h === size, w + 'x' + h);
  check(path + ' → 内容非空（>' + 10 + 'KB）', r.body.length > 10240, r.body.length + ' 字节');
  check(path + ' → Content-Type 为 PNG', /image\/png/.test(r.headers['content-type'] || ''), r.headers['content-type']);
}

console.log('\n=== 2b. 不存在的图标不能误伤 ===');
const bogus = await get('/__langate/icon-999.png');
check('未知图标路径不被图标路由接走', !/image\/png/.test(bogus.headers['content-type'] || ''), bogus.headers['content-type']);

console.log('\n=== 3. HTML 注入的 PWA 标签 ===');
const h = await get('/', { accept: 'text/html' });
const html = h.body.toString('utf8');
check('HTTP 200', h.status === 200, 'got ' + h.status);
check('apple-touch-icon 指向 180 PNG', /rel="apple-touch-icon"[^>]*icon-180\.png/.test(html));
check('favicon 指向 192 PNG', /rel="icon"[^>]*icon-192\.png/.test(html));
check('apple-mobile-web-app-capable（iOS 全屏关键）', /apple-mobile-web-app-capable/.test(html));
check('apple-mobile-web-app-status-bar-style', /apple-mobile-web-app-status-bar-style/.test(html));
check('theme-color', /name="theme-color"/.test(html));
check('未重复注入第二个 manifest 链接', (html.match(/rel="manifest"/g) || []).length === 1,
  '找到 ' + (html.match(/rel="manifest"/g) || []).length + ' 个');

console.log('\n=== 3b. 接管宿主的 manifest 路径 ===');
const hostManifest = await get('/manifest.webmanifest');
check('宿主路径 /manifest.webmanifest 返回 200', hostManifest.status === 200, 'got ' + hostManifest.status);
let hm = null;
try { hm = JSON.parse(hostManifest.body.toString('utf8')); } catch {}
check('该路径返回的是我们的清单（name 含 口袋版）', !!hm && /口袋版/.test(hm.name || ''), hm ? hm.name : '解析失败');
check('display = standalone（不是宿主的 fullscreen）', !!hm && hm.display === 'standalone', hm ? hm.display : '-');

console.log('\n=== 4. 移动端排版未被破坏（回归） ===');
check('移动 CSS 仍在', /langate-mobile-css/.test(html));
check('网格修复仍在', /grid-template-columns: 0 1fr 0/.test(html));

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' · 失败 ' + fail);
process.exit(fail ? 1 : 0);
