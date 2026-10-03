# dsh-lan-gate

> [English](README.en.md) | 中文

让**手机 / iPad** 在同一个 WiFi 下安全地访问电脑上的 **DeepSeek Harness 桌面端**。

```
手机 / iPad ──▶ dsh-lan-gate（本机 Node，0.0.0.0:3089）──▶ DSH Web（127.0.0.1:19387，只认本机）
                    ↑
            未批准设备只看到「等待批准」页；
            批准动作只能在这台电脑上点。
```

DSH 本体仍然只监听 `127.0.0.1`，**从不暴露到局域网**。网关是唯一入口。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [快速开始](#快速开始)
- [手机 / iPad 怎么连](#手机--ipad-怎么连)
- [门禁：新设备批准](#门禁新设备批准)
- [手机端排版](#手机端排版)
- [加到主屏幕（PWA）](#加到主屏幕pwa)
- [调试开关](#调试开关)
- [配置项](#配置项)
- [文件结构](#文件结构)
- [数据落盘位置](#数据落盘位置)
- [测试](#测试)
- [换 App 图标](#换-app-图标)
- [排障](#排障)
- [安全边界](#安全边界)
- [已知限制](#已知限制)

---

## 它解决什么问题

官方 CLI **有意禁止** `--host 0.0.0.0`——因为 DSH Web 的 `/api` 没有独立的认证层，直接暴露等于把控制权交给同网段任何人。

而 DSH Web 本身带一套真实鉴权（启动令牌 + Host 绑定的签名 Cookie），这套机制恰好允许一个反向代理在本机替远端客户端完成认证。本网关做的就是这件事，并在其上叠加一层**设备审批门禁**。

**为什么不用现成的第三方插件**：调研过 `dsh-mobile-gate`、`@linxin666/dsh-remote-web-ui`、`dsh-auth-gate` 等（记录在 Mnemon 文档《dsh-lan-gate 总档》）。主要顾虑是 desktop profile 兼容性与供应链风险，且自己实现只需要一个零依赖的 Node 脚本。

---

## 快速开始

需要 **Node.js 18+**（用到 `crypto.randomUUID`、`fetch` 等内置能力；实测在 Node 24 上运行）。**零第三方依赖。**

```powershell
# 在 dsh-lan-gate 目录下
.\lan-gate.ps1 start      # 启动（后台）
.\lan-gate.ps1 status     # 看状态（默认动作）
.\lan-gate.ps1 stop       # 停止
.\lan-gate.ps1 restart    # 重启
.\lan-gate.ps1 log        # 看最近 30 行日志
```

也可以**双击 `lan-gate.cmd`**（内部已带 `-ExecutionPolicy Bypass`，不受脚本执行策略影响）。

启动后 `status` 会打印：

```
状态: 运行中    PID 12345    启动于 ...
监听: 0.0.0.0:3089

访问地址:
  电脑本机 : http://127.0.0.1:3089
  手机/iPad: http://192.168.x.x:3089
  管理台   : http://127.0.0.1:3089/__langate/admin

已批准设备 2 台    待批准 0 台
  [已批准] Android · Chrome  @ 192.168.1.42
  [已批准] Mac · Safari  @ 192.168.1.77
```

> ⚠️ **`lan-gate.ps1` 必须存成 UTF-8 带 BOM。** Windows PowerShell 5.1 默认按 GBK 读取 `.ps1`，无 BOM 时中文会被读成乱码，产生未闭合字符串并导致脚本**卡死**（不报错、不输出）。改这个文件后如果卡住，先查 BOM。

---

## 开机自启与网络守卫

网关是普通 Node 进程，**默认不会自动启动**。当前配置为：**登录 Windows 后延迟 30 秒自动启动**（等 DSH 先把 19387 监听起来），**并且只在指定网段才启动**。

### 网络守卫（重要）

本机**防火墙三个 profile 全是关的**（作者机器实测）。网关一旦监听 `0.0.0.0:3089`，在任意网络下端口都对同网设备开放。配合开机自启，就会出现「带着笔记本去咖啡厅，网关照样裸挂在公共网络上」。

所以网关在 `listen` **之前**会检查本机 IP：

```
网络守卫通过: 本机 192.168.1.23 命中允许网段 [192.168.1.]
```
```
网络守卫拦截: 本机 IP [10.0.2.15] 都不在允许网段 [192.168.1.]
  这是为了防止在不可信网络下暴露 3089 端口。确实要启动就清掉环境变量 LAN_GATE_ALLOW_NET。
```

拦截时**端口根本不会打开**（不是"先监听再关闭"——那会留下一个能被扫到的窗口），进程立即退出。

- 默认允许网段写在 `lan-gate.ps1` 顶部（默认 `192.168..`，覆盖绝大多数家用路由器）
- **想更严就写死成你自己那一段**（例如 `192.168.10.`），这样手机热点等同样是 `192.168.x` 的网络也会被挡
- 可写多段：`$env:LAN_GATE_ALLOW_NET = '192.168.10.,10.0.0.'`
- **临时放行（本次运行有效）**：`$env:LAN_GATE_ALLOW_NET='off'; .\lan-gate.ps1 start`

### 自启是怎么配的

一个叫 **`dsh-lan-gate`** 的计划任务：

| 项 | 值 |
|---|---|
| 触发 | 登录时（当前用户），**延迟 30 秒** |
| 动作 | `wscript.exe lan-gate-hidden.vbs` |
| 效果 | 用 WScript 拉起 `lan-gate.ps1 start`，**窗口完全隐藏**（否则每次登录会闪一下黑窗口） |
| 退出码 | 0（正常）；被守卫拦截时也是 0，原因写在 `run.log` |

```powershell
# 查看
Get-ScheduledTask -TaskName 'dsh-lan-gate' | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName 'dsh-lan-gate'     # 看上次运行结果

# 手动触发一次（不重启也能验证）
Start-ScheduledTask -TaskName 'dsh-lan-gate'

# 停用 / 恢复
Disable-ScheduledTask -TaskName 'dsh-lan-gate'
Enable-ScheduledTask  -TaskName 'dsh-lan-gate'

# 彻底删除（回到纯手动）
Unregister-ScheduledTask -TaskName 'dsh-lan-gate' -Confirm:$false
```

> **自启的前置条件**：网关只是代理，**DSH 桌面端自己也得在跑**（监听 19387）。如果 DSH 没起，手机访问会看到 502——不是崩溃，DSH 起来后自动恢复。

---

## 手机 / iPad 怎么连

1. **确认同一 WiFi**：手机/iPad 与电脑连同一个网络，不要用蜂窝流量。
2. **打开浏览器**：
   - 安卓：Chrome
   - iPad/iPhone：**必须用 Safari**（Chrome 在 iOS 上无法「添加到主屏幕」）
3. **访问** `http://<电脑局域网IP>:3089`（IP 见 `status` 输出）
4. 首次会看到「**等待电脑批准**」页 → 见下一节
5. 批准后自动进入 DSH，此后该设备免批准

---

## 门禁：新设备批准

新设备首次访问**碰不到 DSH**，只会拿到一张等待页。批准动作**只能在电脑本机**完成：

1. 电脑浏览器打开 `http://127.0.0.1:3089/__langate/admin`
2. 在「**待批准**」里找到那台设备（显示设备名 + IP）
3. 点「**允许**」
4. 手机页 1~2 秒内自动跳入 DSH

管理台还支持「拒绝」「撤销」「撤销全部已批准设备」。撤销过的设备需要重新批准。

### 三条防线

| 防线 | 实现 |
|---|---|
| 未批准设备碰不到 DSH | 网关前置拦截，只返回等待页；DSH 本体不暴露 |
| 批准动作只能在电脑上做 | 管理页与批准 API **只接受回环地址**，手机猜到网址也被 403 |
| 令牌不可复用 | 设备令牌用**独立随机密钥**签 HMAC，绑定设备 ID 与有效期，可随时撤销 |

另有**每 IP 每分钟 600 次**限流。

> **本机自己不算「设备」**：网关把「回环地址 + 本机各网卡地址」都视为自己人，直接直通、不登记。
> 否则从本机用局域网 IP 访问自己时（来源 IP 不是 `127.0.0.1`），门禁会把它当成一台新设备登记进状态文件——
> 端到端测试的场景 3 正好就是这么访问的，每跑一次就留下一台假设备。这个问题已在网关层根治。

---

## 手机端排版

窄屏下网关会注入一套排版修正（**DSH 桌面端不受影响**，因为桌面 App 根本不经过网关）。

**做了什么：**

| 项 | 处理 |
|---|---|
| 侧栏 | 改成覆盖式抽屉，默认收起；左上角 `☰` 开合 |
| 主内容 | 占满屏宽（宿主用 CSS Grid 把侧栏宽度写死在轨道里，必须改**轨道**而非元素宽度） |
| 会话题头 / 对话·轨迹 tab | 隐藏 |
| QQ2005 皮肤浮层与工具条 | 隐藏（否则遮挡对话区） |
| 上下文百分比圆环 | 隐藏 |
| 触摸目标 | 按钮最小 40px；输入区贴底并适配安全区 |
| 根容器 | 禁止横向溢出 |

**手机 vs 平板（重要差异）：**

- **手机**：规则包在 `@media (max-width: 860px)` 里。
- **iPad**：iPadOS 的 Safari **把自己伪装成 Mac**（UA 里没有 `iPad`），服务端认不出来；而且 iPad 竖屏 1024px、横屏 1366px **都超过 860**，靠断点永远命中不了。

  所以网关**同时注入第二套「无断点」样式**（默认 `media="not all"` 关闭），由客户端脚本用「**触点数 > 1 且 UA 像 Mac**」识别 iPad（Mac 笔记本触点为 0）后打开。**结果：iPad 竖屏横屏都走手机排版。**

---

## 加到主屏幕（PWA）

局域网 `http://` 下**浏览器不会自动弹安装横幅**（那需要 HTTPS），但「添加到主屏幕 / 图标 / 全屏无地址栏」都能做到。

**iPad / iPhone（Safari）**：分享按钮 → 往下滑 → 「添加到主屏幕」→ 添加

**安卓（Chrome）**：右上角 ⋮ → 「添加到主屏幕」/「安装应用」

**⚠️ 换过图标后必须删掉旧图标再加一次。** iOS 会把桌面图标按网址**缓存**，连「这个网站没有图标」这个失败结论也一起缓存。

**实现要点：**宿主 HTML 里**已经有一个 `manifest` 链接且排在最前面**，浏览器只认第一个，所以网关再注入一个会被完全忽略。正解是**在网关层接管宿主那个路径**（`/manifest.webmanifest`），返回我们自己的清单。

---

## 调试开关

都是 URL 查询参数，**只对当前这次导航有效**，刷新需重新附加。

| 参数 | 作用 |
|---|---|
| `?mobile=0` | **完全不注入**排版样式（手机/iPad 上出现异常时的紧急回退） |
| `?mobile=1` | 强制注入（用于在桌面浏览器上对比手机排版效果） |
| `?dev=1` | 页面加载 1.8 秒后**自动上报真实 DOM 结构**，底部弹绿/红提示条告知成败 |
| `?hide=<选择器>[,<选择器2>]` | 临时把匹配元素设为 `display:none`，并告知每个选择器命中几个元素 |

`?hide=` 的用途：现场试出「是哪个元素在挡视线」，确认后固化进 `lib/mobile.mjs`。

---

## 配置项

全部通过环境变量，均有默认值：

| 变量 | 默认 | 说明 |
|---|---|---|
| `LAN_GATE_PORT` | `3089` | 网关监听端口 |
| `LAN_GATE_HOST` | `0.0.0.0` | 网关监听地址 |
| `LAN_GATE_UPSTREAM_HOST` | `127.0.0.1` | 上游 DSH 地址 |
| `LAN_GATE_UPSTREAM_PORT` | `19387` | 上游 DSH 端口 |
| `LAN_GATE_RATE_LIMIT` | `600` | 每 IP 每分钟请求上限 |
| `LAN_GATE_ALLOW_NET` | 由 `lan-gate.ps1` 设为 `192.168.` | **网络守卫**：本机 IP 命中这些前缀才允许启动（逗号分隔）。留空 = 不限制；`off` = 显式关闭守卫 |

> 上游地址会被**固定改写**成 `host:port` 形式发给 DSH。这是方案核心：DSH 用 `sha256(Host)` 计算会话 Cookie 名，固定 Host 后鉴权才闭环。
>
> `LAN_GATE_ALLOW_NET` 由 `lan-gate.ps1` 在启动 node 前注入；直接 `node lan-gate.mjs` 时它默认是空的（不限制）。

---

## 文件结构

```
dsh-lan-gate/
├── lan-gate.mjs            入口：代理、Host/Origin 改写、门禁拦截、页面注入
├── lan-gate.ps1            启停脚本（start/stop/restart/status/log）+ 网络守卫默认值
├── lan-gate.cmd            双击入口（绕过脚本执行策略）
├── lan-gate-hidden.vbs     计划任务用的隐藏窗口启动器（ASCII-only）
├── README.md               本文件（中文）
├── README.en.md            English version
├── LICENSE                 MIT
├── NOTICE.md               说明与免责（安全须知、依赖与素材、商标）
├── .gitignore              排除运行日志与本地状态
├── lib/
│   ├── auth.mjs            两套令牌：DSH 会话 Cookie 自签 + 本网关设备令牌
│   ├── store.mjs           状态持久化（原子写）+ 每 IP 限流
│   ├── pages.mjs           网关自有页面（等待批准页 / 管理台 / 限流页）
│   ├── mobile.mjs          手机与平板排版注入 + 诊断上报
│   └── pwa.mjs             manifest、图标路由、Apple 全屏 meta
├── assets/                 App 图标（由 tools/make-icons.py 生成）
│   ├── icon-180.png        iOS apple-touch-icon
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── icon-source.png     裁掉留白后的母图（备查）
├── test/                   自动化测试
│   ├── run-all.mjs         一次跑全部并汇总
│   ├── test-gate.mjs       门禁：审批状态机 + 管理接口
│   ├── test-mobile.mjs     排版注入（含桌面不受影响的断言）
│   ├── test-pwa.mjs        manifest / 图标 / 注入标签
│   ├── test-mobile-flow.mjs 端到端：模拟手机走完整路径
│   ├── test-ws.mjs         WebSocket 升级穿透
│   └── test-routes.mjs     真实 API 路径 + Origin 栅栏
└── tools/                  开发与运维辅助（运行时不需要）
    ├── make-icons.py       从一张母图生成全套 App 图标
    ├── check-templates.mjs 防再犯：检查模板字符串里的裸反引号
    ├── verify-inject.mjs   断言注入结构（断点位置、花括号配平）
    ├── verify-ua.mjs       各 UA 下的注入行为对照
    ├── probe-lan.mjs       走局域网 IP 探查（会在状态里留一台待批准设备）
    ├── probe-ipad-icon.mjs iPad 实际拿到的图标标签与资源
    ├── recon-layout.mjs    量宿主布局（盒模型链路）
    ├── exp-cookie.mjs      自签 Cookie 可行性实验（历史取证）
    ├── test-api.mjs        早期路由猜测探测（结论：不可靠，已被 test-routes 取代）
    ├── recon-css.mjs       早期 CSS 侦察（已被取代）
    ├── recon-css2.mjs      同上
    └── probe.mjs           最初的探路版（历史）
```

---

## 数据落盘位置

都在 `%USERPROFILE%\.dsh\` 下：

| 文件 | 内容 |
|---|---|
| `lan-gate-state.json` | 已批准 / 待批准设备清单、限流桶 |
| `lan-gate-secret` | 本网关的设备令牌签名密钥（首次运行自动生成，权限 600） |
| `lan-gate-domreport.json` | `?dev=1` 时手机上报的真实 DOM 结构（诊断用，覆盖写） |

日志在项目目录下：`run.log`、`run.err.log`。

**DSH 自身的会话 Cookie 签名密钥**从 `~/.dsh/.credentials.yaml` 读取（`client-connection/browser-session.secret`）——网关照 DSH 自己的算法自签会话 Cookie，因此**不需要重启 DSH、也不需要用户粘贴启动令牌**。

---

## 测试

```powershell
node test\run-all.mjs
```

依次运行全部套件并打印汇总表。**每个套件都有真实断言和退出码**（不是只打印结果）：

| 套件 | 断言数 | 覆盖什么 |
|---|---|---|
| `test-gate.mjs` | 7~11 | 管理台、批准/撤销状态机落盘、限流、轮询接口 |
| `test-mobile.mjs` | 19 | 手机/平板注入、桌面不受影响、`?mobile=0/1` 回退 |
| `test-pwa.mjs` | 45 | manifest 字段、4 张图标（PNG 魔数+尺寸+长度）、注入标签、宿主路径接管 |
| `test-mobile-flow.mjs` | 7 | 端到端四场景（首访/带 Cookie/局域网 IP/静态资源） |
| `test-ws.mjs` | 3 | WebSocket 握手穿透 + 非端点不被误接 |
| `test-routes.mjs` | 4 | 真实 API 返回 JSON、404 而非 401、Origin 改写生效 |

**需要走真实局域网路径的那条用例**（「从局域网 IP 访问」）要你提供本机 IP，否则会自动跳过：

```powershell
$env:DSH_LAN_IP='192.168.1.23'; node test\run-all.mjs
```

> 代码里**不写死任何个人 IP** —— 写死了别人 clone 下来就跑不了，对自己也没好处。
> 配置集中在 `test/config.mjs`。

另有结构性验证（在 `tools/` 下，不常跑）：

- `node tools\verify-inject.mjs` —— 断言注入的 CSS 花括号配平、每条关键规则都落在 `@media` 内
- `node tools\verify-ua.mjs` —— 9 项：各 UA（iPad 伪装 Mac / 手机 / 桌面 / Mac 笔记本）下的注入行为对照
- `node tools\check-templates.mjs <文件>` —— 防再犯守卫：检查模板字符串里的裸反引号（见[排障](#排障)）

> **门禁测试只操作它自己造的设备，绝不碰真实设备。** 早期版本用过「设备列表里第一个」，会对你真实的手机做「撤销→重新批准」，中途出错就把设备锁在门外。这个坑已修：脚本只认 id 以 `testdevice` 开头的条目，没有就跳过并提示。

> **测试脚本自身的坑**：`test-ws.mjs` 早期漏了 socket 的 `close` 事件处理——上游直接断开而不发数据时 Promise 永不 settle，事件循环变空，**Node 静默 exit 0**，后面的路径根本没测（表现为「只打印第一行就结束」）。任何用裸 socket 写测试的地方都要记住处理 `close`。

---

## 换 App 图标

`tools/make-icons.py` 从**一张母图**生成全套图标：

```powershell
python tools\make-icons.py <母图路径>
```

脚本会：自动裁掉母图四周留白 → 按比例缩放居中 → 输出 180 / 192 / 512 / maskable-512 四张。背景取母图四角采样色（**必须不透明**，iOS 对带透明通道的 `apple-touch-icon` 合成行为不确定）。

**换完图标后必须做一件事**：把 `lib/pwa.mjs` 里的 `ICON_VERSION` 加一。

```js
export const ICON_VERSION = '3';   // 换成 '4'
```

原因：iOS 会缓存「本网站没有可用图标」这个结论。早期版本这里指向 SVG（**iOS 不支持 SVG 作桌面图标**），那次失败被缓存住，之后换成 PNG 只要 URL 不变，iOS 仍可能沿用旧结果。加版本号可强制重新抓取。

---

## 排障

### 「改了配置但行为没变」

**先确认进程真的重启了、再怀疑代码。** 网关崩溃时**旧进程可能还活着**并继续服务，表现为「改了半天毫无效果」。

排查顺序：

1. `node --check <改过的文件>` —— 语法错误会让新版根本起不来
2. `.\lan-gate.ps1 restart` 后看 `status` 的 PID 有没有变
3. 看 `run.err.log` 有没有报错
4. 还不对再怀疑浏览器缓存

**特别提醒**：`lib/mobile.mjs` 里的 CSS / JS 是**模板字符串**。在里面的**注释**里写裸反引号会提前截断字符串 → 语法错误 → 网关启动即崩。这个错**犯过两次**，所以有 `tools/check-templates.mjs` 守着，改完先跑它。

### 「手机浏览器还是旧页面」

HTML 响应已带强禁缓存头（`no-store, no-cache, must-revalidate, max-age=0` + `pragma` + `expires`）。仍然怀疑缓存时，加个时间戳参数开新 URL：

```
http://<IP>:3089/?t=12345
```

### 「iPad 上还是桌面排版」

1. 确认已在电脑上**批准**该 iPad
2. 检查页面里有没有 `langate-tablet-css`（用 `node tools\probe-ipad-icon.mjs`）
3. iPad 识别依赖「触点数 > 1 且 UA 像 Mac」。若 UA 是别的形态，需要扩充 `lib/mobile.mjs` 里的 `detectTablet()`

### 「手机连不上」

- 确认同一 WiFi、没用蜂窝
- `.\lan-gate.ps1 status` 看监听是否正常
- Windows 防火墙：作者机器实测三个 profile 全关，无需加规则；若你开了防火墙，需要放行 3089 入站

### 探针脚本污染了设备列表

`tools/probe-lan.mjs` 等从**本机用局域网 IP** 访问时，来源 IP 不是回环，会被当成一台新设备登记。清理：

```powershell
# 手工编辑 %USERPROFILE%\.dsh\lan-gate-state.json，删掉 ip 为本机局域网 IP 的条目
```

`probe-ipad-icon.mjs` 已改为默认走回环，不会再污染。

---

## 安全边界

**能防住的：**

- 同 WiFi 的陌生设备：看不到 DSH，只能看到等待页
- 猜到管理台网址的手机：回环校验直接 403
- 令牌伪造：设备令牌用独立密钥签 HMAC，密钥不在设备上
- 暴力尝试：每 IP 每分钟 600 次限流
- 设备丢失：可在管理台撤销，该设备立即失效

**防不住的（重要）：**

- **明文 HTTP**。Cookie 与内容都不过 TLS，同一 WiFi 下的抓包者能看到流量。**只应在可信局域网使用。**
- **手机被解锁后被人拿到**。设备令牌存在浏览器里，解锁即等于放行。这是「不做指纹」的既定取舍。
- **网关进程持有 DSH 会话的签名能力**（它要替远端客户端签 Cookie）。也就是说，**能读 `~/.dsh/.credentials.yaml` 的本机进程，本来就能直接进 DSH**——网关没有扩大这个信任边界，但也没有缩小它。
- **本机三个防火墙 profile 全关**（作者机器实测）。这意味着本机其他开放端口同样对局域网可见。网关只负责自己那一个端口。
  → **缓解措施：[网络守卫](#开机自启与网络守卫)**。它让网关只在指定网段启动，避免带着笔记本连公共网络时端口照常敞开。

---

## 已知限制

1. **不含 HTTPS**。要指纹/面容认证必须先有安全上下文——局域网 HTTP 下 WebAuthn 被浏览器规范禁用。原生壳（Tauri/Capacitor）可绕过，但需重打包，且 iOS 侧载受签名限制。**当前选择：不加指纹，用「电脑上亲手批准」代替。**
2. **Android APK 未做**。评估结论：工具链全缺（无 JDK/SDK/Rust）、C 盘空间紧张；若做应走原生 WebView 壳（约 1 MB），唯一实质收益是原生指纹。暂缓。
3. **iPad 识别是启发式的**（触点数 + Mac UA）。若未来 iPadOS 改变 UA 形态，需要更新 `detectTablet()`。
4. **静态资源未发 ETag / Last-Modified**。HTML 用强禁缓存兜住了，但静态资源的缓存行为依赖上游。
5. **宿主类名是哈希的**，排版规则依赖运行时实测出的类名（`BynINW_*`、`_2H3hWW_*`、`dsh-skin-qq2005-*`）。**DSH 升级后如果改名，排版会失效**——重新用 `?dev=1` 上报 DOM 即可定位。

---

## 相关文档

完整的设计取证、踩坑记录与维护者结论见 Mnemon 项目文档：

> **《dsh-lan-gate 总档：手机局域网操控 DSH 的网关（鉴权取证/门禁/手机排版/PWA/CDP 调试）》**

包含：DSH Web 鉴权机制的宿主源码取证（asar 行号）、Cookie 精确格式、`/api` 的 Origin 栅栏、真实路由命名、adb→Chrome CDP 真机调试通道、以及全部踩坑的根因分析。

---

## 许可与免责

MIT，见 [LICENSE](LICENSE)。

**使用前请读 [NOTICE.md](NOTICE.md)**，里面有必须知道的安全前提：必须与 DSH 同机运行、明文 HTTP 无加密、会读取本机 DSH 凭据文件、不要暴露到公网、设备令牌存在浏览器里。

本项目是**非官方社区工具**，与 DeepSeek 官方无关联。
