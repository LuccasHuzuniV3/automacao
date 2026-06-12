/* =====================================================================
   build-dist.js — gera a pasta dist/ LIMPA para publicar na Vercel.
   Inclui SÓ: index.html + ebooks.js (filtrado) + vercel.json + imagens usadas.
   NUNCA inclui: builder.html, server.js, *.bat (o painel admin fica fora do ar).

   Uso:
     node build-dist.js                  -> publica TODOS os ebooks
     node build-dist.js arcturianos      -> publica só o arcturianos
     node build-dist.js arcturianos salomao  -> publica esses dois
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

global.window = {};
require(path.join(ROOT, 'ebooks.js'));      // popula window.EBOOKS
const all = window.EBOOKS || {};

const only = process.argv.slice(2).filter(Boolean);
const keys = only.length ? only.filter(k => all[k]) : Object.keys(all);
if (!keys.length) { console.error('Nenhum ebook valido. Disponiveis: ' + Object.keys(all).join(', ')); process.exit(1); }

const out = {};
keys.forEach(k => { out[k] = all[k]; });

// limpa o conteudo de dist/ MAS preserva o vinculo .vercel (deploy repetivel)
if (fs.existsSync(DIST)) {
  fs.readdirSync(DIST).forEach(function (name) {
    if (name === '.vercel') return;   // mantem o link do projeto Vercel
    fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
  });
} else {
  fs.mkdirSync(DIST, { recursive: true });
}
fs.mkdirSync(path.join(DIST, 'img'), { recursive: true });

// index.html + vercel.json
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
if (fs.existsSync(path.join(ROOT, 'vercel.json'))) {
  fs.copyFileSync(path.join(ROOT, 'vercel.json'), path.join(DIST, 'vercel.json'));
}
// painel.html = visualizador READ-ONLY (Analytics + Vendas, com login) para o "cara".
// vai pro ar em {dominio}/painel.html. NAO confundir com builder.html (admin completo, fica fora).
if (fs.existsSync(path.join(ROOT, 'painel.html'))) {
  fs.copyFileSync(path.join(ROOT, 'painel.html'), path.join(DIST, 'painel.html'));
}

// ebooks.js filtrado
fs.writeFileSync(
  path.join(DIST, 'ebooks.js'),
  '/* Publicado em ' + keys.join(', ') + '. Gerado por build-dist.js — nao editar a mao. */\n' +
  'window.EBOOKS = ' + JSON.stringify(out, null, 2) + ';\n'
);

// copia as imagens referenciadas pelos ebooks publicados E pelo index.html (CSS: x-mark.png etc.)
const idxHtml = fs.existsSync(path.join(ROOT, 'index.html')) ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
const s = JSON.stringify(out) + '\n' + idxHtml;
const imgs = [...new Set((s.match(/img\/[^"')\s]+?\.(?:png|jpe?g|webp|gif|svg|mp4|webm)/gi) || []))];
let copied = 0, missing = [];
imgs.forEach(rel => {
  const src = path.join(ROOT, rel.replace(/\//g, path.sep));
  if (fs.existsSync(src)) {
    const dst = path.join(DIST, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  } else { missing.push(rel); }
});

// copia as funcoes serverless (api/) -> dist/api/  (coleta self-hosted: /api/track e /api/stats)
const apiSrc = path.join(ROOT, 'api');
let apiList = [];
if (fs.existsSync(apiSrc)) {
  const apiDst = path.join(DIST, 'api');
  fs.mkdirSync(apiDst, { recursive: true });
  fs.readdirSync(apiSrc).forEach(function (name) {
    if (/\.js$/.test(name)) { fs.copyFileSync(path.join(apiSrc, name), path.join(apiDst, name)); apiList.push(name); }
  });
}

console.log('OK -> dist/  | ebooks: ' + keys.join(', ') + ' | imagens: ' + copied + '/' + imgs.length + (apiList.length ? ' | api: ' + apiList.join(', ') : ''));
if (missing.length) console.log('AVISO imagens nao encontradas: ' + missing.join(', '));
