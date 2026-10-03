/**
 * 设备状态持久化（零依赖，原子写）。
 * 存到 ~/.dsh/lan-gate-state.json，重启后已批准设备仍然有效。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATE_DIR = path.join(os.homedir(), '.dsh');
export const STATE_PATH = path.join(STATE_DIR, 'lan-gate-state.json');
export const DOMREPORT_PATH = path.join(STATE_DIR, 'lan-gate-domreport.json');
const TMP_PATH = STATE_PATH + '.tmp';

const EMPTY = { version: 1, devices: {}, rateBuckets: {} };

export function load() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return structuredClone(EMPTY);
    return {
      version: 1,
      devices: parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
      rateBuckets: parsed.rateBuckets && typeof parsed.rateBuckets === 'object' ? parsed.rateBuckets : {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // 原子写：先写临时文件再 rename，避免断电/崩溃留下半个文件
  fs.writeFileSync(TMP_PATH, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(TMP_PATH, STATE_PATH);
}

/** 按 IP 做滑动窗口限流。返回 { allowed, remaining, retryAfterSec }。 */
export function takeRateLimit(state, ip, limitPerMinute) {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = state.rateBuckets[ip] && Array.isArray(state.rateBuckets[ip]) ? state.rateBuckets[ip] : [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= limitPerMinute) {
    const oldest = fresh[0];
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  fresh.push(now);
  state.rateBuckets[ip] = fresh;
  // 顺手清理过期的桶，避免文件无限增长
  if (Object.keys(state.rateBuckets).length > 200) {
    for (const [k, v] of Object.entries(state.rateBuckets)) {
      const alive = (v || []).filter((t) => now - t < windowMs);
      if (alive.length === 0) delete state.rateBuckets[k];
      else state.rateBuckets[k] = alive;
    }
  }
  return { allowed: true, remaining: limitPerMinute - fresh.length, retryAfterSec: 0 };
}

export function prunePending(state, maxPendingAgeMs = 30 * 60_000) {  const now = Date.now();
  let changed = false;
  for (const [id, d] of Object.entries(state.devices)) {
    if (d.status === 'pending' && now - (d.firstSeen || 0) > maxPendingAgeMs) {
      delete state.devices[id];
      changed = true;
    }
  }
  return changed;
}

/** 保存手机上报的 DOM 结构快照（诊断用，覆盖写）。 */
export function saveDomReport(payload) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(DOMREPORT_PATH, JSON.stringify({ receivedAt: Date.now(), ...payload }, null, 2), 'utf8');
}
