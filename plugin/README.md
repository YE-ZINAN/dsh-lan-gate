# dsh-lan-gate-button

给 DSH 桌面端加一个「手机接入」按钮，放在左栏底部、设置图标旁边。

它解决的事：手机或 iPad 申请接入时，你得自己在浏览器里敲
`http://127.0.0.1:3089/__langate/admin` 才能点批准。这个按钮把它变成一次点击，
并且顺手把「有几台在等」显示出来。

## 它长什么样

按钮上有状态点和一个短标签，跟着网关状态变：

| 状态 | 显示 | 点下去 |
|---|---|---|
| 网关运行中，没人等 | ● 手机接入 | 打开批准页 |
| 有人举着手 | ● 待批准 2 | 打开批准页 |
| 网关没在跑 | ○ 启动手机网关 | 先经计划任务拉起网关，再打开批准页 |
| 正在拉起 | ○ 正在启动… | 忽略点击 |

侧栏折叠成 56px 轨道时只留状态点（文字放不下）。悬停有完整说明。

在手机/iPad 上它**不渲染** —— 那些界面是经网关访问的（主机名是局域网 IP），
在那边点这个按钮只会拿到 403，因为批准页服务端只认回环地址。桌面端加载的是
自定义协议 `dsh-app://app/`，不是 `127.0.0.1`，所以两种界面都要认。

## 装

要求网关本体已经在跑（这个插件是它的控制面，不是它本身）。

```powershell
# 官方安装器，不要用插件市场界面装（桌面端那个入口有已知的回滚问题）
dsh plugin --profile desktop add link:<本仓库>\plugin
```

或者装完之后手工在 profile 里确认两处：
`package.json` 的 `dependencies` 里有 `"dsh-lan-gate-button": "link:...\plugin"`，
`dsh.profile.bundles` 里有 `dsh-lan-gate-button`。两处都有才算装好。

改完客户端半区要刷新页面（或重启 DSH）才生效；宿主半区的路由改动也一样。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-lan-gate-button
  name: dsh-lan-gate-button
  config:
    gatewayPort: 3089     # 跟着 LAN_GATE_PORT 走
    taskName: dsh-lan-gate # 自启用的计划任务名
```

## 两边各干什么

宿主半区（`index.js`）注册两条**同源**路由，客户端在 `dsh-app://` 或
`127.0.0.1:19387` 上 fetch 它们，绕开跨域：

| 路由 | 作用 |
|---|---|
| `GET /dsh-lan-gate/summary` | 转发网关的 `/__langate/admin/summary`，把「有没有在跑、几台在等」交给界面 |
| `POST /dsh-lan-gate/start` | `schtasks /run /tn <taskName>`，然后轮询端口直到就绪 |

客户端半区（`client.js`）注册进 `sidebar.footer.action`（list 插槽），
点击走 `window.open`。桌面端主窗口装了 `setWindowOpenHandler`：

```js
window.webContents.setWindowOpenHandler(({ url }) => {
  if (["http:", "https:"].includes(new URL(url).protocol)) shell.openExternal(url);
  return { action: "deny" };
});
```

所以 `window.open('http://127.0.0.1:3089/__langate/admin')` 会交给系统默认浏览器，
不需要 IPC，也不需要改 Electron 配置。

## 为什么 start 走计划任务

因为它不能自己 `spawn('node', ['lan-gate.mjs'])`。

DSH 命令里起的进程属于那条命令的进程树。命令结束或被清理时整棵树一起被杀，
而且是被 `TerminateProcess` 硬杀 —— 进程自己的 SIGINT 处理函数都不会跑，
`stderr` 也是空的。2026-10-04 网关就是这么无声无息没了 22 小时：SIGINT 里那句
「退出。运行 Ns …」没出现，`run.err.log` 是 0 字节，两个都说明它不是崩溃、
也不是优雅退出。

计划任务起的进程不属于任何 DSH 命令树，所以不受这个牵连。任务本身还带一个
每 5 分钟重复的触发条件（见 `tools/install-autostart.ps1`），网关真死了会自己回来。

## 别踩的坑

- **别往 `sidebar.panellist` 注册任何东西。** 那看着是 list 插槽，实际是「主面板
  注册表」，注册进去会被布局当成可切换面板，抛未捕获异常把整个客户端插件的激活
  搞挂，应用起不来。
- 组件外面套了错误边界。宿主那个包（`sidebar`）不该被我们渲染失败带崩。
- 插槽注册包在 try/catch 里，插槽不可用时按钮不挂载而不是抛错。
