@echo off
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Right-click this file and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
echo.
echo Setting TaskForce to start automatically when you sign in to this PC...
schtasks /create /tn "TaskForce" /tr "wscript.exe \"%~dp0start-hidden.vbs\"" /sc onlogon /rl highest /f
echo.
echo Allowing other office computers to connect on port 3000...
netsh advfirewall firewall delete rule name="TaskForce" >nul 2>&1
netsh advfirewall firewall add rule name="TaskForce" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
echo.
echo Starting TaskForce now...
wscript.exe "%~dp0start-hidden.vbs"
timeout /t 3 >nul
echo.
echo   Done. TaskForce is running in the background.
echo   On this PC open:        http://localhost:3000
echo   On other office PCs:    http://%COMPUTERNAME%:3000
echo.
start "" http://localhost:3000
pause
