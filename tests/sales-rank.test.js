/* Testes (TDD) do rankSales (api/sales.js) — rankings de vendas por país / src / ebook.
   Rode: node tests/sales-rank.test.js   (NÃO vai pro dist/) */
const assert = require('assert');
const { rankSales } = require('../api/sales.js');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  x ' + m); } }
function eqJSON(g, e, m) { try { assert.deepStrictEqual(g, e); pass++; } catch (err) { fail++; console.log('  x ' + m + ' | esp ' + JSON.stringify(e) + ' | got ' + JSON.stringify(g)); } }

// vendas de exemplo (v em CENTAVOS, igual o salelog grava)
var list = [
  { st: 'aprovada', cur: 'BRL', v: 1990, p: 'BR', vid: '5', e: 'arcturianos' },
  { st: 'aprovada', cur: 'BRL', v: 1990, p: 'BR', vid: '5', e: 'arcturianos' },
  { st: 'aprovada', cur: 'EUR', v: 900, p: 'DE', vid: '6', e: 'deusdiz1' },
  { st: 'aprovada', cur: 'USD', v: 1990, p: 'US', vid: '', e: 'arcturianos' },   // sem vid -> '-'
  { st: 'estorno', cur: 'BRL', v: 1990, p: 'BR', vid: '5', e: 'arcturianos' }     // estorno desconta
];
var r = rankSales(list);

/* país */
var pBR = r.pais.filter(function (x) { return x.k === 'BR'; })[0];
ok(pBR && pBR.vd === 1, 'pais BR vd liquido = 1 (2 aprovadas - 1 estorno)');
ok(pBR && Math.abs(pBR.r.BRL - 19.90) < 0.001, 'pais BR receita R$ 19,90 (centavos->unidade; estorno desconta)');
ok(r.pais.length === 3, 'tem BR, US, DE no rank de pais');
ok(r.pais[0].vd >= r.pais[r.pais.length - 1].vd, 'pais ordenado do que MAIS vende');

/* src / vídeo */
var s5 = r.src.filter(function (x) { return x.k === '5'; })[0];
ok(s5 && s5.vd === 1, 'src 5 vd = 1');
ok(r.src.some(function (x) { return x.k === '-'; }), 'venda SEM vid vira src "-"');

/* ebook */
var eArc = r.ebook.filter(function (x) { return x.k === 'arcturianos'; })[0];
ok(eArc && eArc.vd === 2, 'ebook arcturianos vd = 2 (2 BR + 1 US - 1 estorno)');
ok(r.ebook.filter(function (x) { return x.k === 'deusdiz1'; })[0].vd === 1, 'ebook deusdiz1 vd = 1');

/* só com venda > 0 entra */
ok(r.pais.every(function (x) { return x.vd > 0; }), 'rank só com vd > 0');

/* robustez */
eqJSON(rankSales([]), { pais: [], src: [], ebook: [] }, 'lista vazia -> rankings vazios');
eqJSON(rankSales(null), { pais: [], src: [], ebook: [] }, 'null -> rankings vazios');

/* top 12 no máximo */
var big = []; for (var i = 0; i < 30; i++) big.push({ st: 'aprovada', cur: 'BRL', v: 100, p: 'P' + i, vid: 'v' + i, e: 'e' + i });
ok(rankSales(big).pais.length === 12, 'corta no top 12');

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
