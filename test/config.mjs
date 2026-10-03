/**
 * 测试共用配置。
 *
 * 为什么要有这个文件：**不要把个人局域网 IP 写死在代码里**。
 * 写死了别人 clone 下来就跑不了，对自己也没有任何好处。
 *
 * 需要走真实局域网路径的用例（例如「从局域网 IP 访问」），用环境变量给出你本机 IP：
 *
 *     PowerShell:  $env:DSH_LAN_IP='192.168.1.23'; node test\run-all.mjs
 *     bash:        DSH_LAN_IP=192.168.1.23 node test/run-all.mjs
 *
 * 不设置也能跑 —— 那几条用例会明确跳过，其余断言照常执行。
 */
import os from 'node:os';

export const GATE_HOST = '127.0.0.1';
export const GATE_PORT = Number(process.env.LAN_GATE_PORT || 3089);

/** 本机自己的局域网 IP，由环境变量提供；为空表示没提供。 */
export const LAN_IP = String(process.env.DSH_LAN_IP || '').trim();

/** 走局域网时模拟真实浏览器会带的 Host 头；没提供 IP 时退回本机。 */
export const LAN_HOST = LAN_IP ? `${LAN_IP}:${GATE_PORT}` : `${GATE_HOST}:${GATE_PORT}`;

/** 是否有真实局域网 IP 可用（决定那些用例跑还是跳过）。 */
export const hasLanIp = LAN_IP !== '';

/** 自动探测本机局域网 IP（仅在没给环境变量时用来给出更友好的提示）。 */
export function detectLanIp() {
  const found = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  return found[0] || '';
}
