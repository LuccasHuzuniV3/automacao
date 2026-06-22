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
  'builder.html', 'painel.html', 'index.html', 'desconto.js', 'server.js', 'build-dist.js', 'deploy-merge.js',
  'vercel.json', 'README.md', 'LEIA-ME.txt', 'COMECE-AQUI.bat', 'start.bat',
  'deploy.bat', 'login-vercel.bat', 'version.json',
  'otimizar-imagens.js', 'OTIMIZAR-IMAGENS.bat'
];
const files = [];
BASE.forEach(function (f) { if (fs.existsSync(path.join(ROOT, f))) files.push(f); });

const apiDir = path.join(ROOT, 'api');
if (fs.existsSync(apiDir)) {
  fs.readdirSync(apiDir).filter(function (n) { return /\.js$/.test(n); }).forEach(function (n) { files.push('api/' + n); });
}

// incrementa a VERSAO (numero) a cada publicacao -> da pra saber quem esta atrasado
let v = 0, fresh = false;
try { const _vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')); v = parseInt(_vj.version, 10) || 0; fresh = !!_vj.fresh; } catch (e) {}
if (!fresh) v = v + 1;   // 'fresh' = versao setada a mao (ex.: 200 -> v2.0): publica SEM incrementar na 1a vez; depois volta a incrementar (201=v2.1, ...)
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ version: v }, null, 2) + '\n');   // grava SEM o 'fresh'

const man = { version: v, date: new Date().toISOString(), files: files };
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
console.log('manifest.json gerado: VERSAO v' + v + ' (' + files.length + ' arquivos)');
