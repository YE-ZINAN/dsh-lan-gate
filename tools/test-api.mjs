import http from 'node:http';

const GATE = { host: '127.0.0.1', port: 3089 };
const AUTHORITY = '127.0.0.1:19387';

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ ...GATE, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

const post = (path, payload, headers = {}) =>
  new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      { ...GATE, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end(data);
  });

(async () => {
  // 先拿首页与 cookie
  const home = await get('/', { host: '127.0.0.1:3089' });
  const cookie = (home.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  console.log('拿到 Cookie: ' + (cookie ? '✓' : '✗'));

  // 从前端 bundle 里挖 API 路径
  const m = home.body.match(/src="([^"]*index-[^"]+\.js)"/);
  const paths = new Set();
  if (m) {
    const p = m[1].startsWith('/') ? m[1] : '/' + m[1];
    const js = await get(p, { host: '127.0.0.1:3089', cookie });
    console.log('bundle: ' + p + '  HTTP ' + js.status + '  ' + (js.body ? js.body.length : 0) + ' 字符');
    const re = /["'`](\/api[0-9a-zA-Z_\-/]*)["'`]/g;
    let x;
    while ((x = re.exec(js.body || ''))) paths.add(x[1]);
  }
  console.log('\n=== bundle 里出现的 /api 路径 ===');
  const list = [...paths].slice(0, 20);
  if (!list.length) console.log('  （没找到，可能路径是拼接出来的）');
  list.forEach((p) => console.log('  ' + p));

  // 逐个测这些路径是否鉴权通过（只看是否 401）
  console.log('\n=== 带 Cookie 访问各 API（401=鉴权失败，其它=通过）===');
  const probes = list.length ? list : ['/api', '/api/session', '/api/status', '/api/workspaces'];
  for (const p of probes.slice(0, 12)) {
    const r = await get(p, { host: '127.0.0.1:3089', cookie });
    const tag = r.error ? 'ERR ' + r.error : r.status === 401 ? '401 ← 鉴权失败' : String(r.status);
    console.log('  ' + p.padEnd(34) + tag);
  }

  // 对照：不带 cookie
  console.log('\n=== 对照：不带 Cookie ===');
  for (const p of probes.slice(0, 4)) {
    const r = await get(p, { host: '127.0.0.1:3089' });
    console.log('  ' + p.padEnd(34) + (r.error ? 'ERR' : r.status));
  }
})();
