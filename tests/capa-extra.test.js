/* Testes (TDD) da CAPA EXTRA do upsell — rode: node tests/capa-extra.test.js  (NÃO vai pro dist/)
   Trava o contrato da funcionalidade "duplicar a capa" (só upsell):
     - dupSeed:    molde da cópia a partir da capa atual (img/hero + tamanho szHero)
     - addCapa:    empilha uma cópia PROFUNDA e INDEPENDENTE (não muta molde nem array original)
     - pickExtras: quais capas extras renderizam, em que ordem — SÓ no layout central (colCentral),
                   pulando vazias mas PRESERVANDO o índice (o índice vira o caminho data-img="capaX.<i>.img").
   Espelha a lógica inline do index.html (render ~linha 613) e do builder.html (botão "⧉ duplicar" na barra da imagem da capa). */
const assert = require('assert');
let pass = 0, fail = 0;
function eq(got, exp, msg) { try { assert.strictEqual(got, exp); pass++; } catch (e) { fail++; console.log('  x ' + msg + ' | esperado ' + JSON.stringify(exp) + ' | recebi ' + JSON.stringify(got)); } }
function dq(got, exp, msg) { try { assert.deepStrictEqual(got, exp); pass++; } catch (e) { fail++; console.log('  x ' + msg + ' | esperado ' + JSON.stringify(exp) + ' | recebi ' + JSON.stringify(got)); } }

/* ==== unidades puras (espelham o código inline do builder/index) ==== */
function dupSeed(hero, szHero) { return { img: (hero == null ? '' : String(hero)), sz: (szHero == null ? '' : String(szHero)) }; }
function addCapa(capaX, item) { var a = Array.isArray(capaX) ? capaX.slice() : []; a.push(JSON.parse(JSON.stringify(item))); return a; }
function pickExtras(capaX, colCentral) { if (!colCentral || !Array.isArray(capaX)) return []; var out = []; for (var i = 0; i < capaX.length; i++) { var c = capaX[i]; if (c && c.img) out.push({ i: i, img: c.img, sz: (c && c.sz) || '' }); } return out; }

/* ---- dupSeed: molde = capa atual (img + tamanho); vazio ainda gera item vazio pra trocar depois ---- */
dq(dupSeed('img/capa.png', '320px'), { img: 'img/capa.png', sz: '320px' }, 'molde copia img + tamanho da capa');
dq(dupSeed('img/capa.png', undefined), { img: 'img/capa.png', sz: '' }, 'sem szHero -> sz vazio');
dq(dupSeed('', ''), { img: '', sz: '' }, 'capa vazia -> item vazio (usuário troca a imagem)');
dq(dupSeed(null, null), { img: '', sz: '' }, 'null vira string vazia (não quebra)');

/* ---- addCapa: cópia PROFUNDA, empilha no fim, cria o array se não existir ---- */
dq(addCapa(undefined, { img: 'a', sz: '' }), [{ img: 'a', sz: '' }], 'cria o array quando capaX não existe');
dq(addCapa([], { img: 'a', sz: '10px' }), [{ img: 'a', sz: '10px' }], 'array vazio -> 1 item');
dq(addCapa([{ img: 'a' }], { img: 'b' }), [{ img: 'a' }, { img: 'b' }], 'empilha no FIM (mantém as anteriores)');
(function () {
  var seed = { img: 'x', sz: '5px' };
  var r = addCapa([], seed);
  r[0].img = 'ZZZ';                       // mexer na cópia...
  eq(seed.img, 'x', 'cópia é INDEPENDENTE do molde (deep copy)');
})();
(function () {
  var orig = [{ img: 'a' }];
  var r = addCapa(orig, { img: 'b' });
  eq(orig.length, 1, 'NÃO muta o array original');
  eq(r.length, 2, 'retorno tem os 2');
})();

/* ---- pickExtras: gate colCentral + ordem + índice preservado (o índice é o caminho data-img) ---- */
dq(pickExtras([{ img: 'a' }], false), [], 'colCentral=false -> nada (só renderiza no upsell)');
dq(pickExtras(null, true), [], 'capaX não-array -> []');
dq(pickExtras(undefined, true), [], 'capaX undefined -> []');
dq(pickExtras([], true), [], 'capaX vazio -> []');
dq(pickExtras([{ img: 'a', sz: '100px' }, { img: 'b', sz: '200px' }], true),
  [{ i: 0, img: 'a', sz: '100px' }, { i: 1, img: 'b', sz: '200px' }], 'preserva ordem + tamanho');
dq(pickExtras([{ img: 'a' }, { img: '' }, { img: 'c' }], true),
  [{ i: 0, img: 'a', sz: '' }, { i: 2, img: 'c', sz: '' }], 'pula a vazia mas PRESERVA o índice (0 e 2, não 0 e 1)');
dq(pickExtras([null, { img: 'b' }], true), [{ i: 1, img: 'b', sz: '' }], 'item null é ignorado, índice preservado');
dq(pickExtras([{ img: 'a' }], true), [{ i: 0, img: 'a', sz: '' }], 'sem sz -> sz vazio (herda --szHero no CSS)');

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
