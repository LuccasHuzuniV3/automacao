/* Testes (TDD) do deploy-merge.js — GARANTE que o deploy nunca derruba ebook do ar.
   Rode: node tests/deploy-merge.test.js   (NÃO vai pro dist/) */
const assert = require('assert');
const { planEbooks, imgsOf, protectedImages, decollide } = require('../deploy-merge.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }
function eqJSON(got, exp, msg) { try { assert.deepStrictEqual(got, exp); pass++; } catch (e) { fail++; console.log('  x ' + msg + ' | esperado ' + JSON.stringify(exp) + ' | recebi ' + JSON.stringify(got)); } }
function sameSet(got, exp, msg) { eqJSON((got || []).slice().sort(), (exp || []).slice().sort(), msg); }

// versões marcadas pra detectar quem "venceu" (ar x local)
var ARC_AR = { v: 'ar' }, ARC_LOCAL = { v: 'local' }, DEUS = { v: 'deusdiz1-ar' }, TESTE = { v: 'teste-local' }, NOVO = { v: 'novo-local' };

/* ===== O BUG REAL: deploy COMPLETO de arcturianos NÃO pode derrubar o deusdiz1 do ar ===== */
(function () {
  var live = { arcturianos: ARC_AR, deusdiz1: DEUS };
  var local = { arcturianos: ARC_LOCAL, teste: TESTE };
  var r = planEbooks(local, live, []);                       // [] = rebuild completo
  ok(r.out.deusdiz1 === DEUS, 'deusdiz1 do ar PRESERVADO no deploy completo (o bug)');
  ok(r.out.arcturianos === ARC_LOCAL, 'arcturianos atualizado pela versão LOCAL');
  ok(r.out.teste === TESTE, 'teste (novo local) adicionado');
  eqJSON(r.dropped, [], 'INTEGRIDADE: nada do ar foi derrubado');
  sameSet(r.fromLive, ['deusdiz1'], 'deusdiz1 veio do ar -> precisa baixar as imagens');
  sameSet(Object.keys(r.out), ['arcturianos', 'deusdiz1', 'teste'], 'conjunto final = ar + locais');
})();

/* ===== INVARIANTE: nunca derruba ebook do ar, em qualquer combinação de 'only' ===== */
(function () {
  var live = { a: { v: 1 }, b: { v: 1 }, c: { v: 1 } };
  [[], ['a'], ['a', 'x'], ['z'], ['inexistente']].forEach(function (only) {
    var r = planEbooks({ a: { v: 2 }, n: { v: 9 } }, live, only);
    eqJSON(r.dropped, [], 'dropped vazio p/ only=' + JSON.stringify(only));
    ok(r.out.a && r.out.b && r.out.c, 'a,b,c do ar sempre presentes (only=' + JSON.stringify(only) + ')');
  });
})();

/* ===== Mesma chave: a versão LOCAL vence (atualiza) ===== */
(function () {
  var r = planEbooks({ arcturianos: ARC_LOCAL }, { arcturianos: ARC_AR }, []);
  ok(r.out.arcturianos === ARC_LOCAL, 'mesma chave: versão LOCAL vence');
  sameSet(r.fromLive, [], 'arcturianos é local -> não baixa imagem do ar');
})();

/* ===== MERGE (ebook selecionado): atualiza só ele, preserva o resto do ar ===== */
(function () {
  var live = { arcturianos: ARC_AR, deusdiz1: DEUS };
  var local = { arcturianos: ARC_LOCAL, teste: TESTE };
  var r = planEbooks(local, live, ['arcturianos']);
  ok(r.out.arcturianos === ARC_LOCAL, 'merge: arcturianos atualizado');
  ok(r.out.deusdiz1 === DEUS, 'merge: deusdiz1 do ar preservado');
  ok(!r.out.teste, 'merge: teste NÃO publicado (não foi selecionado)');
  sameSet(r.updated, ['arcturianos'], 'merge atualiza só o selecionado');
  sameSet(r.fromLive, ['deusdiz1'], 'merge: deusdiz1 preservado do ar');
})();

/* ===== Ebook novo (só local, não está no ar) entra e NÃO conta como "fromLive" ===== */
(function () {
  var r = planEbooks({ novo: NOVO }, { arcturianos: ARC_AR }, []);
  ok(r.out.novo === NOVO, 'ebook novo local publicado');
  ok(r.out.arcturianos === ARC_AR, 'arcturianos do ar preservado');
  sameSet(r.fromLive, ['arcturianos'], 'só o do ar precisa de imagens; o novo é local');
})();

/* ===== Primeiro deploy (nada no ar): publica os locais, sem dropped ===== */
(function () {
  var r = planEbooks({ a: ARC_LOCAL, b: TESTE }, {}, []);
  sameSet(Object.keys(r.out), ['a', 'b'], 'primeiro deploy = só locais');
  eqJSON(r.dropped, [], 'sem ar, nada a derrubar');
  sameSet(r.fromLive, [], 'tudo é local');
})();

/* ===== 'only' com ebook inexistente local é ignorado (não cria entrada vazia) ===== */
(function () {
  var r = planEbooks({ a: ARC_LOCAL }, { a: ARC_AR, b: DEUS }, ['inexistente']);
  ok(r.out.a === ARC_AR, 'only inexistente -> a fica como no ar (nenhum local aplicado)');
  ok(r.out.b === DEUS, 'b do ar preservado');
  sameSet(r.updated, [], 'nenhum local aplicado (only inexistente)');
})();

/* ===== Robustez: argumentos nulos não quebram ===== */
(function () {
  eqJSON(planEbooks(null, null, null).out, {}, 'tudo nulo -> {}');
  eqJSON(planEbooks(null, null, null).dropped, [], 'tudo nulo -> dropped []');
  ok(planEbooks({ a: ARC_LOCAL }, null, 'a').out.a === ARC_LOCAL, 'only como string + live nulo');
})();

/* ===== imgsOf: extrai caminhos img/ de string OU objeto, sem repetir ===== */
sameSet(imgsOf({ a: 'img/x.png', b: { c: 'img/y.jpg' }, d: 'img/x.png' }), ['img/x.png', 'img/y.jpg'], 'imgsOf objeto aninhado + dedupe');
sameSet(imgsOf('foo img/a.gif bar img/b.webp'), ['img/a.gif', 'img/b.webp'], 'imgsOf string');
eqJSON(imgsOf(null), [], 'imgsOf null -> []');
eqJSON(imgsOf({ n: 'sem imagem aqui' }), [], 'imgsOf sem img -> []');

/* ===== protectedImages: o CASO REAL — deusdiz1 (do ar) reusa imagem nomeada do arcturianos ===== */
(function () {
  var out = {
    arcturianos: { hero: 'img/arcturianos-br-imghero-1.png', so: 'img/arc-only.png' },
    deusdiz1: { hero: 'img/arcturianos-br-imghero-1.png', own: 'img/deusdiz1-us-hero-1.png' }   // br reusa a do arcturianos
  };
  var prot = protectedImages(out, ['deusdiz1']);
  ok(prot.indexOf('img/arcturianos-br-imghero-1.png') >= 0, 'imagem COMPARTILHADA (deusdiz1 usa) é PROTEGIDA -> nao sobrescreve com local');
  ok(prot.indexOf('img/deusdiz1-us-hero-1.png') >= 0, 'imagem propria do deusdiz1 (do ar) é protegida');
  ok(prot.indexOf('img/arc-only.png') < 0, 'imagem SO do arcturianos local NAO é protegida -> atualiza normal');
})();
eqJSON(protectedImages({ a: { i: 'img/a.png' } }, []), [], 'sem ebook do ar -> nada protegido');
eqJSON(protectedImages(null, null), [], 'protectedImages nulo -> []');

/* ===== decollide: o CASO REAL — arcturianos (local) reusa imagem que o deusdiz1 (ar) também usa ===== */
(function () {
  var out = {
    arcturianos: { hero: 'img/arcturianos-br-imghero-1.png', so: 'img/arc-only.png' },
    deusdiz1: { hero: 'img/arcturianos-br-imghero-1.png', own: 'img/deusdiz1-us-hero-1.png' }
  };
  var r = decollide(out, ['arcturianos'], ['img/arcturianos-br-imghero-1.png', 'img/deusdiz1-us-hero-1.png']);
  ok(r.out.arcturianos.hero === 'img/arcturianos-br-imghero-1-arcturianos.png', 'arcturianos: imagem compartilhada ganhou NOME PROPRIO na publicacao');
  ok(r.out.arcturianos.so === 'img/arc-only.png', 'arcturianos: imagem propria (nao colide) intacta');
  ok(r.out.deusdiz1.hero === 'img/arcturianos-br-imghero-1.png', 'deusdiz1 (do ar) NAO foi tocado');
  ok(r.out.deusdiz1.own === 'img/deusdiz1-us-hero-1.png', 'deusdiz1 own intacto');
  eqJSON(r.copies, { 'img/arcturianos-br-imghero-1-arcturianos.png': 'img/arcturianos-br-imghero-1.png' }, 'mapa: nome novo -> arquivo local original a copiar');
})();
(function () {   // sem colisão -> nada muda
  var r = decollide({ arcturianos: { hero: 'img/arc-hero.png' } }, ['arcturianos'], ['img/deusdiz1-hero.png']);
  ok(r.out.arcturianos.hero === 'img/arc-hero.png', 'sem colisao -> ref intacta');
  eqJSON(r.copies, {}, 'sem colisao -> sem copias');
})();
ok(decollide(null, null, null) && JSON.stringify(decollide(null, null, null).copies) === '{}', 'decollide nulo nao quebra');

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
