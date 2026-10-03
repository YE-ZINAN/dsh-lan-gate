/** 精确验证：手机/平板/桌面三类的排版注入行为（用 <style id> 判定） */
import http from 'node:http';

const UAS = [
  ['iPad Safari（伪装 Mac）', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15'],
  ['iPad 旧式 UA', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['安卓手机', 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'],
  ['Windows 桌面', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'],
  ['Mac 笔记本（非 iPad）', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
];

function get(ua, path = '/') {
  return new Promise((r) => {
    const q = http.request(
      { host: '127.0.0.1', port: 3089, path, headers: { host: '127.0.0.1:3089', accept: 'text/html', 'user-agent': ua } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r(b)); }
    );
    q.on('error', () => r(''));
    q.end();
  });
}

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' → ' + d : '')); } };

console.log('=== 各 UA 的注入情况 ===');
console.log('UA'.padEnd(26) + '手机版(860断点)  平板版(无断点,默认关)  平板脚本  抽屉  viewport');
for (const [label, ua] of UAS) {
  const b = await get(ua);
  const mobile = /<style id="langate-mobile-css">/.test(b);
  const tablet = /<style id="langate-tablet-css" media="not all">/.test(b);
  const detect = /maxTouchPoints/.test(b);
  const drawer = /langate-drawer-btn/.test(b);
  const vp = /name="viewport"[^>]*width=device-width/.test(b);
  console.log(label.padEnd(24) + String(mobile).padEnd(17) + String(tablet).padEnd(23) + String(detect).padEnd(10) + String(drawer).padEnd(6) + vp);
}

console.log('\n=== 结构断言 ===');
const ipad = await get(UAS[0][1]);
check('iPad：手机版样式存在（带 860px 断点）', /<style id="langate-mobile-css">@media \(max-width: 860px\)/.test(ipad));
check('iPad：平板版样式存在且默认关闭（media="not all"）', /<style id="langate-tablet-css" media="not all">/.test(ipad));
check('iPad：平板版是同一套规则（含网格轨道修复）', /langate-tablet-css[\s\S]{0,4000}grid-template-columns: 0 1fr 0/.test(ipad));
check('iPad：含触控识别脚本', /maxTouchPoints/.test(ipad));
check('iPad：抽屉按钮显隐已考虑平板', /IS_TABLET|langate-tablet/.test(ipad));

// 桌面：不应有任何「无断点」规则生效路径被自动打开，但样式会被注入（由断点兜住）
const win = await get(UAS[3][1]);
check('Windows 桌面：平板版默认关闭（不会自动打开）', /media="not all"/.test(win));
check('Windows 桌面：手机版仍受 860px 断点约束', /@media \(max-width: 860px\)/.test(win));

console.log('\n=== 回退开关 ===');
const off = await get(UAS[2][1], '/?mobile=0');
check('?mobile=0 → 完全不注入样式', !/<style id="langate-mobile-css">/.test(off) && !/langate-tablet-css/.test(off));
const on = await get(UAS[3][1], '/?mobile=1');
check('?mobile=1 → 桌面 UA 也注入（用于临时对比）', /<style id="langate-mobile-css">/.test(on));

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' · 失败 ' + fail);
process.exit(fail ? 1 : 0);
