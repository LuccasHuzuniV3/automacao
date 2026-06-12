@echo off
chcp 65001 >nul
title Publicar atualizacao do sistema
cd /d "%~dp0"
echo.
echo  ================================================
echo    Publicando a ultima versao no GitHub...
echo  ================================================
echo.

where git >nul 2>nul
if errorlevel 1 ( echo  [ERRO] Git nao instalado. Rode o CONFIGURAR-SISTEMA-GIT.bat antes. & pause & exit /b )

node make-manifest.js
git add -A
git commit -m "atualizacao do sistema"
git push

echo.
echo  ------------------------------------------------------------
echo   Pronto! Agora o operador pode clicar em "Atualizar sistema"
echo   no painel (aba Config) que ele baixa essa versao.
echo  ------------------------------------------------------------
echo.
pause
