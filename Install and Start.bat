@echo off
setlocal
title BFO Mission Builder Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start Server.ps1" -Install
if errorlevel 1 pause
endlocal
