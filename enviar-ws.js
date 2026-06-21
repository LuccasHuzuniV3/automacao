/* =====================================================================
   enviar-ws.js  —  empacota SÓ UM workspace (o arquivo de dados dele +
   APENAS as imagens que ele usa) numa pasta  enviar-<ws>/  pra mandar
   pro colega, SEM tocar em nenhum outro workspace (principal etc.).

   Uso:  node enviar-ws.js upsell      (ou: principal | downsell | downsell2)
   Normalmente você chama pelo ENVIAR-UPSELL.bat (dois cliques).
   ===================================================================== */
const fs   = require('fs');
const path = require('path');

// cada workspace -> seu arquivo de dados (são arquivos SEPARADOS).
const WS = {
  principal: { file: 'ebooks.js',            label: 'PRINCIPAL'  },
  upsell:    { file: 'ebooks-upsell.js',      label: 'UPSELL'     },
  downsell:  { file: 'ebooks-downsell.js',    label: 'DOWNSELL'   },
  downsell2: { file: 'ebooks-downsell2.js',   label: 'DOWNSELL 2' }
};

const ws  = String(process.argv[2] || 'upsell').toLowerCase();
const def = WS[ws];
if (!def) { console.error('Workspace invalido: "' + ws + '". Use: ' + Object.keys(WS).join(', ')); process.exit(1); }

const ROOT     = __dirname;
const dataPath = path.join(ROOT, def.file);
if (!fs.existsSync(dataPath)) { console.error('Nao achei o arquivo de dados: ' + def.file); process.exit(1); }

// pasta de saída (recria do zero a cada execução)
const out = path.join(ROOT, 'enviar-' + ws);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'img'), { recursive: true });

// 1) o arquivo de dados do workspace (e SÓ ele — o principal nem encosta)
fs.copyFileSync(dataPath, path.join(out, def.file));

// 2) acha as imagens "img/..." referenciadas e copia só as que existem aqui
const txt  = fs.readFileSync(dataPath, 'utf8');
const refs = txt.match(/img\/[A-Za-z0-9._\-\/]+\.(?:png|jpe?g|webp|gif|svg)/gi) || [];
const uniq = Array.from(new Set(refs.map(function (s) { return s.replace(/\\/g, '/'); })));

let copiadas = 0; const faltando = [];
uniq.forEach(function (rel) {
  const src = path.join(ROOT, rel);
  if (fs.existsSync(src)) {
    const dst = path.join(out, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copiadas++;
  } else {
    faltando.push(rel);
  }
});

// 3) LEIA-ME.txt pro colega (UTF-8 com BOM -> abre certinho no Bloco de Notas)
const L = [
  'COMO INSTALAR O ' + def.label + ' (sem perder o seu trabalho)',
  '======================================================',
  '',
  '1) Feche o painel/builder (pode fechar o start.bat).',
  '2) Copie TUDO de dentro desta pasta para a pasta do projeto',
  '   (a pasta onde ficam o start.bat e o index.html).',
  '3) Quando o Windows perguntar, mande SUBSTITUIR o "' + def.file + '".',
  '   As imagens entram na pasta img/. Se ele perguntar sobre alguma',
  '   imagem que ja existe, pode pular - sao imagens do ' + def.label + '.',
  '4) Abra o start.bat de novo e de Ctrl+Shift+R no painel.',
  '',
  'IMPORTANTE: isto NAO mexe no seu ebooks.js (PRINCIPAL) nem em nenhum',
  'outro workspace. So entra o "' + def.file + '" e as imagens dele.',
  '',
  'Conteudo desta pasta: ' + def.file + ' + ' + copiadas + ' imagem(ns).'
].join('\r\n');
fs.writeFileSync(path.join(out, 'LEIA-ME.txt'), '﻿' + L, 'utf8');

// resumo no console
console.log('');
console.log('OK! Pasta criada: enviar-' + ws + '/');
console.log('  - ' + def.file);
console.log('  - ' + copiadas + ' imagem(ns) em img/');
if (faltando.length) {
  console.log('');
  console.log('ATENCAO: ' + faltando.length + ' imagem(ns) referenciada(s) mas NAO encontrada(s) aqui:');
  faltando.forEach(function (f) { console.log('  ! ' + f); });
  console.log('(o colega veria essas quebradas no preview; o resto funciona normal)');
}
