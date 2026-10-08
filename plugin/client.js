/**
 * dsh-lan-gate-button —— Client 半区
 *
 * 在左栏底部（设置图标旁）加一个「手机接入」按钮：
 *
 *   · 显示当前接入范围：「局域网＋远程」还是「仅局域网」
 *     实心绿点＝远程可用；空心绿点＝只有局域网（侧栏收成 56px 轨道时也能一眼分辨）
 *     待批准数并入标签，不会把接入范围盖掉
 *   · 点一下用系统浏览器打开网关批准页（桌面端 window.open 会经
 *     setWindowOpenHandler → shell.openExternal 走默认浏览器）
 *   · 网关没在跑就显示成「启动手机网关」，点击先走计划任务把它拉起来、
 *     再打开批准页 —— 起来之后再点就回到同步的 window.open
 *
 * 只在「电脑上」渲染。手机/iPad 是经网关访问的（主机名是局域网 IP），
 * 在那边点这个按钮只会得到一个 403 —— 批准页服务端只认回环地址。
 * 桌面端加载的是自定义协议 dsh-app://app/，不是 127.0.0.1，所以两种都要认。
 */

window.__ModuleLoader__.load({
  id: 'dsh-lan-gate-button',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const SUMMARY_URL = '/dsh-lan-gate/summary'
    const START_URL = '/dsh-lan-gate/start'
    const POLL_MS = 10000
    /** 自动拉起的冷却，避免网关起不来时每轮轮询都发一次。 */
    const START_COOLDOWN_MS = 30000
    const FALLBACK_ADMIN = 'http://127.0.0.1:3089/__langate/admin'

    /** 模块级：跨渲染共享，不进 state，避免多余的重渲染。 */
    let lastStartAttempt = 0
    let starting = false

    /** 这个界面是不是跑在电脑上（桌面端或本机浏览器）。 */
    const isPcSurface = () => {
      try {
        if (window.location.protocol === 'dsh-app:') return true
        const host = String(window.location.hostname || '')
        return host === '127.0.0.1' || host === 'localhost' || host === '::1'
      } catch (error) {
        return false
      }
    }

    /* ---------------------------------------------------------------- *
     * 渲染隔离：我们的渲染抛错绝不允许带崩宿主那个包。
     * ---------------------------------------------------------------- */
    const withBoundary = (label, Inner) => {
      class Boundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { err: null }
        }
        static getDerivedStateFromError(err) { return { err } }
        componentDidCatch(err) {
          console.warn('[dsh-lan-gate-button] ' + label + ' 渲染失败，已隔离', err)
        }
        render() {
          if (this.state.err) return h('span', { style: { fontSize: '10px', opacity: 0.6 } }, '⚠ 网关按钮')
          return h(Inner, this.props)
        }
      }
      Boundary.displayName = 'LanGateBoundary(' + label + ')'
      return Boundary
    }

    const DOT = {
      base: { width: '7px', height: '7px', borderRadius: '50%', flex: '0 0 auto' },
      /** 网关在跑且远程可用（实心绿）。 */
      up: { background: '#2ea043' },
      /** 网关在跑但只有局域网（空心绿）—— 侧栏收成 56px 轨道时也能一眼分辨。 */
      upLanOnly: { background: 'transparent', boxShadow: 'inset 0 0 0 2px #2ea043' },
      pending: { background: '#d29922' },
      down: { background: '#8b949e' },
      busy: { background: '#d29922' },
    }

    function LanGateButton(props) {
      // 侧栏可折叠成 56px 轨道，owner 用 wide 告诉我们当前是不是宽态。
      // 轨道态下文字放不下，只留一个状态点。
      const wide = !props || props.wide !== false
      const [state, setState] = React.useState({ phase: 'loading' })

      React.useEffect(() => {
        if (!isPcSurface()) return undefined
        let disposed = false

        const applySummary = (data) => {
          if (disposed || starting) return
          setState({ phase: 'ready', data })
        }

        // 只读轮询，不在这里自动拉起。理由：网络守卫会挡住非 192.168.x 网段，
        // 那种情况下自动重试会变成每轮都起一次 node 然后立刻退出（还每次轮转日志）。
        // 自愈交给计划任务的 5 分钟检查，拉起交给用户点击。
        const load = async () => {
          try {
            const response = await fetch(SUMMARY_URL, { cache: 'no-store' })
            applySummary(await response.json())
          } catch (error) {
            applySummary({ ok: false, running: false, adminUrl: FALLBACK_ADMIN })
          }
        }

        load()
        const timer = setInterval(load, POLL_MS)
        const onFocus = () => { load() }
        window.addEventListener('focus', onFocus)
        return () => {
          disposed = true
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [])

      if (!isPcSurface()) return null

      const data = (state.data || {})
      const running = data.running === true
      const pending = Number(data.pending || 0)
      const adminUrl = data.adminUrl || FALLBACK_ADMIN
      const busy = state.phase === 'starting'

      const port = Number(data.listenPort || 3089)
      const lanIp = String(data.lanIp || '')
      const tailscaleIp = String(data.tailscaleIp || '')
      const approved = Number(data.approved || 0)
      /**
       * 远程是否可用 = 本机有没有 Tailscale 的 100.x 地址。
       * 网关绑的是 0.0.0.0，所以只要本机有这张网卡、网关又在跑，外面就通。
       */
      const remoteReady = tailscaleIp !== ''

      let label
      let dot
      let title
      if (busy) {
        label = '正在启动…'
        dot = DOT.busy
        title = '正在通过计划任务拉起局域网网关'
      } else if (!running) {
        label = '启动手机网关'
        dot = DOT.down
        title = '网关当前没在运行。点一下拉起并打开批准页'
      } else {
        const mode = remoteReady ? '局域网＋远程' : '仅局域网'
        label = pending > 0 ? mode + ' · 待批 ' + pending : mode
        dot = pending > 0 ? DOT.pending : (remoteReady ? DOT.up : DOT.upLanOnly)
        const where = []
        if (lanIp) where.push('局域网 ' + lanIp + ':' + port)
        if (remoteReady) where.push('远程 ' + tailscaleIp + ':' + port)
        else where.push('没检测到 Tailscale 地址(100.x) —— 人在外面连不上')
        title = '网关运行中 · ' + mode + '\n' + where.join('\n') +
          '\n已批准 ' + approved + ' 台' + (pending > 0 ? '，待批准 ' + pending + ' 台' : '') +
          '\n点一下打开批准页'
      }

      const onClick = async () => {
        if (busy) return
        if (running) {
          // 同步打开：保留用户手势，稳妥走系统浏览器
          window.open(adminUrl, '_blank', 'noopener')
          return
        }
        starting = true
        lastStartAttempt = Date.now()
        setState({ phase: 'starting' })
        try {
          const response = await fetch(START_URL, { method: 'POST', cache: 'no-store' })
          const next = await response.json()
          setState({ phase: 'ready', data: next })
          if (next && next.running) window.open(next.adminUrl || adminUrl, '_blank', 'noopener')
        } catch (error) {
          setState({ phase: 'ready', data: { ok: false, running: false, adminUrl } })
        } finally {
          starting = false
        }
      }

      const pendingStyle = running && pending > 0
        ? { background: 'rgba(210,153,34,0.16)', borderColor: 'rgba(210,153,34,0.55)' }
        : null

      const compact = !wide
      const baseStyle = Object.assign({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? '0' : '6px',
        maxWidth: '100%',
        padding: compact ? '6px' : '4px 8px',
        margin: '0 2px',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '1.3',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: '6px',
        cursor: busy ? 'progress' : 'pointer',
        opacity: busy ? 0.75 : 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }, compact ? { width: '28px', height: '28px' } : null, pendingStyle)

      const children = [h('span', { key: 'dot', style: Object.assign({}, DOT.base, dot) })]
      if (!compact) {
        children.push(h('span', { key: 'label', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label))
      }

      return h('button', {
        type: 'button',
        onClick,
        title,
        'aria-label': title,
        style: baseStyle,
      }, children)
    }

    return {
      // 硬依赖：没有 slots 服务就注册不了插槽
      inject: ['slots'],

      apply(ctx) {
        // sidebar.footer.action 是 list 插槽（设置图标旁），qq2005 的时钟占着 order 5。
        // 绝不要往 sidebar.panellist 注册 —— 那是「主面板注册表」，注册进去会被布局
        // 当成可切换面板，抛未捕获异常把整个客户端插件激活搞挂（qq2005 真崩过两次）。
        const options = { name: 'sidebar.footer.action', id: 'dsh-lan-gate-button', order: 6 }
        try {
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(options, withBoundary('button', LanGateButton)),
          )
        } catch (error) {
          console.warn('[dsh-lan-gate-button] 插槽不可用，按钮未挂载: sidebar.footer.action', error)
        }
      },
    }
  },
})
