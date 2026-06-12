/* =====================================================================
   make-manifest.js — gera o manifest.json com a lista de arquivos do
   SISTEMA (codigo) que o operador baixa no "Atualizar sistema".
   NAO inclui dados (ebooks.js) nem scripts so-do-criador.
   Rodado automaticamente pelo PUBLICAR-ATUALIZACAO.bat.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const BASE = [
  'builder.html', 'painel.html', 'index.html', 'server.js', 'build-dist.js',
  'vercel.json', 'README.md', 'LEIA-ME.txt', 'COMECE-AQUI.bat', 'start.bat',
  'deploy.bat', 'login-vercel.bat'
];
const files = [];
BASE.forEach(function (f) { if (fs.existsSync(path.join(ROOT, f))) files.push(f); });

const apiDir = path.join(ROOT, 'api');
if (fs.existsSync(apiDir)) {
  fs.readdirSync(apiDir).filter(function (n) { return /\.js$/.test(n); }).forEach(function (n) { files.push('api/' + n); });
}

const man = { version: new Date().toISOString(), files: files };
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
console.log('manifest.json gerado: ' + files.length + ' arquivo(s)');
