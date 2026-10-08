# 远程访问（本地专用）

> ⚠️ **本文件与它所在的 `remote` 分支不进公开仓库。**
> 公开仓库 `YE-ZINAN/dsh-lan-gate` 只保留局域网能力，且已停止投入（用户 2026-10-08 决定）。

---

## 1. 隔离规则

| 规则 | 说明 |
|---|---|
| 公开版 = `main` | 当前 `04af6c5`，与 `origin/main` 完全一致。**不再往里加东西。** |
| 远程功能 = `remote` 分支 | 本地创建，**无 upstream**，不推送 |
| `pre-push` 钩子 | `.git/hooks/pre-push`（不进仓库）。只要 `refs/heads/remote` 出现在推送的任一端就拒绝 |

已验证拦截这四种情况：

```
git push origin remote        → 拒绝
git push --all origin         → 拒绝
git push origin remote:main   → 拒绝（防把远程内容塞进 main）
git push origin main          → 放行
```

历史未改写、`main` 的分支指针没动过，公开仓库侧零变化。

---

## 2. 相对公开版改了什么

只有一处，`lan-gate.ps1` 第 31 行：

```diff
-    $env:LAN_GATE_ALLOW_NET = '192.168.'
+    $env:LAN_GATE_ALLOW_NET = '192.168.,100.'
```

`100.` 是 Tailscale 的 CGNAT 段（`100.64.0.0/10`）。**目的**：Tailscale 在线时本机会多出一张 `100.x` 网卡，网络守卫因此放行，手机可以从任意网络经 tailnet 连回来。

**代价（要知道）**：守卫的语义从「只在家才开」放宽为「在家，**或 Tailscale 在线（任意网络）**」。也就是说带着笔记本去咖啡厅时，Tailscale 一开，3089 端口在该网络上也会监听。

此时防线依赖的是**设备审批门禁**（未批准设备只能看到等待页，且批准动作只能在电脑本机做），网络守卫退化为第二层。若要把守卫重新收紧，把默认值写成你自己那一段即可（例如 `'192.168.1.,100.'`）。

网关本身**监听地址、门禁逻辑、手机排版、PWA 全部没动**——Tailscale 只是多一张网卡，走的还是原有那条链路。

---

## 3. 前置条件：电脑必须常开常连

不满足的话下面全部无效。**动手搭之前先做这四件事：**

1. 电源计划改为**从不睡眠**，合盖动作设为「不采取任何操作」
2. 设备管理器 → 网卡 → 电源管理 → 取消「允许计算机关闭此设备以节约电源」
3. **关掉 Windows 更新自动重启**（否则半夜重启，第二天远程直接失联）
4. 确认**一直插着电源**

原因：本机仅 S0 现代待机（无 S3、无休眠）、WOL 基本不可用（仅 Wi-Fi 无有线网卡）、且是笔记本。睡着之后唤不醒。

---

## 4. Tailscale 端到端步骤

> **装完先跑自检**，它会一次性检查客户端、网卡、tailnet 设备、网关进程、守卫判定、端口可达性、是否插电，并直接给出手机要打开的地址：
>
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-tailscale.ps1
> ```
>
> 退出码 = 未通过项数，`0` 表示主机侧全部就绪。它查不到的只有两项（电源计划、Windows 更新自动重启），会打印出来提醒你自己确认。

### 4.1 装与登录

| 端 | 操作 |
|---|---|
| 电脑 | `winget install tailscale.tailscale`，或官网下载。装完登录 |
| 手机 | App Store / Play 搜 Tailscale，装完登录**同一个账号** |

> **登录方式选 GitHub**。Google 账号在国内不通；Tailscale 支持 GitHub / Microsoft / 邮箱。

### 4.2 确认两端互联

```powershell
tailscale status          # 应能看到手机和电脑两台设备
tailscale ip -4           # 电脑的 100.x 地址，手机要连这个
```

### 4.3 确认守卫放行

重启网关，日志里应出现：

```
网络守卫通过: 本机 100.x.y.z 命中允许网段 [192.168., 100.]
```

网关重启方式（**必须走 VBS**，否则进程会被父进程带走）：

```powershell
wscript.exe "<仓库路径>\lan-gate-hidden.vbs"
```

### 4.4 手机连接

1. 手机浏览器打开 `http://<电脑的 100.x 地址>:3089`
2. 首次会停在**「等待批准」**页
3. 电脑本机浏览器打开 `http://127.0.0.1:3089/__langate/admin`
4. 在「待批准」里找到手机 → 点「允许」
5. 手机页面 1~2 秒内跳进 DSH

之后只要电脑上的网关还在跑，手机再打开就直接进，不用重新批准。

### 4.5 直连还是走中继

```powershell
tailscale ping <手机设备名>
```

- 显示 `via DERP` → 走中继，延迟高
- 显示直连地址 → 打洞成功，速度好

