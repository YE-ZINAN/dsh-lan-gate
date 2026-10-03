/**
 * 侦察宿主 CSS：找出侧栏宽度、composer 尺寸、是否已有响应式断点。
 * 直接从上游取首页与 CSS 资源。
 */
import http from 'node:http';

const UP = { host: '127.0.0.1', port: 19387 };
const AUTHORITY = '127.0.0.1:19387';

// 用自签 Cookie 过鉴权
import { dshSessionCookiePair } from '../lib/auth.mjs';
const COOKIE = dshSessionCookiePair(AUTHORITY);

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ ...UP, path, method: 'GET', headers: { host: AUTHORITY, cookie: COOKIE, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => resolve({ error: e.message }));
    r.end();
  });
}

const home = await get('/');
console.log('首页 HTTP ' + home.status + '，' + home.body.length + ' 字符');

const cssLinks = [...home.body.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
console.log('CSS 链接: ' + JSON.stringify(cssLinks));

for (const href of cssLinks) {
  const p = href.startsWith('/') ? href : '/' + href;
  const css = await get(p);
  console.log('\n=== ' + p + '  HTTP ' + css.status + '  ' + css.body.length + ' 字符 ===');

  // 找侧栏宽度
  const widths = [...css.body.matchAll(/\[data-sidebar[a-z-]*\][^{]*\{[^}]*?(?:width|flex-basis|min-width)\s*:\s*([^;}]+)/g)].slice(0, 10);
  console.log('data-sidebar 相关的宽度规则: ' + widths.length);
  widths.forEach((w) => console.log('  ' + w[0].replace(/\s+/g, ' ').slice(0, 140)));

  // 找媒体查询
  const mq = [...css.body.matchAll(/@media[^{]{0,120}/g)].map((m) => m[0].trim());
  console.log('\n媒体查询 (' + mq.length + '):');
  [...new Set(mq)].slice(0, 20).forEach((m) => console.log('  ' + m.replace(/\s+/g, ' ')));

  // 找 composer / titlebar 尺寸
  for (const key of ['data-composer-card', 'data-windows-titlebar', 'data-conversation-content']) {
    const hits = [...css.body.matchAll(new RegExp('\\[data-[a-z-]*' + key.replace('data-', '') + '[a-z-]*\\][^{]*\\{[^}]{0,200}', 'g'))].slice(0, 3);
    if (hits.length) {
      console.log('\n' + key + ':');
      hits.forEach((h) => console.log('  ' + h[0].replace(/\s+/g, ' ').slice(0, 180)));
    }
  }
}
