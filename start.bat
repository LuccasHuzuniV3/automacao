@echo off
title thesalomoncode - App local
cd /d "%~dp0"
echo.
echo  ===============================================
echo    Iniciando o painel (app local + compartilhar)...
echo  ===============================================
echo.
echo    Vai abrir no navegador automaticamente.
echo    Se nao abrir, acesse:
echo        http://localhost:4321/builder.html
echo.
echo    O link de COMPARTILHAR ja sobe junto (deixe esta
echo    janela aberta enquanto a outra pessoa estiver editando).
echo.
echo    (Para publicar na Vercel pela 1a vez, rode o
echo     "login-vercel.bat" UMA vez - depois nao precisa mais.)
echo.
echo  -----------------------------------------------
echo.
set TUNNEL=1
node server.js
echo.
echo  -----------------------------------------------
echo    O painel foi encerrado. Pode fechar a janela.
pause