官方 DERP 在中继时体验一般。若长期走 DERP 且延迟不可接受，社区做法是[自建大陆 DERP 节点](https://github.com/bobvane/VPS-Tailscale-DERP-AutoSetup)，但那需要一台有公网 IP 的机器（要花钱）。

---

## 5. 已知限制

| 项 | 说明 |
|---|---|
| **明文 HTTP** | 手机连的是 `http://100.x:3089`，同 tailnet 内的流量由 WireGuard 加密，但**浏览器侧不是安全上下文** → PWA 的 service worker 用不了（与公开版的局域网状态一致，没有退步） |
| **不能用 `tailscale serve`** | 它会以 `127.0.0.1` 作为来源转发，被网关判成「本机自己」→ **门禁被绕过**。要用得改代码读 `X-Forwarded-For`，暂不做 |
| **手机端要装 App** | 不装就没有 tailnet 出口。相比之下公网隧道方案手机只用浏览器 |
| **依赖 Tailscale 控制面** | 登录与密钥交换走 `controlplane.tailscale.com`；数据面才可能直连 |

---

## 6. 两个踩过的坑（别重犯）

### 6.1 `.ps1` 的 UTF-8 BOM 会被编辑器/工具抹掉

本仓库 `.gitattributes` 已写明这条，但 2026-10-08 再次踩到：`edit` 工具改写 `lan-gate.ps1` 后 BOM 丢失。

**后果**：自启任务走 `wscript.exe → powershell.exe`（5.1），它按 GBK 读 `.ps1`，中文变乱码 → 字符串未闭合 → **不报错、不输出、直接卡死**，排查极具误导性。

**判据**：文件前 3 字节必须是 `EF BB BF`。

```powershell
$b = [System.IO.File]::ReadAllBytes('lan-gate.ps1')
$b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF   # 必须为 True
```

**改完 `.ps1` 一定要复检 BOM。** 用 `pwsh` 测不出问题（7.x 默认 UTF-8），必须用 `powershell.exe` 验：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File lan-gate.ps1 status
```

### 6.2 从工具里起的网关会被父进程带走

`lan-gate.ps1 start` 从别的进程里调用时，node 会成为其子进程。**父进程被 kill 时 node 一起死**（实测：kill 掉一个后台 pwsh 任务，3089 立刻无监听）。

**正确做法**：走 `wscript.exe lan-gate-hidden.vbs`（`WScript.Shell.Run` 带隐藏窗口且不等待，真正脱离）。这也是自启任务用的路径。

---

## 7. 公开版怎么维护

已决定**不再投入**。若将来确实要推公开更新：

```powershell
git checkout main
# 在 main 上改，不要从 remote 挑
git push origin main
git checkout remote
```

要公开的改动如果也存在于 `remote`，**手工重做一遍**，不要 cherry-pick——避免把远程相关的东西顺带带过去。

---

## 8. 验收记录（2026-10-08，**通过**）

**验收方式：用户人在外面，手机断开 WiFi、仅用移动网络，成功经 Tailscale 访问电脑上的 DSH。当次会话就是手机远程发出的。**

| 环节 | 实测读数 |
|---|---|
| Tailscale | 1.102.4；本机 `<桌面机设备名>` = **100.101.102.103**；手机 `<手机设备名>` = `100.101.102.104` |
| 连通方式 | **打洞直连** —— `tailscale ping` → `pong via <公网地址>:<端口> in 140ms`（未走 DERP 中继） |
| 网络守卫 | `网络守卫通过: 本机 100.101.102.103 命中允许网段 [192.168., 100.]` |
| 端口可达 | 手机请求**实际到达网关**（不是本机打自己的自测） |
| 门禁 | 手机被正确拦为「新设备待批准」→ 批准 → 放行。**证明手机经 tailnet 进来时不会被误判成「本机」** |
| 最终 | 手机加载 DSH，`WS 升级: /api/remote.mux`，3089 上手机侧 **7 条活跃连接** |
| 自检脚本 | `tools/check-tailscale.ps1` 退出码 **0** |

改代码的总量：**一行**（守卫默认值加 `100.`）。其余全是配置与文档。

### 两个自己造成的误判（记录备查）

1. **自检脚本第 5 项判据写反。** 原逻辑把 HTTP 403 当失败、并误报为防火墙问题。实际上能拿到任何 HTTP 响应都说明端口可达；403 恰恰证明管理台的「仅本机」栅栏在工作。已修（`edb9ddc` 之后的 `8ec3831`）。
2. **批准前查日志判断「手机没连上」——错的。** 等待页的 `/__langate/status` 轮询**不写日志**，所以日志里没有手机 IP ≠ 没有流量。
   → **正确判据**：`Get-NetTCPConnection -LocalPort 3089` 按对端 IP 分组计数；以及日志里的 `WS 升级` 行。

### ⚠️ 尚未完成（当前方案最脆弱的一环）

- 电源计划「从不睡眠」+ 合盖「不采取任何操作」——**未核实**
- Windows 更新自动重启——**未关闭**

这两项任一发生，人在外面就失联，**而且不会有任何提示**。功能已经能用，但可用性目前建立在这两条手工设置上。

