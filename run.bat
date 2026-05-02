@echo off
setlocal

set "DEV_PORT=5173"

for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%DEV_PORT% .*LISTENING"') do (
  echo Stopping process %%P using port %DEV_PORT%...
  taskkill /F /PID %%P >nul 2>&1
)

npm.cmd run dev
exit /b %ERRORLEVEL%
