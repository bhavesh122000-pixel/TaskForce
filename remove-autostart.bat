@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo Right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
schtasks /delete /tn "TaskForce" /f
netsh advfirewall firewall delete rule name="TaskForce"
call "%~dp0stop.bat"
echo TaskForce will no longer start automatically.
pause
