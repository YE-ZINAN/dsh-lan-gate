// 探测 DSH 的鉴权行为：哪些路径返回什么、401 的具体内容
import http from 'node:http';

function probe(path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 19387, path, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ path, status: res.statusCode, headers: res.headers, body: body.slice(0, 300) })
        );
      }
    );
    req.on('error', (e) => resolve({ path, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ path, error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  const cases = [
    ['/', {}],
    ['/', { Origin: 'http://127.0.0.1:19387' }],
    ['/', { Origin: 'http://127.0.0.1:3089' }],
    ['/', { Host: '127.0.0.1:19387' }],
    ['/index.html', {}],
    ['/api', {}],
    ['/api/status', {}],
  ];
  for (const [path, headers] of cases) {
    const r = await probe(path, headers);
    const label = path + (headers.Origin ? ' [Origin=' + headers.Origin + ']' : '') + (headers.Host ? ' [Host=' + headers.Host + ']' : '');
    if (r.error) { console.log(label.padEnd(52) + ' ERR ' + r.error); continue; }
    console.log(label.padEnd(52) + ' ' + r.status + '  len=' + (r.body ? r.body.length : 0));
    const interesting = ['www-authenticate', 'location', 'content-type', 'set-cookie', 'x-powered-by'];
    for (const h of interesting) if (r.headers[h]) console.log('      ' + h + ': ' + JSON.stringify(r.headers[h]));
    if (r.status >= 400 && r.body) console.log('      body: ' + r.body.replace(/\s+/g, ' ').slice(0, 200));
  }
})();
