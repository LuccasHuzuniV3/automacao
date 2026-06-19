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
rem  Traducao via agy (Antigravity): no Windows o agy roda via WSL (o agy.exe nativo NAO
rem  redireciona stdout - retornaria vazio). Precisa de WSL + Ubuntu + agy instalado e logado
rem  DENTRO do WSL (curl -fsSL https://antigravity.google/cli/install.sh | bash). Se voce NAO
rem  usa WSL, apague a linha "set USE_WSL_FOR_AGY=1" abaixo (ai o agy roda nativo).
set USE_WSL_FOR_AGY=1
set TUNNEL=1
node server.js
echo.
echo  -----------------------------------------------
echo    O painel foi encerrado. Pode fechar a janela.
pause
