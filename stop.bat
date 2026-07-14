@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4177') do (
  taskkill /PID %%a /F >nul 2>nul
)
