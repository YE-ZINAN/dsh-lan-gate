/**
 * 验证 WebSocket 能否透过网关（DSH 靠 WS 实时推流，不通则界面能开但不动）
 * 用原生 net 手写 WS 握手，不依赖任何库。
 */
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';

const GATE = { host: '127.0.0.1', port: 3089 };

function getCookie() {
  return new Promise((resolve) => {
    const req = http.request({ ...GATE, path: '/', method: 'GET', headers: { host: '127.0.0.1:3089' } }, (res) => {
      res.resume();
      res.on('end', () => resolve((res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')));
    });
    req.on('error', () => resolve(''));
    req.end();
  });
}

function tryUpgrade(path, headers) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(GATE.port, GATE.host, () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:3089`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${key}`,
        `Sec-WebSocket-Version: 13`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ];
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let buf = '';
    let settled = false;
    const done = (result) => {
      if (settled) return;          // 只认第一个结果
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(result);
    };
    sock.on('data', (d) => {
      buf += d.toString('binary');
      if (buf.includes('\r\n\r\n')) {
        const first = buf.split('\r\n')[0];
        const isWs = /101/.test(first);
        done({ path, first, ok: isWs, bytes: buf.length });
      }
    });
    sock.on('error', (e) => done({ path, error: e.message }));
    // 必须处理 close：上游可能直接断开而不发任何数据。
    // 早期漏了这个分支 → Promise 永不 settle → 事件循环空了 → Node 静默 exit 0，
    // 后面的路径根本没测（表现为"只打印第一行就结束"）。
    sock.on('close', () => done({ path, error: 'closed without data', partial: buf.slice(0, 120) }));
    sock.setTimeout(6000, () => done({ path, error: 'timeout', partial: buf.slice(0, 120) }));
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (n, ok, d) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' → ' + d : '')); } };

  console.log('=== 探测各路径的 WebSocket 升级 ===');
  const paths = ['/api/remote.mux', '/api', '/ws', '/events', '/api/ws'];
  const got = {};
  for (const p of paths) {
    const r = await tryUpgrade(p, {});
    got[p] = r;
    if (r.error) console.log('  ' + p.padEnd(20) + 'ERR ' + r.error + (r.partial ? '  [' + r.partial.replace(/\r?\n/g, ' ').slice(0, 80) + ']' : ''));
    else console.log('  ' + p.padEnd(20) + (r.ok ? '101 Switching Protocols' : (r.first || '').slice(0, 60)));
  }

  console.log('\n=== 断言 ===');
  // 这是本项目最关键的一条：DSH 靠 WebSocket 实时推字，握手必须能穿透网关
  const mux = got['/api/remote.mux'];
  check('/api/remote.mux 升级成功（101）', !!(mux && mux.ok), mux ? (mux.error || mux.first) : 'no result');
  // 不存在的路径不应被误当成 WS 端点
  check('/ws 不是 WS 端点（未被误接）', !(got['/ws'] && got['/ws'].ok));
  check('/api/ws 不是 WS 端点（未被误接）', !(got['/api/ws'] && got['/api/ws'].ok));

  console.log('\n────────────────────────');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
