@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" server.js > logs\server.log 2> logs\server.err.log
