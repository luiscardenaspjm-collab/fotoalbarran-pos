@echo off
title Foto Albarran - POS
color 0A
cls
echo.
echo  ================================================
echo   FOTO ALBARRAN ^| Sistema POS
echo   Leon, Guanajuato
echo  ================================================
echo.
echo  Iniciando servidor...
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  ERROR: Node.js no esta instalado.
    echo  Descargalo en: https://nodejs.org
    echo.
    pause
    exit
)

:: Start server
echo  Servidor corriendo en:
echo.
echo    http://localhost:3000/pos.html       (Mostrador)
echo    http://localhost:3000/dashboard.html  (Dashboard)
echo.
echo  Ctrl + C para detener
echo.
node server.js
pause
