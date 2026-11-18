@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 ou plus recent est requis.
  pause
  exit /b 1
)
start "Nova Engine Workbench" cmd /k "cd /d "%~dp0" && npm start"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:5201
