@echo off
title thesalomoncode - App local
cd /d "%~dp0"
echo.
echo  ===============================================
echo    Iniciando o painel (app local)...
echo  ===============================================
echo.
echo    Vai abrir no navegador automaticamente.
echo    Se nao abrir, acesse:
echo        http://localhost:4321/builder.html
echo.
echo    (Para publicar na Vercel pela 1a vez, rode o
echo     "login-vercel.bat" UMA vez - depois nao precisa mais.)
echo.
echo  -----------------------------------------------
echo.
node server.js
echo.
echo  -----------------------------------------------
echo    O painel foi encerrado. Pode fechar a janela.
pause
