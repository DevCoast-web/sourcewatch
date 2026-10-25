@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
node -e "if(Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 goto missing_node
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0.browsers"
echo Installing SOURCEWATCH dependencies...
call npm.cmd ci
if errorlevel 1 goto failed
echo Installing the project-local Chromium browser...
call npx.cmd playwright install chromium
if errorlevel 1 goto failed
echo Building SOURCEWATCH...
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Setup complete. Run start-sourcewatch.cmd to launch SOURCEWATCH.
pause
exit /b 0
:missing_node
echo Install Node.js 24 or newer, including npm, then reopen this setup script.
pause
exit /b 1
:failed
echo Setup failed. Review the error above, correct it, and run setup-sourcewatch.cmd again.
pause
exit /b 1
