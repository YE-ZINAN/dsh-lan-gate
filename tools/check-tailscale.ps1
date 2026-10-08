<#
  dsh-lan-gate 远程访问自检（Tailscale）

  用途：装完 Tailscale 之后跑一次，把「主机侧」该看的全看一遍。
  门禁的真正验证要在手机上做 —— 本脚本只能证明链路通到了本机。

  用法：
      powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-tailscale.ps1

  注意：本文件必须保留 UTF-8 BOM（Windows PowerShell 5.1 按 GBK 读无 BOM 的 .ps1，
       中文会变乱码导致解析失败）。改完请复查前三字节是否 EF BB BF。
#>

$ErrorActionPreference = 'Continue'
$Root = Split-Path $PSScriptRoot -Parent

function Mark($ok, $text) {
    if ($ok) { Write-Host "  [OK]   $text" -ForegroundColor Green }
    else     { Write-Host "  [!!]   $text" -ForegroundColor Red }
}
function Warn($text) { Write-Host "  [??]   $text" -ForegroundColor Yellow }
function Head($text) { Write-Host "`n$text" -ForegroundColor Cyan }

$problems = 0

Head '1. Tailscale 客户端'

$tsExe = $null
foreach ($c in @((Get-Command tailscale -ErrorAction SilentlyContinue).Source,
                 'C:\Program Files\Tailscale\tailscale.exe')) {
    if ($c -and (Test-Path $c)) { $tsExe = $c; break }
}
if ($tsExe) { Mark $true "已安装：$tsExe" }
else { Mark $false '未安装。下载：https://tailscale.com/download/windows'; $problems++ }

$tsIp = $null
if ($tsExe) {
    # 网卡优先（不依赖 CLI 是否已登录）
    $nic = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Where-Object { $_.IPAddress -like '100.*' } | Select-Object -First 1
    if ($nic) {
        $tsIp = $nic.IPAddress
        Mark $true "Tailscale 网卡在线：$tsIp  ($($nic.InterfaceAlias))"
    } else {
        Mark $false '没有 100.x 网卡。Tailscale 已装但没登录，或服务没起来。'
        Warn '打开 Tailscale 托盘图标 → Log in（选 GitHub 登录，Google 在国内不通）'
        $problems++
    }
}

Head '2. tailnet 里的设备'

if ($tsExe -and $tsIp) {
    $st = & $tsExe status 2>&1
    if ($LASTEXITCODE -eq 0) {
        $lines = @($st | Where-Object { $_ -match '\S' })
        if ($lines.Count -ge 2) {
            Mark $true "tailnet 里有 $($lines.Count - 1) 台设备（除本机）："
            $lines | Select-Object -Skip 1 | ForEach-Object { Write-Host "         $_" }
        } else {
            Mark $false 'tailnet 里只有本机 —— 手机还没加进来。'
            Warn '手机装 Tailscale → 登录同一个账号 → 设备会出现在这里'
            $problems++
        }
    } else {
        Warn "tailscale status 返回非零：$st"
    }
} else {
    Warn '跳过（Tailscale 未就绪）'
}

Head '3. 网关进程'

$listen = Get-NetTCPConnection -LocalPort 3089 -State Listen -ErrorAction SilentlyContinue
if ($listen) {
    Mark $true "3089 监听中（$($listen.LocalAddress):3089，PID $($listen.OwningProcess)）"
    if ($listen.LocalAddress -eq '0.0.0.0') {
        Mark $true '绑定 0.0.0.0 —— Tailscale 网卡已被覆盖'
    } else {
        Mark $false "只绑了 $($listen.LocalAddress)，Tailscale 网卡收不到。需要 0.0.0.0。"
        $problems++
    }
} else {
    Mark $false '3089 没在监听。启动：wscript.exe "lan-gate-hidden.vbs"'
    $problems++
}

Head '4. 网络守卫判定'

$log = Join-Path $Root 'run.log'
if (Test-Path $log) {
    $guard = Get-Content $log -Encoding utf8 | Select-String '网络守卫' | Select-Object -Last 1
    if ($guard) {
        Write-Host "         $($guard.Line)"
        if ($guard.Line -match '100\.') {
            Mark $true '守卫已按 Tailscale 段放行'
        } elseif ($guard.Line -match '命中允许网段') {
            Warn '最近一次是靠 192.168. 放行的。Tailscale 起了之后重启网关再看这条。'
        } else {
            Mark $false '守卫拦住了 —— Tailscale 没起来，或允许网段里没有 100.'
            $problems++
        }
    } else {
        Warn '日志里没有守卫记录，先重启一次网关'
    }
} else {
    Warn "找不到 $log"
}

Head '5. 端口在 Tailscale 网卡上是否可达'

if ($tsIp) {
    try {
        $r = Invoke-WebRequest "http://${tsIp}:3089/__langate/admin" -UseBasicParsing -TimeoutSec 8
        Mark $true "从本机经 $tsIp 访问网关：HTTP $($r.StatusCode)"
        Warn '注意：本机访问会被判成「自己人」，所以这里 200 是正常的，不代表门禁通过'
    } catch {
        Mark $false "经 $tsIp 访问失败：$($_.Exception.Message)"
        Warn '多半是 Windows 防火墙拦了入站。若三个 profile 全关则不是这个原因。'
        $problems++
    }
} else {
    Warn '跳过（没有 Tailscale IP）'
}

Head '6. 电源与待机（远程访问的地基）'

$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bat) {
    if ($bat.BatteryStatus -eq 2) { Mark $true '已接交流电（不会因为没电掉线）' }
    else { Mark $false "BatteryStatus=$($bat.BatteryStatus) —— 看起来没插电。远程访问要求长期插电。"; $problems++ }
} else {
    Warn '读不到电池信息（可能是台式机或驱动问题），自行确认已插电'
}

Warn '本脚本查不到这两项，请自己确认：'
Write-Host '         - 电源计划是否已设为「从不睡眠」、合盖是否「不采取任何操作」'
Write-Host '         - Windows 更新是否已关闭自动重启（半夜重启 = 第二天失联）'

Head '结论'

if ($problems -eq 0 -and $tsIp) {
    Write-Host "  主机侧全部就绪。" -ForegroundColor Green
    Write-Host ""
    Write-Host "  手机上打开：  http://${tsIp}:3089" -ForegroundColor White
    Write-Host "  首次会停在「等待批准」，回电脑打开下面这个地址点「允许」：" -ForegroundColor White
    Write-Host "                http://127.0.0.1:3089/__langate/admin" -ForegroundColor White
} else {
    Write-Host "  还有 $problems 项没过，按上面的 [!!] 逐条处理。" -ForegroundColor Red
}

exit $problems
