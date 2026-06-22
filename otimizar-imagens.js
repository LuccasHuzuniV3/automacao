/* =====================================================================
   otimizar-imagens.js — gera uma versao .webp (bem menor) AO LADO de cada
   imagem da pasta img/, SEM tocar nos arquivos originais nem nas referencias
   do ebook. O server.js entrega a .webp automaticamente pra quem aceita
   (todos os navegadores modernos) -> acelera MUITO o "Compartilhar".

   Precisa do ffmpeg instalado (no PATH). Rode pelo OTIMIZAR-IMAGENS.bat.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const IMG = path.join(ROOT, 'img');
const QUALIDADE = '80';   // 0-100: 80 = otimo equilibrio (quase sem perda visivel)

// ffmpeg existe?
const chk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (chk.error) {
  console.log('');
  console.log('  ffmpeg NAO encontrado. Instale o ffmpeg (https://ffmpeg.org) e rode de novo.');
  console.log('  (no Windows: baixe o ffmpeg, coloque o ffmpeg.exe numa pasta do PATH)');
  process.exit(1);
}
if (!fs.existsSync(IMG)) { console.log('  pasta img/ nao encontrada.'); process.exit(1); }

const files = fs.readdirSync(IMG).filter(function (f) { return /\.(png|jpe?g)$/i.test(f); });
if (!files.length) { console.log('  nenhuma imagem .png/.jpg na pasta img/.'); process.exit(0); }

let feitos = 0, pulados = 0, falhas = 0, naoVale = 0, antesTot = 0, depoisTot = 0;
files.forEach(function (f) {
  const src = path.join(IMG, f);
  const out = src + '.webp';                       // foo.png -> foo.png.webp (sem colisao entre .png e .jpg)
  const aSt = fs.statSync(src);
  // pula se ja tem um .webp mais novo que o original
  if (fs.existsSync(out)) { try { if (fs.statSync(out).mtimeMs >= aSt.mtimeMs) { pulados++; return; } } catch (e) {} }
  const r = spawnSync('ffmpeg', ['-y', '-i', src, '-c:v', 'libwebp', '-quality', QUALIDADE, out], { stdio: 'ignore' });
  if (r.status !== 0 || !fs.existsSync(out)) { console.log('  ! falhou: ' + f); falhas++; return; }
  const a = aSt.size, b = fs.statSync(out).size;
  if (b >= a) { try { fs.unlinkSync(out); } catch (e) {} naoVale++; return; }   // webp nao ficou menor (ex.: jpg pequeno) -> descarta, o server entrega o original
  antesTot += a; depoisTot += b; feitos++;
  console.log('  ' + f + ': ' + Math.round(a / 1024) + ' KB -> ' + Math.round(b / 1024) + ' KB');
});

console.log('');
console.log('  Pronto: ' + feitos + ' otimizada(s), ' + pulados + ' ja estavam ok' + (naoVale ? (', ' + naoVale + ' ja eram pequenas (mantido o original)') : '') + (falhas ? (', ' + falhas + ' falharam') : '') + '.');
if (feitos) {
  const pct = Math.round((1 - depoisTot / antesTot) * 100);
  console.log('  Total das novas: ' + Math.round(antesTot / 1024) + ' KB -> ' + Math.round(depoisTot / 1024) + ' KB  (' + pct + '% menor)');
}
console.log('  As .webp ficam ao lado das originais (que NAO foram alteradas). O server.js entrega elas sozinho.');
console.log('  Reinicie o start.bat e gere o link de compartilhar de novo.');
