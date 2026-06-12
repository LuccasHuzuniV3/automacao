@echo off
chcp 65001 >nul
title Resolver o primeiro envio (rejected)
cd /d "%~dp0"
echo.
echo  ================================================
echo    Resolvendo o "rejected" do primeiro envio...
echo  ================================================
echo.
echo  (Isso sobrescreve o README inicial do GitHub com o
echo   seu codigo. So use na PRIMEIRA configuracao.)
echo.

where git >nul 2>nul
if errorlevel 1 ( echo  [ERRO] Git nao instalado. & pause & exit /b )

git add -A
git commit -m "sistema" 2>nul
git push -u origin main --force

echo.
echo  ------------------------------------------------
echo   Se NAO apareceu vermelho agora, DEU CERTO!
echo   Confira no GitHub: os arquivos devem estar la.
echo  ------------------------------------------------
echo.
pause
