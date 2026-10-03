param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'log')]
    [string]$Action = 'status'
)

# dsh-lan-gate 启停脚本
#   .\lan-gate.ps1 start    启动（后台）
#   .\lan-gate.ps1 stop     停止
#   .\lan-gate.ps1 restart  重启
#   .\lan-gate.ps1 status   查看状态（默认）
#   .\lan-gate.ps1 log      看最近日志

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Entry = Join-Path $Root 'lan-gate.mjs'
$LogOut = Join-Path $Root 'run.log'
$LogErr = Join-Path $Root 'run.err.log'
$Port = 3089

# 网络守卫：只有本机 IP 命中这些前缀时才允许启动（逗号分隔，可写多段）。
# 目的：本机防火墙三个 profile 全关，网关一旦监听 0.0.0.0:3089，在任意网络下
# 端口都对同网设备开放。配合开机自启就会出现「带笔记本去咖啡厅也照挂」。
#   · 默认 '192.168.' 覆盖绝大多数家用路由器；能挡住 10.x / 172.x / 公共网络
#   · 想更严就写死成你自己那一段（例如 '192.168.10.'）——手机热点同样是
#     192.168.x，写死之后在热点上也不会启动
#   · 临时放行（本次运行有效）：$env:LAN_GATE_ALLOW_NET='off'; .\lan-gate.ps1 start
if ($env:LAN_GATE_ALLOW_NET -eq 'off') {
    $env:LAN_GATE_ALLOW_NET = ''
} elseif ([string]::IsNullOrWhiteSpace($env:LAN_GATE_ALLOW_NET)) {
    $env:LAN_GATE_ALLOW_NET = '192.168.'
}

function Get-GateProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'lan-gate\.mjs' }
}

function Test-Port {
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Show-Status {
    $net = $env:LAN_GATE_ALLOW_NET
    if (-not $net) { $net = '不限制（LAN_GATE_ALLOW_NET=off）' }
    Write-Host "网络守卫: 允许网段 [$net]"
    $p = Get-GateProcess
    if (-not $p) {
        Write-Host '状态: 未运行'
        return $false
    }
    $listen = Test-Port
    Write-Host ("状态: 运行中    PID {0}    启动于 {1}" -f $p.ProcessId, $p.CreationDate)
    Write-Host ("监听: {0}" -f $(if ($listen) { "0.0.0.0:$Port" } else { "未监听（异常）" }))

    if (-not $listen) { return $true }

    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    Write-Host ''
    Write-Host '访问地址:'
    Write-Host ("  电脑本机 : http://127.0.0.1:{0}" -f $Port)
    foreach ($ip in $ips) { Write-Host ("  手机/iPad: http://{0}:{1}" -f $ip, $Port) }
    Write-Host ("  管理台   : http://127.0.0.1:{0}/__langate/admin" -f $Port)

    $statePath = Join-Path $env:USERPROFILE '.dsh\lan-gate-state.json'
    if (Test-Path $statePath) {
        try {
            $st = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $devs = @($st.devices.PSObject.Properties | ForEach-Object { $_.Value })
            $ok = @($devs | Where-Object { $_.status -eq 'approved' }).Count
            $pend = @($devs | Where-Object { $_.status -eq 'pending' }).Count
            Write-Host ''
            Write-Host ("已批准设备 {0} 台    待批准 {1} 台" -f $ok, $pend)
            foreach ($d in $devs) {
                if ($d.status -eq 'approved') { Write-Host ("  [已批准] {0}  @ {1}" -f $d.label, $d.ip) }
            }
        } catch { Write-Host '（状态文件读取失败）' }
    }
    return $true
}

function Start-Gate {
    if (Get-GateProcess) { Write-Host '已在运行，无需重复启动（要重启用 restart）'; return }
    if (-not (Test-Path $Entry)) { Write-Host "找不到入口文件: $Entry"; exit 1 }

    Remove-Item $LogOut, $LogErr -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath 'node' -ArgumentList 'lan-gate.mjs' -WorkingDirectory $Root `
        -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr -WindowStyle Hidden -PassThru

    # 等端口起来。注意不能只看「等了多久」——网络守卫拦截时 node 会立刻退出，
    # 那种情况必须马上把 run.log 里的原因打出来，而不是闷等 10 秒。
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 400
        if (Test-Port) { Write-Host '启动成功'; Show-Status | Out-Null; return }
        if ($proc.HasExited) {
            Write-Host '启动失败：进程已退出。run.log 末尾:'
            if (Test-Path $LogOut) { Get-Content $LogOut -Encoding UTF8 -Tail 6 | ForEach-Object { Write-Host "    $_" } }
            $e = Get-Content $LogErr -Encoding UTF8 -ErrorAction SilentlyContinue
            if ($e) { Write-Host '  错误输出:'; $e | Select-Object -First 6 | ForEach-Object { Write-Host "    $_" } }
            return
        }
    }
    Write-Host '启动超时（8 秒内端口未监听）。run.log 末尾:'
    if (Test-Path $LogOut) { Get-Content $LogOut -Encoding UTF8 -Tail 6 | ForEach-Object { Write-Host "    $_" } }
}

function Stop-Gate {
    $p = Get-GateProcess
    if (-not $p) { Write-Host '本来就没在运行'; return }
    $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
    if (Get-GateProcess) { Write-Host '停止失败' } else { Write-Host '已停止' }
}

switch ($Action) {
    'start'   { Start-Gate }
    'stop'    { Stop-Gate }
    'restart' { Stop-Gate; Start-Sleep -Milliseconds 500; Start-Gate }
    'status'  { Show-Status | Out-Null }
    'log'     { if (Test-Path $LogOut) { Get-Content $LogOut -Encoding UTF8 -Tail 30 } else { Write-Host '暂无日志' } }
}
