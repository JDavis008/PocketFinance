@echo off
rem Keeps the PocketFinance server running; restarts it 5 seconds after any crash or settings restart.
cd /d "%~dp0"
if not exist data mkdir data
:loop
echo [%date% %time%] starting >> data\server.log
node "%~dp0server\index.js" >> data\server.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
