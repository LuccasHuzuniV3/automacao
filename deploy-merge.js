/* =====================================================================
   deploy-merge.js — lógica PURA (sem I/O) do merge de deploy.

   GARANTIA DE INTEGRIDADE: o deploy NUNCA derruba um ebook que já está
   no ar. Sempre PRESERVA o que está publicado e só ATUALIZA/ADICIONA os
   ebooks locais. Assim, deploy de uma máquina nunca apaga o ebook de
   outra (o caso do deusdiz1 que sumiu ao publicar arcturianos).

   require-able e sem efeitos colaterais -> testável.
   Testes: tests/deploy-merge.test.js
   ===================================================================== */

/**
 * Planeja o conjunto de ebooks a publicar, preservando SEMPRE o que está no ar.
 * @param {Object}   local ebooks do ebooks.js LOCAL (desta máquina)
 * @param {Object}   live  ebooks que estão NO AR agora (último deploy) — o que NÃO pode sumir
 * @param {string[]} only  ebook(s) selecionado(s) p/ atualizar (vazio = atualiza todos os locais)
 * @returns {{out:Object, fromLive:string[], updated:string[], dropped:string[]}}
 *   out      conjunto final a publicar (ar preservado + locais atualizados)
 *   fromLive ebooks cujo conteúdo veio do AR (imagens NÃO estão na máquina -> baixar do ar)
 *   updated  ebooks atualizados/adicionados a partir do local
 *   dropped  ebooks do ar que sairiam — INVARIANTE: tem que ser SEMPRE []
 */
/**
 * Junta um ebook LOCAL com o do AR no nível de PAÍS: países que só existem no ar
 * são PRESERVADOS (nunca somem), e o local atualiza/adiciona os seus. Campos de topo
 * (tema/layout2/nome...): o local vence, mas o que só o ar tem é mantido. É a proteção
 * contra o clobber de rascunho pelado (ex.: publicar arcanjo2 só com 'br' NÃO apaga us/it).
 * @returns {{eb:Object, preserved:Object}} eb = ebook final; preserved = países que vieram
 *          SÓ do ar (suas imagens podem não estar nesta máquina -> baixar/proteger do ar).
 */
function mergeEb(localEb, liveEb) {
  var out = {};
  Object.keys(liveEb || {}).forEach(function (f) { out[f] = liveEb[f]; });                        // base = ar (preserva campos que só o ar tem)
  Object.keys(localEb || {}).forEach(function (f) { if (f !== 'paises') out[f] = localEb[f]; });   // topo: local vence
  var lp = liveEb && liveEb.paises, cp = localEb && localEb.paises, preserved = {};
  if (lp || cp) {
    var paises = {};
    if (lp) Object.keys(lp).forEach(function (p) { paises[p] = lp[p]; if (!cp || !(p in cp)) preserved[p] = lp[p]; });  // países do ar (preservados)
    if (cp) Object.keys(cp).forEach(function (p) { paises[p] = cp[p]; });                           // local atualiza/adiciona os seus
    out.paises = paises;
  }
  return { eb: out, preserved: preserved };
}

function planEbooks(local, live, only) {
  local = local || {};
  live = live || {};
  only = (Array.isArray(only) ? only : (only ? [only] : [])).filter(Boolean);
  var merge = only.length > 0;
  // ebooks LOCAIS que entram: no merge só os selecionados (que existem local); senão todos os locais
  var localApplied = (merge ? only : Object.keys(local)).filter(function (k) { return local[k]; });
  var localSet = {};
  localApplied.forEach(function (k) { localSet[k] = 1; });
  var out = {}, preservedPaises = {};
  Object.keys(live).forEach(function (k) { out[k] = live[k]; });   // 1) preserva TUDO que está no ar
  localApplied.forEach(function (k) {                              // 2) atualiza/adiciona — JUNTANDO país a país
    if (live[k]) {
      var m = mergeEb(local[k], live[k]);
      out[k] = m.eb;
      if (Object.keys(m.preserved).length) preservedPaises[k] = { paises: m.preserved };   // países do ar preservados neste ebook local
    } else {
      out[k] = local[k];                                           // ebook NOVO (só local)
    }
  });
  var fromLive = Object.keys(out).filter(function (k) { return !localSet[k]; });   // ebook 100% do ar -> baixar imagens
  var dropped = Object.keys(live).filter(function (k) { return !(k in out); });    // ebook do ar sumindo -> SEMPRE []
  var droppedPaises = [];                                                          // país do ar sumindo de ebook mesclado -> SEMPRE []
  localApplied.forEach(function (k) {
    var lp = live[k] && live[k].paises; if (!lp) return;
    var op = (out[k] && out[k].paises) || {};
    Object.keys(lp).forEach(function (p) { if (!(p in op)) droppedPaises.push(k + '/' + p); });
  });
  return { out: out, fromLive: fromLive, updated: localApplied, dropped: dropped, droppedPaises: droppedPaises, preservedPaises: preservedPaises };
}

