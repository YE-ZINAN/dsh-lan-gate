/**
 * 网关自带页面的 HTML（等待批准 / 本机管理台 / 限流提示）。
 * 全部内联，零外部资源；移动端优先。
 */

const BASE_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:20px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:#f5f6f8;color:#1a1a1a;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
@media (prefers-color-scheme:dark){body{background:#12141a;color:#e8eaed}
  .card{background:#1c1f26!important;border-color:#2a2e38!important}
  .muted{color:#9aa0aa!important}
  button.ghost{background:#232733!important;color:#c8ccd4!important;border-color:#343a48!important}
  table{border-color:#2a2e38!important}th,td{border-color:#2a2e38!important}th{background:#1f232c!important}
  code{background:#232733!important}
}
.card{width:100%;max-width:560px;background:#fff;border:1px solid #e3e5e9;border-radius:14px;padding:22px;
  box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:19px;margin:0 0 6px}
h2{font-size:15px;margin:22px 0 8px;font-weight:600}
.muted{color:#6b7280;font-size:13px}
.spin{width:34px;height:34px;border:3px solid #d8dbe0;border-top-color:#4d6bfe;border-radius:50%;
  animation:sp .9s linear infinite;margin:6px 0 14px}
@keyframes sp{to{transform:rotate(360deg)}}
code{background:#f0f1f4;padding:2px 6px;border-radius:5px;font:13px/1.5 ui-monospace,Consolas,monospace;word-break:break-all}
button{font:inherit;padding:9px 14px;border-radius:9px;border:1px solid transparent;background:#4d6bfe;color:#fff;
  cursor:pointer;min-height:38px;touch-action:manipulation}
button:active{transform:translateY(1px)}
button.ghost{background:#f0f1f4;color:#333;border-color:#d8dbe0}
button.danger{background:#e5484d}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;border:1px solid #e3e5e9;border-radius:8px;overflow:hidden}
th,td{padding:8px 9px;text-align:left;border-bottom:1px solid #e3e5e9;vertical-align:middle}
th{background:#fafbfc;font-weight:600;font-size:12px;color:#555}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600}
.pill.pending{background:#fff4e0;color:#a15c00}
.pill.approved{background:#e6f6ea;color:#0a7a2f}
.pill.denied{background:#fdeaea;color:#b91c1c}
.kv{font-size:13px;margin:3px 0}
.kv b{font-weight:600;color:#555}
`;

export function waitingPage({ ip, label, deviceId }) {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>等待电脑批准 · DSH 局域网网关</title><style>${BASE_CSS}</style></head><body>
<div class="card">
  <div class="spin" aria-hidden="true"></div>
  <h1>等待电脑批准</h1>
  <p class="muted">这台设备还没有被授权。请到<b>电脑上</b>打开管理页批准它。</p>
  <div class="kv"><b>设备：</b>${escapeHtml(label)}</div>
  <div class="kv"><b>IP：</b>${escapeHtml(ip)}</div>
  <h2>在电脑上打开</h2>
  <p><code>http://127.0.0.1:3089/__langate/admin</code></p>
  <p class="muted">在「待批准」里找到 <code>${escapeHtml(ip)}</code>，点「允许」。此页会自动刷新。</p>
  <div class="row" style="margin-top:14px">
    <button class="ghost" onclick="location.reload()">我批准了，刷新</button>
  </div>
</div>
<script>
  // 轮询批准状态；一旦 approved 就跳回首页（那时会带上设备 Cookie）
  var tries = 0;
  function poll() {
    tries++;
    fetch('/__langate/status?d=${encodeURIComponent(deviceId)}', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s && s.status === 'approved') { location.replace('/'); return; }
        if (s && s.status === 'denied') {
          document.querySelector('.card').innerHTML =
            '<h1>已被拒绝</h1><p class="muted">这台设备被管理员拒绝了。若需访问，请重新在电脑上批准。</p>';
          return;
        }
        setTimeout(poll, tries < 8 ? 1500 : 4000);
      })
      .catch(function () { setTimeout(poll, 4000); });
  }
  setTimeout(poll, 1200);
</script>
</body></html>`;
}

export function rateLimitedPage({ retryAfterSec }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>请求过于频繁</title>
<style>${BASE_CSS}</style></head><body>
<div class="card"><h1>请求过于频繁</h1>
<p class="muted">已触发限流，请 ${retryAfterSec} 秒后重试。</p></div></body></html>`;
}

export function adminPage({ pending, approved, denied, listenPort, upstream }) {
  const rows = (list, kind) => list.length
    ? list.map((d) => `<tr>
        <td><b>${escapeHtml(d.label)}</b><div class="muted">${escapeHtml(d.ip)}</div></td>
        <td><span class="pill ${d.status}">${d.status === 'approved' ? '已允许' : d.status === 'denied' ? '已拒绝' : '待批准'}</span>
            <div class="muted">${fmtTime(d.firstSeen)}</div></td>
        <td><div class="row">
          ${d.status !== 'approved' ? `<button data-act="approve" data-id="${d.id}">允许</button>` : ''}
          ${d.status === 'pending' ? `<button class="ghost" data-act="deny" data-id="${d.id}">拒绝</button>` : ''}
          ${d.status === 'denied' ? `<button class="ghost" data-act="approve" data-id="${d.id}">改为允许</button>` : ''}
          <button class="danger" data-act="revoke" data-id="${d.id}">撤销</button>
        </div></td></tr>`).join('')
    : `<tr><td colspan="3" class="muted">（无）</td></tr>`;

  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 局域网网关 · 管理台</title><style>${BASE_CSS}</style></head><body>
<div class="card" style="max-width:720px">
  <h1>DSH 局域网网关</h1>
  <p class="muted">本页只允许在<b>这台电脑上</b>打开（回环地址）。手机即使知道网址也打不开。</p>
  <div class="kv"><b>网关监听：</b><code>0.0.0.0:${listenPort}</code>　<b>上游 DSH：</b><code>${escapeHtml(upstream)}</code></div>

  <h2>待批准（${pending.length}）</h2>
  <table><thead><tr><th>设备</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows(pending, 'pending')}</tbody></table>

  <h2>已允许（${approved.length}）</h2>
  <table><thead><tr><th>设备</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows(approved, 'approved')}</tbody></table>

  ${denied.length ? `<h2>已拒绝（${denied.length}）</h2>
  <table><thead><tr><th>设备</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows(denied, 'denied')}</tbody></table>` : ''}

  <div class="row" style="margin-top:18px">
    <button class="ghost" onclick="location.reload()">刷新</button>
    <button class="danger" id="revokeAll">撤销全部设备</button>
  </div>
  <p class="muted" style="margin-top:14px">本页每 4 秒自动刷新一次。</p>
</div>
<script>
  function act(action, id) {
    fetch('/__langate/admin/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action, id: id || undefined })
    }).then(function () { setTimeout(function () { location.reload(); }, 250); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (b) { act(b.dataset.act, b.dataset.id); }
  });
  document.getElementById('revokeAll').addEventListener('click', function () {
    if (confirm('撤销全部已批准设备？它们需要重新批准。')) act('revoke-all');
  });
  setTimeout(function () { location.reload(); }, 4000);
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
