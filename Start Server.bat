@echo off
setlocal
title BFO Mission Builder Server
cd /d "%~dp0"
if errorlevel 1 goto folder_error

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start Server.ps1"
if errorlevel 1 echo Startup failed. See the error above.
goto finished

:folder_error
echo Could not open the project folder.

:finished
echo.
echo You can close this launcher window when you are finished.
pause
endlocal
