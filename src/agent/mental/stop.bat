@echo off
:: 停止 mental
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3003 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo Stopped
