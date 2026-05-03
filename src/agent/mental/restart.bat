@echo off
:: 重启 mental：先启新进程，再杀旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3003 ^| findstr LISTENING') do set OLDPID=%%a
start "" /B node src\agent\mental\web\index.js
timeout /t 2 /nobreak >nul
if defined OLDPID taskkill /F /PID %OLDPID% 2>nul
echo Restart done
