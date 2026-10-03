/**
 * 手机/平板端排版注入 + 结构化诊断上报。
 *
 * 原则：
 *   - 只在窄视口生效（@media max-width），电脑端一个像素都不动
 *   - 优先依赖宿主自己的语义属性（data-*），不硬啃哈希类名
 *   - 拿不准的结构靠「手机把真实 DOM 结构报回来」来定位，而不是继续猜
 */

export const MOBILE_RULES = `
/* ═══ 手机/平板端修正规则（本身不带断点，由外层决定何时生效）═══
   选择器依据「真机实测上报的真实 DOM 结构」，不是猜测。
   真实结构（Android Chrome，视口 369×702，dpr 3.25）：
     body > #root > [data-slot=root] > .BynINW_frame
        > .BynINW_sidebarCol      ← 侧栏列，固定 56px
            > [data-slot=sidebar] > ._2H3hWW_root[._2H3hWW_collapsed]
        > .BynINW_centerCol       ← 主内容
        > .BynINW_rightbarCol
        > .BynINW_overlayLayer    ← 皮肤浮层挂在这里
   ═══════════════════════════════════════ */

  /* 1. 禁止根容器横向溢出 */
  html, body { max-width: 100vw !important; overflow-x: hidden !important; }

  /* 2. 侧栏抽屉。
        实测（CDP 量的）：布局是 CSS Grid，框架上写着
            grid-template-columns: 56px 313.231px 0px
        所以只把 sidebarCol 的 width 压成 0 是没用的 —— 网格轨道本身还占 56px，
        内容从 x=56 开始，左侧就留出空白（用户反馈的"明显留白"就是这个）。
        必须直接改轨道。 */
  .BynINW_frame { grid-template-columns: 0 1fr 0 !important; }

  .BynINW_sidebarCol {
    width: 0 !important;
    min-width: 0 !important;
    flex: 0 0 0 !important;
    overflow: visible !important;
  }
  /* 侧栏本体：脱离文档流，作为抽屉覆盖层 */
  ._2H3hWW_root {
    position: fixed !important;
    left: 0; top: 0; bottom: 0;
    z-index: 2147482500 !important;
    width: min(82vw, 300px) !important;
    max-width: min(82vw, 300px) !important;
    background: var(--dsw-alias-bg-base, #fff) !important;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 32%) !important;
    transition: transform .2s ease;
    overflow-y: auto !important;
  }
  ._2H3hWW_root._2H3hWW_collapsed {
    transform: translateX(-102%) !important;
    box-shadow: none !important;
    pointer-events: none !important;
  }
  /* 抽屉里让文字标签显示出来（收起态本来不显示） */
  ._2H3hWW_root:not(._2H3hWW_collapsed) ._2H3hWW_newSessionLabelMask {
    display: inline !important;
    position: static !important;
  }

  /* 3. 主内容区吃满宽度 */
  .BynINW_centerCol { width: auto !important; flex: 1 1 auto !important; min-width: 0 !important; }
  [data-conversation-region],
  [data-conversation-content],
  [data-conversation-session] {
    width: 100% !important; max-width: 100% !important; min-width: 0 !important;
  }

  /* 4. 顶栏更矮 */
  [data-windows-titlebar] { --dsh-windows-titlebar-height: 34px !important; min-height: 34px !important; }

  /* 5. 输入区贴底 + 安全区 */
  [data-composer-card] {
    margin: 4px 8px calc(env(safe-area-inset-bottom, 0px) + 6px) !important;
    border-radius: 12px !important;
  }
  [data-composer-seat], [data-composer-input] { padding: 6px 8px !important; }

  /* 6. 触摸目标 */
  button, [role="button"] { min-height: 40px !important; touch-action: manipulation; }

  /* 7. ══ 手机端一律隐藏「妨碍视线」的条条（用户 2026-10-03 明确要求）══
        分三类：
        a) 宿主会话题头（模型/子智能体/对话·轨迹 tab）—— 手机上纯占地方
        b) QQ2005 皮肤浮层（实测会遮挡主内容）
        c) 皮肤工具条本身（余额/QQ秀/咳嗽声…）—— 手机上屏幕太窄，挤成两行 */
  [data-slot="conversation.header"],
  [data-conversation-tabs],
  [data-conversation-header-leading],
  [data-conversation-header-corner] { display: none !important; }

  .dsh-skin-qq2005-profile,
  .dsh-skin-qq2005-strip { display: none !important; }

  /* 皮肤工具条挂在输入区 dock 上；它由皮肤注册，选择器以 dsh-skin-qq2005 前缀为准。
     .dsh-skin-qq2005-control = QqSkinControl（含「皮肤 标准」循环按钮，源码 L2589 确认） */
  [class*="dsh-skin-qq2005-toolbar"],
  .dsh-skin-qq2005-control,
  [class*="dsh-skin-qq2005"][class*="bar"] { display: none !important; }

  /* 8. 对话内容区：题头隐藏后向上补齐 */
  [data-conversation-region],
  [data-conversation-content] { top: 0 !important; }

  /* 8. 右侧 QQ秀 竖条：手机端完全隐藏（用户 2026-10-03 要求）。
        它只是进入 QQ秀 面板的入口，手机上不必要。 */
  .dsh-skin-qq2005-col { display: none !important; }

  /* 9. 输入框下方的信息条（统计 4./1./61% 与「皮肤标准」按钮那一行）。
        - ContextMeter（那个 61% 圆环）的类名是哈希的，但它有稳定的 aria-label：
          中文「上下文已用 61%」（locale 键 context.aria），英文 "61% of context used"。
          所以用 button[aria-label] 精确定位，只藏这一个，不动同排的 token/费用统计。
        - 其余几条是尚未核实的候选选择器，作为兜底。 */
  button[aria-label*="上下文已用"],
  button[aria-label*="of context used"],
  [data-composer-stats],
  [data-composer-seat] > footer,
  [class*="dsh-skin-qq2005"][class*="foot"],
  [class*="composerFoot"],
  [class*="composer-footer"] { display: none !important; }

  /* 10. 侧栏列被压成 0 宽后，宿主原本为它预留的偏移必须一并清掉，
        否则文字左侧会留下一条空白（用户反馈"左边有明显留白"）。
        实测：宿主的 BynINW_frame 是 CSS Grid，56px 写死在 grid-template-columns 里，
        所以光把 sidebarCol 的 width 压成 0 没用，必须改轨道（见第 2 条）。 */
  [data-conversation-region],
  [data-conversation-content],
  [data-conversation-session],
  .Dc7zOa_root,
  .Dc7zOa_body {
    left: 0 !important;
    margin-left: 0 !important;
    padding-left: 0 !important;
  }
  /* 但输入卡自身需要一点内边距，否则贴边难看 */
  [data-composer-card] { padding-left: 8px !important; padding-right: 8px !important; }

  /* 11. ☰ 按钮悬在左上角（会话题头已隐藏），给内容顶部留出避让空间，
         否则会盖住第一条消息。首条消息是左对齐的，所以左边多留一点。 */
  [data-conversation-content] { padding-top: 0 !important; }
  [data-conversation-content] > *:first-child { margin-top: 58px !important; }
  [data-conversation-content] > *:first-child > *:first-child { padding-left: 52px !important; }

  /* 11. 内容滚动与图片 */
  [data-conversation-content] pre,
  [data-conversation-content] table {
    max-width: 100% !important; overflow-x: auto !important; -webkit-overflow-scrolling: touch;
  }
  [data-conversation-content] img { max-width: 100% !important; height: auto !important; }

  html { -webkit-text-size-adjust: 100%; }
`;

