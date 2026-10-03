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

const css = await get('/./assets/index-BPHePDI_.css');
console.log('CSS 长度: ' + css.length);

console.log('\n=== 所有 @media 查询（去重）===');
const mqs = [...css.matchAll(/@media[^{]{0,140}/g)].map((m) => m[0].replace(/\s+/g, ' ').trim());
[...new Set(mqs)].forEach((m) => console.log('  ' + m));

console.log('\n=== 侧栏宽度相关（含 sidebar 字样或 240-320px 的宽度）===');
const widthHits = [...css.matchAll(/[^{}]{0,120}\{[^{}]{0,160}(?:width|flex)[^{}]{0,40}(?:2[3-9]\d|3[0-2]\d)px[^{}]{0,80}\}/g)].slice(0, 12);
widthHits.forEach((h) => console.log('  ' + h[0].replace(/\s+/g, ' ').slice(0, 190)));

console.log('\n=== 含 sidebar 的规则（前 12 条）===');
const sb = [...css.matchAll(/[^{}]{0,150}sidebar[^{}]{0,60}\{[^{}]{0,200}\}/gi)].slice(0, 12);
sb.forEach((h) => console.log('  ' + h[0].replace(/\s+/g, ' ').slice(0, 190)));

console.log('\n=== CSS 变量定义（--dsh-*）===');
const vars = [...css.matchAll(/--dsh-[a-z-]+:[^;}]{0,60}/gi)].map((m) => m[0].trim());
[...new Set(vars)].slice(0, 30).forEach((v) => console.log('  ' + v));
