@echo off
title TaskForce
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing components, this only happens once...
  call npm install --omit=dev --no-audit --no-fund
)
node --no-warnings server.js
pause
