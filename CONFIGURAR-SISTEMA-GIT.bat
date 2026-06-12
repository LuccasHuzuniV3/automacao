@echo off
chcp 65001 >nul
title Configurar atualizacoes (GitHub) - SO nesta pasta
cd /d "%~dp0"
echo.
echo  ==============================================================
echo    CONFIGURAR ATUALIZACOES AUTOMATICAS (GitHub)
echo  ==============================================================
echo.
echo  IMPORTANTE: use uma conta GitHub SEPARADA (a do ebook),
echo  NAO a conta do trabalho. Este script mexe SO nesta pasta
echo  (configuracao local) e NAO toca na conta git do seu PC.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  [ATENCAO] O Git nao esta instalado.
  echo    1^) Baixe e instale: https://git-scm.com/download/win
  echo    2^) Depois rode este arquivo de novo.
  echo.
  pause
  exit /b
)

echo  Voce vai precisar de 3 coisas (da conta do ebook):
echo    - usuario do GitHub
echo    - nome do repositorio (crie um vazio antes, ex: thesalomoncode-sistema)
echo    - um token (Settings ^> Developer settings ^> Tokens ^> generate)
echo.
set /p GUSER=Usuario do GitHub:
set /p GREPO=Nome do repositorio:
set /p GTOKEN=Token (cole e de Enter):
echo.
echo  Configurando SO nesta pasta...

git init
git branch -M main
git config --local user.name "%GUSER%"
git config --local user.email "%GUSER%@users.noreply.github.com"
git config --local credential.helper ""
git remote remove origin 2>nul
git remote add origin https://%GTOKEN%@github.com/%GUSER%/%GREPO%.git

node set-sysconfig.js "%GUSER%" "%GREPO%"
node make-manifest.js

git add -A
git commit -m "primeira versao do sistema"
git push -u origin main --force

echo.
echo  ------------------------------------------------------------
echo   Se NAO apareceu erro de push, deu certo!
echo   - Daqui pra frente: edite e rode PUBLICAR-ATUALIZACAO.bat
echo   - Rode o GERAR-PACOTE-OPERADOR.bat pra mandar pro operador
echo  ------------------------------------------------------------
echo.
pause
