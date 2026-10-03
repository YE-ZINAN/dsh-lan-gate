import http from 'node:http';
import { dshSessionCookiePair } from '../lib/auth.mjs';

const AUTHORITY = '127.0.0.1:19387';
const COOKIE = dshSessionCookiePair(AUTHORITY);

function get(path) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 19387, path, method: 'GET', headers: { host: AUTHORITY, cookie: COOKIE } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b));
    });
    r.on('error', () => resolve(''));
    r.end();
  });
}

const css = (await get('/./assets/index-BPHePDI_.css')) + (await get('/./assets/vendor-BNsW4eBh.css'));
console.log('CSS 总长: ' + css.length);

for (const key of ['Dc7zOa_body', 'Dc7zOa_root', 'BynINW_centerCol', 'BynINW_sidebarCol', 'BynINW_frame']) {
  const re = new RegExp('\\.' + key + '[^{]*\\{[^}]{0,320}\\}', 'g');
  const hits = [...css.matchAll(re)].slice(0, 4);
  console.log('\n=== .' + key + ' (' + hits.length + ' 条) ===');
  hits.forEach((h) => console.log('  ' + h[0].replace(/\s+/g, ' ').slice(0, 300)));
}