// extrai os caminhos img/... de uma string OU objeto (mesma regex do build-dist)
function imgsOf(x) {
  var s = (x == null) ? '' : (typeof x === 'string' ? x : JSON.stringify(x));
  return Array.from(new Set((s.match(/img\/[^"')\s]+?\.(?:png|jpe?g|webp|gif|svg|mp4|webm)/gi) || [])));
}

/**
 * Imagens que PERTENCEM a ebooks preservados do ar (que NÃO estão nesta máquina).
 * Essas NUNCA podem ser sobrescritas pela versão local — mesmo que um ebook local
 * use o MESMO nome de arquivo (o caso do deusdiz1 br que reusa imagens do arcturianos).
 * O build deve pegá-las do AR como estão publicadas, e ignorar qualquer arquivo local homônimo.
 * @param {Object}   out      conjunto final a publicar
 * @param {string[]} fromLive ebooks preservados do ar (não-locais)
 * @returns {string[]} caminhos img/ protegidos
 */
function protectedImages(out, fromLive, preservedPaises) {
  out = out || {};
  var set = {};
  (fromLive || []).forEach(function (k) { if (out[k]) imgsOf(out[k]).forEach(function (r) { set[r] = 1; }); });
  var pp = preservedPaises || {};   // países PRESERVADOS do ar dentro de ebooks locais (mesclados) -> imagens também intocáveis
  Object.keys(pp).forEach(function (k) { imgsOf(pp[k]).forEach(function (r) { set[r] = 1; }); });
  return Object.keys(set);
}

/**
 * AUTO-DES-COLISÃO: quando um ebook LOCAL usa uma imagem que TAMBÉM é de um ebook do AR
 * (protegida), a versão publicada do ebook local passa a apontar pra uma cópia com NOME
 * PRÓPRIO — pra não brigar com a imagem do ebook do ar (que fica como está no ar).
 * NÃO altera a fonte (ebooks.js); só o objeto `out` do build.
 * @param {Object}   out           conjunto a publicar
 * @param {string[]} localKeys     ebooks desta máquina (que podem ser renomeados)
 * @param {string[]} protectedList imagens de ebooks do ar (não podem ser tocadas)
 * @returns {{out:Object, copies:Object}} copies = { novoCaminho: caminhoOriginalLocal }
 */
function decollide(out, localKeys, protectedList) {
  out = out || {};
  var prot = {}; (protectedList || []).forEach(function (r) { prot[r] = 1; });
  var res = {}; Object.keys(out).forEach(function (k) { res[k] = out[k]; });
  var copies = {};
  (localKeys || []).forEach(function (k) {
    if (!out[k]) return;
    var str = JSON.stringify(out[k]), changed = false;
    imgsOf(out[k]).forEach(function (rel) {
      if (prot[rel]) {                                                  // colide com imagem de ebook do ar
        var nr = rel.replace(/(\.[a-z0-9]+)$/i, '-' + k + '$1');        // nome próprio: ...-<ebook>.png
        str = str.split('"' + rel + '"').join('"' + nr + '"');
        copies[nr] = rel; changed = true;
      }
    });
    if (changed) res[k] = JSON.parse(str);
  });
  return { out: res, copies: copies };
}

module.exports = { planEbooks, imgsOf, protectedImages, decollide };
