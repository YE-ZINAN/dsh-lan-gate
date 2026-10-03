import http from 'node:http';
import { GATE_HOST, GATE_PORT } from './config.mjs';

const GATE = { host: GATE_HOST, port: GATE_PORT };

// 用来验证「Origin 栅栏」的伪 Origin：只要不是上游 authority（127.0.0.1:19387）即可，
// 真实手机浏览器带的就是它自己访问用的那个地址。
const FAKE_ORIGIN = `http://${GATE_HOST}:${GATE_PORT}`;

function req(path, { cookie, method = 'GET', body, origin } = {}) {
  return new Promise((resolve) => {
    const headers = {
      host: `${GATE_HOST}:${GATE_PORT}`,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36',
    };
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    let data;
    if (body) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ ...GATE, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b.slice(0, 200), len: b.length }));
    });
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(12000, () => { r.destroy(); resolve({ error: 'timeout' }); });
    r.end(data);
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (n, ok, d) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' → ' + d : '')); } };

  const home = await req('/');
  const cookie = (home.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  console.log('Cookie: ' + (cookie ? '已获取' : '（网关自己带 Cookie，客户端不需要，属正常）'));

  console.log('\n=== 访问真实 API 路径 ===');
  const paths = ['/api/ping', '/api/remote.mux', '/api/changes.summary', '/api/present.host', '/api', '/events'];
  let api = { status: 0, headers: {} };
  let api404 = { status: 0, headers: {} };
  for (const p of paths) {
    const r = await req(p, { cookie });
    if (p === '/api/present.host') api = r;
    if (p === '/api/ping') api404 = r;
    console.log('  ' + p.padEnd(26) + (r.error ? 'ERR ' + r.error : r.status + '  len=' + r.len + '  ct=' + (r.headers['content-type'] || '').slice(0, 30)));
  }

  console.log('\n=== 模拟浏览器 Origin（若网关没改写 Origin，这里会 403）===');
  const originResults = {};
  for (const o of [FAKE_ORIGIN, 'http://127.0.0.1:19387', undefined]) {
    const r = await req('/api/present.host', { cookie, origin: o });
    originResults[String(o)] = r;
    console.log('  Origin=' + String(o).padEnd(28) + (r.error ? 'ERR' : r.status));
  }

  console.log('\n=== POST 探测（发一条真实 RPC，看是否被接受）===');
  const rpc = await req('/api/remote.mux', { cookie, method: 'POST', body: {} });
  console.log('  POST /api/remote.mux -> ' + (rpc.error ? 'ERR ' + rpc.error : rpc.status + '  ' + (rpc.body || '').replace(/\s+/g, ' ').slice(0, 120)));

  console.log('\n=== 断言 ===');
  check('真实 API /api/present.host 返回 200', api.status === 200, 'status=' + api.status);
  check('该响应是 JSON', /json/.test(api.headers['content-type'] || ''), api.headers['content-type']);
  check('不存在的路由返回 404（不是 401，说明已越过上游鉴权）', api404.status === 404, 'status=' + api404.status);
  // 关键：手机浏览器一定会带自己的 Origin，网关必须改写它，否则 /api 被 403 拒
  const phoneOrigin = originResults[FAKE_ORIGIN];
  check('带非上游 Origin 不被 403（Origin 改写生效）', !!phoneOrigin && phoneOrigin.status !== 403,
    phoneOrigin ? 'status=' + phoneOrigin.status : 'no result');

  console.log('\n────────────────────────');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
