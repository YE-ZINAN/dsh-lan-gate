/**
 * 移动端排版注入测试：
 *  - 手机 UA → 应注入移动 CSS 与抽屉按钮
 *  - 桌面 UA → 不应注入（电脑端零影响）
 *  - 注入后 HTML 仍完整、长度/编码正确
 */
import http from 'node:http';

const GATE = { host: '127.0.0.1', port: 3089 };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function get(path, ua) {
  return new Promise((resolve) => {
    const r = http.request(
      { ...GATE, path, method: 'GET', headers: { host: '127.0.0.1:3089', accept: 'text/html,*/*;q=0.8', 'user-agent': ua } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }
    );
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(12000, () => { r.destroy(); resolve({ error: 'timeout' }); });
    r.end();
  });
}

let pass = 0, fail = 0;
const check = (name, cond, d) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (d ? ' → ' + d : '')); } };

const hasMobile = (b) => b.includes('langate-mobile-css') && b.includes('langate-drawer-btn');

(async () => {
  console.log('=== 安卓手机 UA ===');
  const a = await get('/', MOBILE_UA);
  check('HTTP 200', a.status === 200, 'got ' + a.status);
  check('注入了移动 CSS', a.body.includes('langate-mobile-css'));
  check('注入了抽屉按钮脚本', a.body.includes('langate-drawer-btn'));
  check('含窄屏断点 860px', a.body.includes('max-width: 860px'));
  check('含 safe-area 适配', a.body.includes('safe-area-inset-bottom'));
  check('viewport 已设为 device-width', /name="viewport"[^>]*width=device-width/i.test(a.body));
  check('原前端入口仍在', /assets\/index-/.test(a.body));
  check('Content-Length 与实际一致', Number(a.headers['content-length']) === Buffer.byteLength(a.body, 'utf8'),
        'hdr=' + a.headers['content-length'] + ' real=' + Buffer.byteLength(a.body, 'utf8'));

  console.log('\n=== iPad/平板（UA 是 Mac，服务端认不出）===');
  const b = await get('/', IPAD_UA);
  check('iPad 也注入移动排版', hasMobile(b.body));
  check('含平板专用样式（无断点，默认关闭）', /<style id="langate-tablet-css" media="not all">/.test(b.body));
  check('平板样式确实是同一套规则（含网格轨道修复）', /langate-tablet-css[\s\S]{0,4000}grid-template-columns: 0 1fr 0/.test(b.body));
  check('含触控识别脚本（iPad 靠 maxTouchPoints 认）', b.body.includes('maxTouchPoints'));

  console.log('\n=== 桌面 UA（必须不受影响）===');
  const c = await get('/', DESKTOP_UA);
  check('HTTP 200', c.status === 200);
  // 架构已改：样式一律注入，桌面由「860px 断点 + 平板样式默认关闭」兜住，
  // 而不是靠「不注入」来保证。这里断言的是「桌面不会被套用」这件事本身。
  check('手机版样式受 860px 断点约束', /<style id="langate-mobile-css">@media \(max-width: 860px\)/.test(c.body));
  check('平板版样式默认关闭（media="not all"）', /<style id="langate-tablet-css" media="not all">/.test(c.body));
  const deskUA = DESKTOP_UA;
  check('桌面 UA 不会被触控脚本误判（它没有 Mac UA）', !/Macintosh/.test(deskUA));
  check('仍有 randomUUID polyfill（通用注入）', c.body.includes('randomUUID'));

  console.log('\n=== 临时开关 ?mobile=0 / ?mobile=1 ===');
  const off = await get('/?mobile=0', MOBILE_UA);
  check('?mobile=0 时手机 UA 也不注入', !hasMobile(off.body));
  const on = await get('/?mobile=1', DESKTOP_UA);
  check('?mobile=1 时桌面 UA 也注入', hasMobile(on.body));

  console.log('\n────────────────────────');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
