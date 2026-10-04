param(
    [string]$TaskName = 'dsh-lan-gate',
    [int]$EveryMinutes = 5
)

# dsh-lan-gate 自启注册
#   powershell -ExecutionPolicy Bypass -File .\tools\install-autostart.ps1
#
# 为什么需要「每 N 分钟重复触发」这一条：
#   原来的任务只有「登录后 30 秒」一个触发条件。机器不重启就永远不再触发，
#   而网关可能在任意时刻被硬杀（2026-10-04 实测：SIGINT 处理函数没跑、stderr 为空，
#   说明不是崩溃也不是优雅退出，而是被 TerminateProcess）。那次死了 22 小时，
#   期间手机上任何设备申请都到不了电脑。
#   加了重复触发之后，谁杀的不再重要 —— 最多 N 分钟自己回来。
#
# 幂等是前提：lan-gate.ps1 start 在检测到进程已存在时会立刻返回，
# 所以重复触发在正常情况下只是每 N 分钟空跑一次。

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'lan-gate-hidden.vbs'
if (-not (Test-Path -LiteralPath $Launcher)) { throw "找不到启动器: $Launcher" }

# 先备份现有定义，方便回滚
$backupDir = Join-Path $Root 'tools'
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    $backup = Join-Path $backupDir ("autostart-task-backup-{0}.xml" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath $backup -Encoding UTF8
    Write-Host "已备份原任务定义: $backup"
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Launcher`""

# 触发条件一：登录后 30 秒（保留原有行为）
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$env:USERNAME"
$logon.Delay = 'PT30S'

# 触发条件二：从现在起每 N 分钟一次，不设结束时间（= 无限期重复）
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $watch) `
    -Settings $settings -Description ("dsh-lan-gate: 登录后 30 秒启动，并每 {0} 分钟检查一次（进程在就不重复启动）" -f $EveryMinutes) `
    -Force | Out-Null

Write-Host "已注册任务: $TaskName（每 $EveryMinutes 分钟自愈检查）"
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State | Format-Table -AutoSize | Out-String