/**
 * 手机用：把规则包进 860px 断点。
 * 平板（iPad）不用这个 —— iPad 竖屏 1024px、横屏 1366px 都超过 860，
 * 用断点会导致平板永远走桌面布局（实测过，用户反馈"还是桌面端排版"）。
 */
export const MOBILE_CSS = `@media (max-width: 860px) {${MOBILE_RULES}}`;

/**
 * 客户端脚本：
 *   1. 修正 100vh 在移动端被地址栏吃掉的问题
 *   2. 左下角 ☰ 按钮，切换侧栏抽屉（多策略 + 捕获阶段拦事件）
 *   3. ?dev=1 时自动上报真实 DOM 结构，并显示结果提示条
 *      （不再依赖点按钮；之前点按钮没反应，改成自动上报更可靠）
 */
export const MOBILE_JS = `<script>
(function () {
  var DEV = new URLSearchParams(location.search).get('dev') === '1';

  // ── 平板识别（iPad）──
  // iPadOS 的 Safari 把自己伪装成 Mac（UA 里没有 iPad / Mobile），服务端认不出。
  // 但 Mac 笔记本没有多点触控（maxTouchPoints = 0），iPad 有 → 用这个区分。
  // 命中后启用「无断点」版本规则：平板竖屏 1024 / 横屏 1366 都超过 860，
  // 靠断点永远命中不了。
  var IS_TABLET = false;
  (function detectTablet() {
    try {
      var touch = (navigator.maxTouchPoints || 0) > 1;
      var macLike = /Macintosh|Mac OS X/.test(navigator.userAgent);
      var phoneLike = /Android|iPhone|iPod/i.test(navigator.userAgent);
      var tabletStyle = document.getElementById('langate-tablet-css');
      if (touch && macLike && !phoneLike && tabletStyle) {
        tabletStyle.setAttribute('media', 'all');
        document.documentElement.setAttribute('langate-tablet', '1');
        IS_TABLET = true;
      }
    } catch (e) { /* 忽略 */ }
  })();

  function toast(msg, ok) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(env(safe-area-inset-bottom,0px) + 132px)',
      'z-index:2147483600', 'max-width:86vw', 'padding:9px 14px', 'border-radius:10px',
      'font:13px/1.4 -apple-system,system-ui,sans-serif', 'color:#fff',
      'background:' + (ok ? 'rgba(16,122,47,.94)' : 'rgba(185,28,28,.94)'),
      'box-shadow:0 3px 12px rgba(0,0,0,.28)', 'pointer-events:none', 'text-align:center'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }
  function log() { if (DEV) console.log.apply(console, ['[langate]'].concat([].slice.call(arguments))); }

  // ── 1. 真实视口高度 ──
  function fixVh() { document.documentElement.style.setProperty('--langate-vh', window.innerHeight + 'px'); }
  fixVh();
  window.addEventListener('resize', fixVh, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(fixVh, 120); });

  // ── 2. 侧栏抽屉 ──
  // 实测结构：侧栏本体是 [class*="_2H3hWW_root"]，折叠态加 class 名含 _collapsed。
  // 宿主自己有个 toggle 按钮（class 含 _2H3hWW_toggle 或 _toggle）；优先点它，
  // 这样 React 内部状态与我们的 CSS 不会打架。点不到再退化为直接改 class。
  function sidebarRoot() {
    return document.querySelector('[data-slot="sidebar"] [class*="_root"]') ||
           document.querySelector('[class*="sidebarCol"] [class*="_root"]') ||
           document.querySelector('[class*="_2H3hWW_root"]') ||
           null;
  }
  function isCollapsed(el) {
    return !!el && /_collapsed/.test(el.className || '');
  }
  function findHostToggle() {
    return document.querySelector('[data-slot="sidebar"] [class*="_toggle"]') ||
           document.querySelector('[class*="_2H3hWW_toggle"]') ||
           null;
  }
  function toggleSidebar() {
    var el = sidebarRoot();
    if (!el) { log('找不到侧栏本体'); toast('没找到侧栏', false); return; }
    var willExpand = isCollapsed(el);
    var hostBtn = findHostToggle();
    if (hostBtn) {
      hostBtn.click(); // 交给宿主处理，状态一致
      setTimeout(function () {
        var now = sidebarRoot();
        log('点宿主按钮后，折叠态 = ' + isCollapsed(now));
        // 若宿主没响应，退化处理
        if (now && isCollapsed(now) === willExpand) {
          log('宿主按钮无效，直接改 class');
          if (willExpand) now.classList.remove('_2H3hWW_collapsed');
          else now.classList.add('_2H3hWW_collapsed');
        }
      }, 120);
    } else {
      if (willExpand) el.classList.remove('_2H3hWW_collapsed');
      else el.classList.add('_2H3hWW_collapsed');
      log('直接切换 class → ' + (willExpand ? '展开' : '收起'));
    }
  }
  function addDrawerButton() {
    if (document.getElementById('langate-drawer-btn')) return;
    var b = document.createElement('button');
    b.id = 'langate-drawer-btn';
    b.type = 'button';
    b.setAttribute('aria-label', '侧栏');
    b.textContent = '☰';
    b.style.cssText = [
      // 放左上角：会话题头已被隐藏，那里是空的；
      // 原来放在输入框上方会压住输入框（截图验证过），所以改位置。
      'position:fixed', 'left:8px',
      'top:calc(env(safe-area-inset-top, 0px) + 10px)',
      'z-index:2147483000', 'width:44px', 'height:44px', 'min-height:44px', 'border-radius:50%',
      'border:1px solid rgb(0 0 0 / 14%)', 'background:rgb(255 255 255 / 94%)',
      'color:#1a1a1a', 'font-size:20px', 'line-height:1', 'box-shadow:0 2px 8px rgb(0 0 0 / 18%)',
      'display:none', 'cursor:pointer', 'padding:0'
    ].join(';');
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleSidebar(); }, true);
    document.body.appendChild(b);
    sync();
    window.addEventListener('resize', sync, { passive: true });
  }
  function sync() {
    var b = document.getElementById('langate-drawer-btn');
    if (!b) return;
    // 平板走无断点规则，宽度可能 > 860，所以不能只看媒体查询
    var on = IS_TABLET || document.documentElement.hasAttribute('langate-tablet')
             || window.matchMedia('(max-width: 860px)').matches;
    b.style.display = on ? 'block' : 'none';
  }

  // ── 3. DOM 结构上报 ──
  function describe(el, depth, maxDepth, out) {
    if (!el || depth > maxDepth || out.length >= 500) return;
    var attrs = {};
    for (var i = 0; i < (el.attributes || []).length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0 || a.name === 'id' || a.name === 'role' || a.name === 'class') {
        attrs[a.name] = String(a.value).slice(0, 220);
      }
    }
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    var cs = getComputedStyle(el);
    out.push({
      d: depth, tag: el.tagName.toLowerCase(), attrs: attrs,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      pos: cs.position, z: cs.zIndex,
      text: (el.children.length === 0 ? String(el.textContent || '').trim().slice(0, 40) : '')
    });
    var kids = el.children || [];
    for (var k = 0; k < kids.length; k++) describe(kids[k], depth + 1, maxDepth, out);
  }
  function reportDom() {
    var out = [];
    describe(document.body, 0, 8, out);
    var sb = findSidebar();
    // 额外线索：题头 / tab / 输入区工具条附近的元素，便于定位"挡视线的条条"
    function around(sel, label) {
      return [].slice.call(document.querySelectorAll(sel)).slice(0, 6).map(function (el) {
        var r = el.getBoundingClientRect();
        return { label: label, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 120),
                 attrs: [].slice.call(el.attributes).map(function (a) { return a.name; }).filter(function (n) { return n.indexOf('data-') === 0; }),
                 box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
      });
    }
    var hotzones = [].concat(
      around('[data-slot="conversation.header"]', '题头槽'),
      around('[data-conversation-tabs]', 'tab'),
      around('[data-composer-card]', '输入卡'),
      around('[data-composer-seat]', '输入座'),
      around('[data-composer-dock], [data-slot="conversation.composer.dock"]', '输入dock'),
      around('[class*="dsh-skin-qq2005"]', '皮肤元素')
    );

    // 扫描输入卡下方的元素（底部信息条/状态栏最可能藏在这里）
    var belowComposer = [];
    try {
      var card = document.querySelector('[data-composer-card]') || document.querySelector('[data-composer-seat]');
      var bottomY = card ? card.getBoundingClientRect().bottom : window.innerHeight * 0.6;
      var all = document.querySelectorAll('div,footer,section,span');
      for (var i = 0; i < all.length && belowComposer.length < 25; i++) {
        var el = all[i];
        var r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 10 || r.height > 120) continue;
        if (r.top < bottomY - 4) continue;
        if (r.bottom > window.innerHeight + 2) continue;
        var txt = String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!txt) continue;
        belowComposer.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 110),
          attrs: [].slice.call(el.attributes).map(function (a) { return a.name; })
                   .filter(function (n) { return n.indexOf('data-') === 0; }),
          box: [Math.round(r.x), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          text: txt
        });
      }
    } catch (e) { log('扫描底部元素失败', e); }

    // 量「文字左侧留白」：内容链路上每一层的盒模型与关键样式
    var layoutChain = [];
    try {
      var chain = [
        ['frame', document.querySelector('[class*="_frame"]')],
        ['sidebarCol', document.querySelector('[class*="sidebarCol"]')],
        ['centerCol', document.querySelector('[class*="centerCol"]')],
        ['convRoot', document.querySelector('[data-conversation-region]') || document.querySelector('[class*="Dc7zOa_root"]')],
        ['convBody', document.querySelector('[data-conversation-content]')],
      ];
      for (var ci = 0; ci < chain.length; ci++) {
        var name = chain[ci][0], el = chain[ci][1];
        if (!el) { layoutChain.push({ name: name, missing: true }); continue; }
        var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        layoutChain.push({
          name: name,
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 90),
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          padL: cs.paddingLeft, padR: cs.paddingRight,
          marL: cs.marginLeft, marR: cs.marginRight,
          disp: cs.display, pos: cs.position,
          gridCols: cs.gridTemplateColumns, gap: cs.gap,
          maxW: cs.maxWidth, width: cs.width
        });
      }
      // 内容区里最靠左的文字节点，看它的绝对 x
      var txt = document.querySelector('[data-conversation-content] p, [data-conversation-content] div');
      if (txt) {
        var tr = txt.getBoundingClientRect(), tcs = getComputedStyle(txt);
        layoutChain.push({ name: 'firstText', tag: txt.tagName.toLowerCase(),
          cls: String(txt.className || '').slice(0, 80),
          box: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)],
          padL: tcs.paddingLeft, marL: tcs.marginLeft, maxW: tcs.maxWidth, width: tcs.width,
          text: String(txt.textContent || '').trim().slice(0, 40) });
      }
    } catch (e) { log('布局测量失败', e); }

    var payload = {
      vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio,
      ua: navigator.userAgent, sidebarFound: !!sb,
      sidebarHtml: sb ? sb.outerHTML.slice(0, 800) : null,
      hotzones: hotzones,
      belowComposer: belowComposer,
      layoutChain: layoutChain,
      bodyChildren: [].slice.call(document.body.children).map(function (c) {
        var r = c.getBoundingClientRect(); var cs = getComputedStyle(c);
        return { tag: c.tagName.toLowerCase(), id: c.id || '', cls: String(c.className || '').slice(0, 160),
                 box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                 pos: cs.position, z: cs.zIndex };
      }),
      tree: out
    };
    log('上报中… 节点数 ' + out.length + '，侧栏找到: ' + !!sb);
    return fetch('/__langate/domreport', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) { toast('DOM 已上报 ✓（节点 ' + out.length + '）', true); log('上报成功'); }
      else { toast('上报失败：HTTP ' + r.status, false); log('上报失败', r.status); }
    }).catch(function (e) { toast('上报失败：' + e.message, false); log('上报异常', e); });
  }

  function boot() {
    addDrawerButton();

    // ── 通用隐藏开关：?hide=<选择器> 或 ?hide=<选择器1>,<选择器2> ──
    // 用途：现场试出「是哪个元素在挡视线」，验证后我再固化进 CSS
    try {
      var hideParam = new URLSearchParams(location.search).get('hide');
      if (hideParam) {
        var sels = hideParam.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var st = document.createElement('style');
        st.textContent = sels.join(',') + '{display:none !important}';
        document.head.appendChild(st);
        var found = sels.map(function (s) {
          var n = 0; try { n = document.querySelectorAll(s).length; } catch (e) { n = -1; }
          return s + '→' + (n < 0 ? '选择器非法' : n + ' 个');
        }).join('  ');
        toast('已隐藏：' + found, true);
        log('hide 生效:', found);
      }
    } catch (e) { log('hide 参数处理失败', e); }

    if (DEV) {
      var b = document.getElementById('langate-drawer-btn');
      if (b) { b.textContent = '📷'; b.title = '点此重新上报 DOM'; b.addEventListener('click', reportDom, true); }
      // 自动上报：不再依赖点击，避免按钮事件被环境吃掉
      setTimeout(reportDom, 1800);
      log('DEV 模式：1.8 秒后自动上报 DOM 结构');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
</script>`;

/** 是否按移动端处理。 */
export function isMobileRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
}

/**
 * 注入移动端样式与脚本。
 *
 * mode: 'off' 时不注入；其余情况都注入两套样式：
 *   - langate-mobile-css  ：包在 860px 断点里（手机用）
 *   - langate-tablet-css  ：同一套规则但不带断点，默认 media="not all" 关闭，
 *                           由客户端脚本在识别到 iPad 后打开
 * 之所以不再按 UA 决定是否注入：iPad 的 UA 是 Mac，服务端根本认不出来。
 */
export function injectMobile(html, mode) {
  if (mode === 'off') return html;

  const viewportTag = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  let out = html;
  if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, viewportTag);
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>${viewportTag}`);
  }

  const payload =
    `<style id="langate-mobile-css">${MOBILE_CSS}</style>` +
    `<style id="langate-tablet-css" media="not all">${MOBILE_RULES}</style>` +
    MOBILE_JS;
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, payload + '</head>');
  else if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, payload + '</body>');
  else out += payload;
  return out;
}
