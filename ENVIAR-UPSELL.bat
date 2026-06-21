@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Empacotando o UPSELL (dados + imagens dele)...
echo.
node enviar-ws.js upsell
if errorlevel 1 ( echo. & echo  Falhou. Veja a mensagem acima. & echo. & pause & exit /b 1 )
echo.
echo  Compactando em enviar-upsell.zip ...
powershell -NoProfile -Command "Compress-Archive -Path 'enviar-upsell\*' -DestinationPath 'enviar-upsell.zip' -Force"
echo.
echo  ============================================================
echo   PRONTO! Mande este arquivo pro colega:  enviar-upsell.zip
echo   (dentro tem o LEIA-ME.txt explicando o que ele faz)
echo  ============================================================
echo.
pause
