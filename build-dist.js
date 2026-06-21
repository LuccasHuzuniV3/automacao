/* =====================================================================
   build-dist.js — gera a pasta dist/ para publicar na Vercel.
   Inclui SÓ: index.html + ebooks.js + vercel.json + painel.html + imagens + api/.
   NUNCA inclui: builder.html, server.js, *.bat (o painel admin fica fora do ar).

   SEGURANÇA (a parte importante):
   - Antes de montar, LÊ o que está NO AR (prodUrl/ebooks.js) e PRESERVA todos os
     ebooks publicados. Só atualiza/adiciona os locais. Assim, deploy de uma máquina
     NUNCA apaga o ebook de outra (o caso do deusdiz1 que sumiu ao publicar arcturianos).
   - Imagens de ebooks preservados do ar (que não estão na máquina) são BAIXADAS do ar.
   - Se NÃO conseguir conferir o que está no ar (sem internet/erro), CANCELA o deploy
     em vez de publicar às cegas.
   - A lógica pura do merge fica em deploy-merge.js (testada em tests/deploy-merge.test.js).

   Uso:
     node build-dist.js                  -> atualiza TODOS os ebooks locais (preservando o ar)
     node build-dist.js arcturianos      -> atualiza só o arcturianos (preservando o resto do ar)
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const { planEbooks, imgsOf, protectedImages, decollide } = require('./deploy-merge.js');

global.window = {};
require(path.join(ROOT, 'ebooks.js'));      // popula window.EBOOKS
const all = window.EBOOKS || {};
const only = process.argv.slice(2).filter(Boolean);

// prodUrl = o que está NO AR (fonte da verdade pra não derrubar ebooks de outras máquinas)
let PROD = '';
try { PROD = String((JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy-config.json'), 'utf8')) || {}).prodUrl || '').replace(/\/+$/, ''); } catch (e) {}

function parseEbooksJs(code) { const sb = { window: {} }; vm.runInNewContext(code, sb, { timeout: 3000 }); return sb.window.EBOOKS || {}; }

// busca o ebooks.js que está NO AR. {} se ainda não tem dados (404/1o deploy). JOGA ERRO se não der p/ confirmar.
async function fetchLive(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return {};                                   // site no ar, sem ebooks ainda -> ok
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  if (!/window\s*\.\s*EBOOKS\s*=/.test(text)) throw new Error('resposta nao parece ebooks.js');   // pagina de erro/conteudo errado -> nao confia
  return parseEbooksJs(text);
}

// baixa baseUrl/rel -> distDir/rel (true se baixou). force=true sempre sobrescreve; senao pula se ja existe.
async function dl(baseUrl, rel, distDir, force) {
  const dst = path.join(distDir, rel.replace(/\//g, path.sep));
  if (!force && fs.existsSync(dst)) return true;
  try {
    const r = await fetch(baseUrl + '/' + rel.replace(/^\/+/, ''), { cache: 'no-store' });
    if (!r.ok) return false;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch (e) { return false; }
}

// imgsOf vem do deploy-merge.js (aceita string ou objeto)

// monta o conjunto a publicar PRESERVANDO o que está no ar; ABORTA se não der p/ confirmar o ar.
async function planFor(localAll, onlyKeys, liveUrl, label) {
  let live = {};
  if (PROD) {
    try { live = await fetchLive(liveUrl); }
    catch (e) {
      console.error('\n>>> DEPLOY CANCELADO (' + label + '): nao consegui ver o que esta no ar (' + e.message + ').');
      console.error('>>> Sem isso o deploy poderia APAGAR ebooks de outra maquina. Confira a internet/o link e tente de novo.\n');
      process.exit(2);
    }
  }
  return planEbooks(localAll, live, onlyKeys);
}

// escreve um workspace (principal usa sub='' e DIST direto; upsell/downsell usam dist/<sub>)
async function writeSite(sub, localAll, onlyKeys, globalName) {
  const isMain = !sub;
  const baseUrl = PROD + (isMain ? '' : '/' + sub);
  const dir = isMain ? DIST : path.join(DIST, sub);
  const plan = await planFor(localAll, onlyKeys, baseUrl + '/ebooks.js', isMain ? 'principal' : sub);
  if (!Object.keys(plan.out).length) { if (isMain) { console.error('Nenhum ebook valido. Disponiveis: ' + Object.keys(localAll).join(', ')); process.exit(1); } console.log(sub.toUpperCase() + ' vazio -> /' + sub + ' nao publicado'); return; }
  // imagens de ebooks do AR = protegidas; e DES-COLIDE as do(s) ebook(s) local(is) que reusam o mesmo nome de arquivo
  const protect = new Set(protectedImages(plan.out, plan.fromLive));
  const dc = decollide(plan.out, plan.updated, Array.from(protect));
  const out = dc.out, keys = Object.keys(out);

  fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dir, 'index.html'));
  if (fs.existsSync(path.join(ROOT, 'desconto.js'))) fs.copyFileSync(path.join(ROOT, 'desconto.js'), path.join(dir, 'desconto.js'));
  if (isMain) {
    if (fs.existsSync(path.join(ROOT, 'vercel.json'))) fs.copyFileSync(path.join(ROOT, 'vercel.json'), path.join(dir, 'vercel.json'));
    if (fs.existsSync(path.join(ROOT, 'painel.html'))) fs.copyFileSync(path.join(ROOT, 'painel.html'), path.join(dir, 'painel.html'));
  }
  const tag = isMain ? 'Publicado' : (sub.toUpperCase() + ' publicado em /' + sub);
  fs.writeFileSync(path.join(dir, 'ebooks.js'),
    '/* ' + tag + ' em ' + keys.join(', ') + '. Gerado por build-dist.js — nao editar a mao. */\n' +
    'window.EBOOKS = ' + JSON.stringify(out, null, 2) + ';\n');

  // imagens: imagens de ebooks PRESERVADOS do ar = INTOCÁVEIS (vêm do ar, ignora local homônimo).
  //          imagens só dos ebooks locais = vêm do local (se faltar, do ar).
  const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = imgsOf(JSON.stringify(out) + '\n' + idxHtml);
  const dcSet = new Set(Object.keys(dc.copies));
  let local = 0, dcN = 0; const jobs = [];
  // 1) imagens des-colididas: copia o arquivo LOCAL original pro nome próprio do ebook local
  dcSet.forEach(function (newRel) {
    const src = path.join(ROOT, dc.copies[newRel].replace(/\//g, path.sep));
    if (fs.existsSync(src)) { const d = path.join(dir, newRel.replace(/\//g, path.sep)); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(src, d); dcN++; }
  });
  // 2) demais imagens
  refs.forEach(function (rel) {
    if (dcSet.has(rel)) return;                                   // já copiada (des-colidida)
    const src = path.join(ROOT, rel.replace(/\//g, path.sep));
    if (protect.has(rel)) jobs.push({ rel: rel, force: true });   // de ebook de OUTRA máquina -> SEMPRE do ar
    else if (fs.existsSync(src)) { const d = path.join(dir, rel.replace(/\//g, path.sep)); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(src, d); local++; }
    else jobs.push({ rel: rel, force: false });                  // só do local mas faltou -> tenta do ar
  });
  // baixa em PARALELO (o deploy tem timeout curto; sequencial estourava 60s)
  let air = 0; const gone = [];
  if (PROD && jobs.length) {
    let i = 0;
    const worker = async function () { while (i < jobs.length) { const j = jobs[i++]; if (await dl(baseUrl, j.rel, dir, j.force)) air++; else gone.push(j.rel); } };
    await Promise.all(Array.from({ length: Math.min(16, jobs.length) }, worker));
  } else { jobs.forEach(function (j) { gone.push(j.rel); }); }
  // NÃO consegui preservar imagem de ebook de outra máquina -> CANCELA (não publica quebrando ele)
  const protGone = gone.filter(function (r) { return protect.has(r); });
  if (protGone.length) {
    console.error('\n>>> DEPLOY CANCELADO (' + (isMain ? 'principal' : sub) + '): nao consegui preservar do ar imagens de ebooks que nao sao desta maquina:');
    console.error('>>> ' + protGone.join(', '));
    console.error('>>> Confira a internet e tente de novo (nao vou publicar quebrando ebook de outra pessoa).\n');
    process.exit(2);
  }

  // api/ (serverless: track/stats/hotmart/sales)
  const apiSrc = path.join(ROOT, 'api');
  if (fs.existsSync(apiSrc)) { const ad = path.join(dir, 'api'); fs.mkdirSync(ad, { recursive: true }); fs.readdirSync(apiSrc).forEach(function (n) { if (/\.js$/.test(n)) fs.copyFileSync(path.join(apiSrc, n), path.join(ad, n)); }); }

  console.log('OK -> dist/' + (isMain ? '' : sub + '/') + '  | ebooks: ' + keys.join(', ') +
    (plan.fromLive.length ? ' | preservados do ar: ' + plan.fromLive.join(', ') : '') +
    ' | imagens: ' + local + ' local + ' + air + ' do ar' + (dcN ? ' + ' + dcN + ' des-colididas' : ''));
  if (dcN) console.log('INFO: ' + dcN + ' imagem(ns) compartilhada(s) publicadas com NOME PROPRIO pro(s) seu(s) ebook(s) (pra nao brigar com ebook de outra maquina).');
  const realGone = gone.filter(function (r) { return !protect.has(r); });
  if (realGone.length) console.log('AVISO imagens nao achadas (nem local nem no ar): ' + realGone.join(', '));
}

(async function () {
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
  await writeSite('', all, only, 'EBOOKS');                          // PRINCIPAL (respeita 'only')
  // workspaces: publicam todos os locais SEMPRE preservando o ar (only=[] -> não dependem do 'only' do principal)
  for (const w of [['upsell', 'ebooks-upsell.js', 'EBOOKS_UPSELL'], ['downsell', 'ebooks-downsell.js', 'EBOOKS_DOWNSELL'], ['downsell2', 'ebooks-downsell2.js', 'EBOOKS_DOWNSELL2']]) {
    const wPath = path.join(ROOT, w[1]);
    if (!fs.existsSync(wPath)) continue;
    try { require(wPath); } catch (e) { console.log('AVISO ' + w[0] + ' (nao carregou): ' + e.message); continue; }
    const wAll = (global.window && global.window[w[2]]) || {};
    if (!Object.keys(wAll).length) { console.log(w[0].toUpperCase() + ' vazio -> /' + w[0] + ' nao publicado'); continue; }
    await writeSite(w[0], wAll, [], w[2]);
  }
})().catch(function (e) { console.error('Erro no build:', e && e.message || e); process.exit(1); });
