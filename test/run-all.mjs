/**
 * 一次跑完全部测试，最后给一张汇总表。
 *
 * 用 spawnSync + stdio:'inherit'：子进程输出直接打到当前控制台，
 * 不经过管道捕获（沙箱下管道可能被拒），只看退出码判定成败。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

/** 有序的测试清单：[文件名, 一句话说明] */
const SUITES = [
  ['test-gate.mjs', '门禁：设备审批状态机 + 管理接口'],
  ['test-mobile.mjs', '手机/平板排版注入（含桌面不受影响）'],
  ['test-pwa.mjs', 'PWA：manifest、图标、注入标签'],
  ['test-mobile-flow.mjs', '端到端：模拟手机走完整路径'],
  ['test-ws.mjs', 'WebSocket 升级能否穿透网关'],
  ['test-routes.mjs', '真实 API 路径 + Origin 栅栏'],
];

const results = [];

for (const [file, desc] of SUITES) {
  const full = path.join(HERE, file);
  if (!fs.existsSync(full)) {
    results.push({ file, desc, code: -1, note: '文件不存在，跳过' });
    continue;
  }
  console.log('\n' + '='.repeat(64));
  console.log(`▶ ${file}  —  ${desc}`);
  console.log('='.repeat(64));
  const r = spawnSync(NODE, [full], { stdio: 'inherit', cwd: HERE });
  results.push({ file, desc, code: r.status === null ? -1 : r.status, note: r.status === 0 ? '通过' : '失败' });
}

console.log('\n' + '='.repeat(64));
console.log('汇总');
console.log('='.repeat(64));
let bad = 0;
for (const r of results) {
  const mark = r.code === 0 ? 'OK  ' : (r.code === -1 ? 'SKIP' : 'FAIL');
  if (r.code !== 0) bad++;
  console.log(`  ${mark}  ${r.file.padEnd(24)} ${r.desc}${r.note && r.code !== 0 ? '  ← ' + r.note : ''}`);
}
console.log('\n  ' + (bad === 0 ? '全部通过' : bad + ' 个未通过'));
process.exit(bad === 0 ? 0 : 1);
