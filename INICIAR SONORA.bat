@echo off
title Sonora - musica
cd /d "%~dp0"
echo.
echo   Iniciando Sonora...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Sonora necesita Node.js 22 o mas reciente.
  echo   Descargalo gratis en https://nodejs.org e intenta otra vez.
  echo.
  pause
  exit /b 1
)
node "%~dp0servidor\servidor.js"
if errorlevel 1 pause
