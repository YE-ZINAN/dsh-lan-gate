/**
 * dsh-lan-gate-button —— Host 半区
 *
 * 只做两件事，都是给客户端半区用的同源接口（避免跨域）：
 *
 *   GET  /dsh-lan-gate/summary   问网关「还活着吗、有几台在等批准」
 *   POST /dsh-lan-gate/start     拉起网关（走计划任务）
 *
 * 为什么要有这一层：客户端跑在 dsh-app:// 或 http://127.0.0.1:19387 上，
 * 直接 fetch 网关的 3089 是跨域，浏览器会拦。宿主半区在 Node 里，没有这问题。
 *
 * 为什么 start 走 schtasks 而不是自己 spawn node：
 *   DSH 命令里起的进程属于该命令的进程树，命令结束/被清理时整棵树被杀 ——
 *   2026-10-04 网关就是这么无声无息没的（SIGINT 处理函数没跑、stderr 为空）。
 *   计划任务起的进程不属于任何 DSH 命令树，而且任务本身每 5 分钟自愈检查一次。
 */

import { spawn } from 'node:child_process';

export const name = 'dsh-lan-gate-button';

/** 必须有 webServer 才能注册路由。 */
export const inject = ['webServer'];

const DEFAULTS = {
  gatewayPort: 3089,
  taskName: 'dsh-lan-gate',
  /** 拉起后等待端口就绪的上限。实测计划任务路径 ~1 秒起。 */
  startTimeoutMs: 12000,
  /** 单次探测网关的超时。 */
  probeTimeoutMs: 1500,
};

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  res.end(body);
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) };
  const base = `http://127.0.0.1:${config.gatewayPort}`;
  const adminUrl = `${base}/__langate/admin`;
  const summaryUrl = `${base}/__langate/admin/summary`;

  /** 探测网关。永远 resolve，绝不抛 —— 客户端要的是状态，不是异常。 */
  const probe = async () => {
    try {
      const response = await fetch(summaryUrl, { signal: AbortSignal.timeout(config.probeTimeoutMs) });
      if (!response.ok) {
        // 端口有人应答但不是我们的接口（多半是端口被别的程序占了）
        return { ok: false, running: true, httpStatus: response.status, adminUrl };
      }
      const data = await response.json();
      return { ok: true, running: true, ...data, adminUrl };
    } catch (error) {
      return {
        ok: false,
        running: false,
        adminUrl,
        reason: String((error && error.message) || error),
      };
    }
  };

  const startGateway = () =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn('schtasks.exe', ['/run', '/tn', config.taskName], { windowsHide: true });
      } catch (error) {
        resolve({ spawned: false, error: String((error && error.message) || error) });
        return;
      }
      let stderr = '';
      if (child.stderr) child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => resolve({ spawned: false, error: String((error && error.message) || error) }));
      child.on('close', (code) => resolve({ spawned: code === 0, exitCode: code, stderr: stderr.trim() }));
    });

  const waitUntilUp = async (deadline) => {
    for (;;) {
      const state = await probe();
      if (state.running || Date.now() >= deadline) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-lan-gate/summary',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        sendJson(response, 200, await probe());
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-lan-gate/start',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' });
          response.end();
          return;
        }
        const before = await probe();
        if (before.running) {
          sendJson(response, 200, before);
          return;
        }
        const started = await startGateway();
        const after = await waitUntilUp(Date.now() + config.startTimeoutMs);
        sendJson(response, 200, { ...after, start: started });
      },
    }),
  );
}
