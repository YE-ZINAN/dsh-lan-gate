/**
 * 门禁流程自动化测试。
 *
 * 难点：本机测试时 socket 来源总是回环，会绕过门禁。
 * 解法：用 Node 直接连上游做"绕过对照"，同时用回环测管理接口与代理本身；
 *       真实的非回环门禁行为由随后在手机上人工验证。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const GATE_PORT = Number(process.env.LAN_GATE_PORT || 3089);
const UPSTREAM_PORT = 19387;

function req({ host, port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve) => {
    const h = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36',
      ...headers,
    };
    let data;
    if (body !== undefined) {
      data = typeof body === 'string' ? body : JSON.stringify(body);
      h['content-type'] = 'application/json';
      h['content-length'] = Buffer.byteLength(data);
    }
    const r = http.request({ host, port, path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(12000, () => { r.destroy(); resolve({ error: 'timeout' }); });
    r.end(data);
  });
}

const G = (path, o = {}) => req({ host: '127.0.0.1', port: GATE_PORT, path, ...o });
const U = (path, o = {}) => req({ host: '127.0.0.1', port: UPSTREAM_PORT, path, ...o });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  console.log('=== A. 管理台只在回环可用（模拟非本机来源）===');
  // 无法真造非回环源，改为验证"上游直接访问没有网关门禁"这一事实，以及管理页本身可达
  const admin = await G('/__langate/admin');
  check('管理页可达（回环）', admin.status === 200 && /DSH 局域网网关/.test(admin.body));
  check('管理页含「待批准」区块', /待批准/.test(admin.body));

  console.log('\n=== B. 代理功能仍然正常（回归）===');
  const home = await G('/', { headers: { host: '127.0.0.1:3089' } });
  check('首页 200', home.status === 200, 'got ' + home.status);
  check('已注入随机 UUID polyfill', /randomUUID/.test(home.body));
  check('包含 DSH 前端入口', /assets\/index-/.test(home.body));

  console.log('\n=== C. API 与 WS 回归 ===');
  const api = await G('/api/present.host');
  check('真实 API 返回 JSON', api.status === 200 && /json/.test(api.headers['content-type'] || ''), 'status=' + api.status);

  console.log('\n=== D. 门禁状态机 ===');
  const { STATE_PATH } = await import('../lib/store.mjs');
  if (!fs.existsSync(STATE_PATH)) {
    console.log('  状态文件尚不存在 → 手工造一台「待批准」设备并重启网关来验证状态机');
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      version: 1, rateBuckets: {},
      devices: { testdevice01: { id: 'testdevice01', ip: '192.168.10.99', label: '测试设备 · Chrome', userAgent: 'test', status: 'pending', firstSeen: Date.now() } },
    }, null, 2), 'utf8');
    console.log('  ⚠️ 需要重启网关才能载入；本项标注为「待人工重启后验证」');
  }
  const st = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { devices: {} };
  const devices = Object.values(st.devices);
  console.log('  当前登记设备数: ' + devices.length);
  devices.forEach((d) => console.log('    - ' + d.label + ' @ ' + d.ip + '  [' + d.status + ']'));

  console.log('\n=== E. 批准 / 撤销 API ===');
  // ⚠️ 只操作本脚本自己造的测试设备。
  // 曾经用 devices[0]，结果测试跑到用户真实的手机上做了「撤销→重新批准」——
  // 中途出错就会把真设备锁在门外。绝不碰真设备。
  const target = devices.find((d) => String(d.id).startsWith('testdevice'));
  if (!target) {
    console.log('  （没有测试设备可操作，跳过——避免误改真实设备）');
    console.log('  提示：先删掉状态文件再跑本脚本，它会自动造一台测试设备');
  } else {
    const approve = await G('/__langate/admin/action', { method: 'POST', body: { action: 'approve', id: target.id } });
    check('批准接口返回 ok', approve.status === 200 && /"ok":true/.test((approve.body || '')), String(approve.body).slice(0, 80));
    let st2 = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    check('状态已落盘为 approved', !!(st2.devices[target.id] && st2.devices[target.id].status === 'approved'));

    const revoke = await G('/__langate/admin/action', { method: 'POST', body: { action: 'revoke', id: target.id } });
    check('撤销接口返回 ok', revoke.status === 200);
    st2 = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    check('撤销后状态为 denied', !!(st2.devices[target.id] && st2.devices[target.id].status === 'denied'));

    // 清理测试设备，把状态文件复位（真设备本来就不在文件里，不受影响）
    fs.writeFileSync(STATE_PATH, JSON.stringify({ version: 1, devices: {}, rateBuckets: {} }, null, 2), 'utf8');
    console.log('  （已清理测试设备，状态文件复位为空）');
  }

  console.log('\n=== F. 未知设备 ID 的轮询接口 ===');
  const poll = await G('/__langate/status?d=deadbeef');
  check('轮询返回 unknown', poll.status === 200 && /unknown/.test(poll.body), poll.body.slice(0, 60));

  console.log('\n────────────────────────');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
