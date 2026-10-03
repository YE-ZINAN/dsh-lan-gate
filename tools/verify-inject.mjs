/** 验证注入的 HTML 里 CSS 是否结构完整、规则是否真的在 @media 内 */
import http from 'node:http';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

function get(path) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 3089, path, method: 'GET', headers: { host: '127.0.0.1:3089', accept: 'text/html', 'user-agent': UA } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b));
    });
    r.on('error', () => resolve(''));
    r.end();
  });
}

const html = await get('/');
console.log('HTML 长度: ' + html.length);

const styleStart = html.indexOf('<style id="langate-mobile-css">');
const styleEnd = html.indexOf('</style>', styleStart);
console.log('找到 mobile <style>: ' + (styleStart >= 0));
if (styleStart < 0) process.exit(1);

const css = html.slice(styleStart + '<style id="langate-mobile-css">'.length, styleEnd);
console.log('CSS 长度: ' + css.length);

// 关键：这些选择器是否出现在 @media(max-width:860px) 之内
const mediaIdx = css.indexOf('@media (max-width: 860px)');
console.log('含 860px 媒体查询: ' + (mediaIdx >= 0) + '  位置 ' + mediaIdx);

// 检查花括号配平（截断会导致后续规则失效）
let depth = 0, bad = -1;
for (let i = 0; i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}') { depth--; if (depth < 0) { bad = i; break; } }
}
console.log('花括号配平: ' + (depth === 0 && bad < 0 ? '✓ 平衡' : '✗ 不平衡（结束深度 ' + depth + (bad >= 0 ? '，多余 } 在 ' + bad : '') + '）'));

// 逐条断言关键规则在位，且都在 @media 内
const checks = [
  ['BynINW_sidebarCol 让位', '.BynINW_sidebarCol {'],
  ['_2H3hWW_root 抽屉定位', '._2H3hWW_root {'],
  ['_2H3hWW_collapsed 移出屏幕', '._2H3hWW_root._2H3hWW_collapsed {'],
  ['隐藏会话题头槽', '[data-slot="conversation.header"]'],
  ['隐藏 tab 栏', '[data-conversation-tabs]'],
  ['隐藏 profile 浮层', '.dsh-skin-qq2005-profile,'],
  ['隐藏 strip 浮层', '.dsh-skin-qq2005-strip { display: none'],
  ['隐藏皮肤工具条', 'dsh-skin-qq2005-toolbar'],
  ['隐藏 QQ秀 竖条', '.dsh-skin-qq2005-col { display: none'],
  ['隐藏底部信息条', '[data-composer-stats]'],
];
for (const [name, needle] of checks) {
  const at = css.indexOf(needle);
  const inside = at > mediaIdx && at > 0;
  console.log((inside ? '  ✓ ' : '  ✗ ') + name + (at < 0 ? '（未找到）' : '  @' + at + (inside ? ' 在媒体查询内' : ' ⚠ 在媒体查询外')));
}

// 是否以 } 正确收尾（最后一个非空字符）
const tail = css.trim().slice(-40);
console.log('\nCSS 尾部: ' + JSON.stringify(tail));
