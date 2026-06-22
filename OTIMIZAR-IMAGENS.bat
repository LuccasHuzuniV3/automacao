@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Otimizando as imagens (gerando versoes .webp, bem menores)...
echo  Os arquivos ORIGINAIS nao sao alterados. Acelera o "Compartilhar".
echo.
node otimizar-imagens.js
echo.
pause
