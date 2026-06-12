@echo off
chcp 65001 >nul
title Gerar pacote para o operador
cd /d "%~dp0"
echo.
echo  ================================================
echo    Gerando o pacote (zip) PRONTO para o operador
echo  ================================================
echo.
echo  Inclui: painel + os ebooks atuais + link da Vercel.
echo  NAO inclui: a pasta dist completa nem backups.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=(Get-Location).Path; $tmp=Join-Path $env:TEMP ('pkg_'+[System.IO.Path]::GetRandomFileName()); New-Item -ItemType Directory -Path $tmp -Force | Out-Null; $inc=@('builder.html','painel.html','index.html','ebooks.js','server.js','build-dist.js','vercel.json','deploy-config.json','sys-config.json','start.bat','login-vercel.bat','deploy.bat','COMECE-AQUI.bat','LEIA-ME.txt','README.md','version.json','api','img'); foreach($i in $inc){ $p=Join-Path $src $i; if(Test-Path $p){ Copy-Item $p (Join-Path $tmp $i) -Recurse -Force } }; $dv=Join-Path $src 'dist\.vercel'; if(Test-Path $dv){ $dd=Join-Path $tmp 'dist'; New-Item -ItemType Directory -Path $dd -Force | Out-Null; Copy-Item $dv $dd -Recurse -Force }; $out=Join-Path $src 'PAINEL-PARA-O-OPERADOR.zip'; if(Test-Path $out){Remove-Item $out -Force}; Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $out -Force; Remove-Item $tmp -Recurse -Force; Write-Host ('OK -> ' + $out)"
echo.
echo  ------------------------------------------------
echo   Pronto! Foi criado:  PAINEL-PARA-O-OPERADOR.zip
echo.
echo   Manda esse .zip pro operador. Ele:
echo     1^) extrai a pasta
echo     2^) da 2 cliques em COMECE-AQUI.bat
echo  ------------------------------------------------
echo.
pause
