@echo off
title Login Vercel (so precisa 1 vez)
cd /d "%~dp0"
echo.
echo  ===============================================
echo    Configurando a Vercel (so precisa fazer 1 vez)
echo  ===============================================
echo.
where vercel >nul 2>nul
if errorlevel 1 (
  echo    Instalando a CLI da Vercel... (pode demorar 1-2 min)
  echo.
  call npm i -g vercel
  echo.
)
echo    Agora faca o login (vai abrir o navegador):
echo.
call vercel login
echo.
echo  ===============================================
echo    Pronto! O botao "Deploy" do painel ja funciona.
echo    Pode fechar esta janela e usar o start.bat.
echo  ===============================================
echo.
pause
