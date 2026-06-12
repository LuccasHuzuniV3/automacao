@echo off
chcp 65001 >nul
title Painel de Vendas - Comece aqui
cd /d "%~dp0"
echo.
echo  ================================================
echo     PAINEL DE VENDAS  -  Primeira vez? Comece aqui
echo  ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ATENCAO] O Node.js ainda NAO esta instalado.
  echo.
  echo   1^) Baixe e instale o Node.js ^(versao LTS^):
  echo          https://nodejs.org
  echo   2^) Depois de instalar, rode este COMECE-AQUI de novo.
  echo.
  pause
  exit /b
)
echo  [OK] Node.js encontrado.
echo.

where vercel >nul 2>nul
if errorlevel 1 (
  echo  Instalando a Vercel ^(pra publicar as paginas^)... pode levar 1-2 min
  echo.
  call npm i -g vercel
  echo.
  echo  Agora faca o LOGIN na Vercel ^(vai abrir o navegador^).
  echo  Use a conta que combinaram com voce.
  echo.
  call vercel login
  echo.
) else (
  echo  [OK] Vercel ja instalada.
  echo.
)

echo  Tudo pronto! Abrindo o painel...
echo  ^(Da proxima vez, e so dar 2 cliques em START.bat^)
echo.
node server.js
echo.
pause
