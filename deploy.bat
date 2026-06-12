@echo off
title Deploy - thesalomoncode
cd /d "%~dp0"
echo.
echo  ============================================
echo   Subindo o site para a Vercel...
echo  ============================================
echo.
where vercel >nul 2>nul
if errorlevel 1 (
  echo  Instalando a CLI da Vercel ^(so na primeira vez, pode demorar^)...
  call npm i -g vercel
  echo.
)
vercel whoami >nul 2>nul
if errorlevel 1 (
  echo  Faca login na Vercel ^(abre o navegador - so na primeira vez^)
  echo.
  call vercel login
  echo.
)
echo  Publicando em producao...
echo.
call vercel --prod --yes
echo.
echo  ============================================
echo   Pronto! O link de producao aparece acima.
echo  ============================================
echo.
pause
