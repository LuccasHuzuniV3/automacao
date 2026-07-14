/* Testes (TDD) das COMISSÕES multi-coprodutor no api/hotmart.js — rode: node tests/hotmart-comissoes.test.js
   Caso real (HP2338496185, venda rede3 na conta do theuzim): commissions traz PRODUCER (theuzim 7,85)
   + DOIS coprodutores: joniclei/junin (7,84 = metade do sócio) e Eduardo (1,74 = dono da rede 3,
   "afiliado de página"). Regra: vn=PRODUCER · vc=o MAIOR coprodutor (sócio; a metade é sempre maior
   que o corte da rede) · va=demais coprodutores + AFFILIATE (comissão de rede REAL).
   E a MESMA transação NUNCA conta 2x (as duas contas mandam cópia da mesma venda). */
const assert = require('assert');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

process.env.KV_REST_API_URL = 'http://mock';
process.env.KV_REST_API_TOKEN = 'tok';
delete process.env.HOTMART_TOKEN; delete process.env.HOTMART_HOTTOK;

let cmds = [], setSeen = {};
global.fetch = async (u, o) => {
  const c = JSON.parse(o.body); cmds.push(c);
  if (c[0] === 'SET' && c[4] === 'EX' && /^tx(ok|ref):/.test(c[1])) {   // dedup NX de transação: 2ª vez falha
    if (setSeen[c[1]]) return { json: async () => ({ result: null }) };
    setSeen[c[1]] = 1;
  }
  return { json: async () => ({ result: 'OK' }) };
};
const h = require('../api/hotmart.js');
function res() { return { statusCode: 0, out: '', hd: {}, setHeader(k, v) { this.hd[k] = v; }, end(s) { this.out = s || ''; } }; }
function venda(tx, comms) {
  return { method: 'POST', url: '/api/hotmart', headers: {}, body: {
    event: 'PURCHASE_APPROVED', data: {
      product: { id: 999, name: 'Rede3 KR' },
      producer: { name: 'COIMBRA MKT DIGITAL LTDA' },
      buyer: { email: 'kr@x.com', name: 'Min' },
      purchase: { transaction: tx, price: { value: 19.9, currency_value: 'USD' }, payment: { type: 'CREDIT_CARD' }, origin: { sck: 'jesusdiz3-rede3_kr_duzin' } },
      commissions: comms } } };
}
function ultimaVenda() { const l = cmds.filter(c => c[0] === 'LPUSH' && /^salelog:/.test(c[1])).pop(); return l ? JSON.parse(l[2]) : null; }

(async () => {
  // 1) CASO REAL rede3: 2 coprodutores -> vc = o MAIOR (sócio), va = o resto (rede/afiliado de página)
  cmds = []; let r = res();
  await h(venda('HP2338496185', [
    { source: 'MARKETPLACE', value: 2.47, currency_value: 'USD' },
    { source: 'PRODUCER', value: 7.85, currency_value: 'USD' },
    { source: 'COPRODUCER', value: 7.84, currency_value: 'USD' },
    { source: 'COPRODUCER', value: 1.74, currency_value: 'USD' }
  ]), r);
  let v = ultimaVenda();
  ok(!!v, 'venda gravada');
  ok(v && v.vn === 785, 'vn = parte do PRODUCER (theuzim 7,85)');
  ok(v && v.vc === 784, 'vc = o MAIOR coprodutor (junin 7,84) — não o último da lista');
  ok(v && v.va === 174, 'va = coprodutor extra (Eduardo/rede 1,74)');
  ok(v && v.cc === 'USD' && v.ca === 'USD', 'moedas do sócio e da rede');
  ok(v && v.pr === 'coimbramktdigitalltda', 'pr = produtor (conta do theuzim)');

  // 2) ORDEM INVERTIDA (Eduardo vem antes) -> mesmo resultado (regra do maior, não do último)
  cmds = []; r = res();
  await h(venda('HPORDEM2', [
    { source: 'COPRODUCER', value: 1.74, currency_value: 'USD' },
    { source: 'COPRODUCER', value: 7.84, currency_value: 'USD' },
    { source: 'PRODUCER', value: 7.85, currency_value: 'USD' }
  ]), r);
  v = ultimaVenda();
  ok(v && v.vc === 784 && v.va === 174, 'ordem no payload não muda quem é o sócio');

  // 3) venda clássica (1 coprodutor, sem rede) -> vc normal, va zero
  cmds = []; r = res();
  await h(venda('HPCLASSICA', [
    { source: 'PRODUCER', value: 8.46, currency_value: 'BRL' },
    { source: 'COPRODUCER', value: 8.46, currency_value: 'BRL' }
  ]), r);
  v = ultimaVenda();
  ok(v && v.vn === 846 && v.vc === 846 && (v.va || 0) === 0, 'venda 50/50 clássica intacta (va=0)');

  // 4) AFFILIATE oficial da Hotmart também entra no va
  cmds = []; r = res();
  await h(venda('HPAFI', [
    { source: 'PRODUCER', value: 7.0, currency_value: 'BRL' },
    { source: 'COPRODUCER', value: 7.0, currency_value: 'BRL' },
    { source: 'AFFILIATE', value: 3.0, currency_value: 'BRL' }
  ]), r);
  v = ultimaVenda();
  ok(v && v.va === 300 && v.vc === 700, 'comissão de AFFILIATE soma no va (não rouba o lugar do sócio)');

  // 5) A MESMA transação chegando de novo (cópia da 2ª conta) NÃO conta 2x
  cmds = []; r = res();
  await h(venda('HP2338496185', [{ source: 'PRODUCER', value: 7.85, currency_value: 'USD' }]), r);
  ok(!ultimaVenda() && /duplicado/.test(r.out), 'cópia duplicada da mesma transação é descartada (dedup)');
  ok(!cmds.some(c => c[0] === 'HINCRBY'), 'duplicada não toca nos contadores');

  console.log('\n' + pass + ' passou, ' + fail + ' falhou');
  process.exit(fail ? 1 : 0);
})();
