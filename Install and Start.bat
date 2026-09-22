@echo off
setlocal
title BFO Mission Builder - Install, Update, and Start
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start Server.ps1" -Install -CheckUpdates
if errorlevel 1 pause
endlocal
