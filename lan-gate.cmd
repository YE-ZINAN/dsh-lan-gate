@echo off
rem dsh-lan-gate 快捷入口（双击或命令行都能用）
rem 用法: lan-gate.cmd [start|stop|restart|status|log]
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lan-gate.ps1" %*
if "%~1"=="" pause
