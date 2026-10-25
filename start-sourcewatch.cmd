@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
node -e "if(Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 goto missing_node
if not exist "node_modules\" (
  echo Dependencies are missing. Run setup-sourcewatch.cmd first.
  pause
  exit /b 1
)
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0.browsers"
if not defined PORT set "PORT=3210"
if not exist "dist\index.html" (
  echo Building the application...
  call npm.cmd run build
  if errorlevel 1 goto failed
)
echo.
echo SOURCEWATCH: http://127.0.0.1:%PORT%
echo Keep this window open for captures and scheduled monitoring.
echo Press Ctrl+C to stop the service.
echo.
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Install Node.js 24 or newer, including npm, then reopen this launcher.
pause
exit /b 1
:failed
echo SOURCEWATCH could not start. Review the error above.
echo If Chromium or dependencies are missing, run setup-sourcewatch.cmd.
pause
exit /b 1
