/* Testes (TDD) do MAPA ebook->produto no api/hotmart.js — rode: node tests/hotmart-pidmap.test.js
   Todo webhook RASTREADO (com atribuição ebook_versao_...) que traz data.product.id deve ENSINAR
   o hash Redis `pidmap`: campo `ebook` e campo `ebook:versao` -> {pid,pnm}.
   O /api/lead usa esse mapa pra carimbar pid/pnm nos leads dos popups (a automação de
   recuperação precisa do produto em TODO lead). NUNCA pode mexer na contagem de vendas. */
const assert = require('assert');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

process.env.KV_REST_API_URL = 'http://mock';
process.env.KV_REST_API_TOKEN = 'tok';
delete process.env.HOTMART_TOKEN; delete process.env.HOTMART_HOTTOK;

let cmds = [];
global.fetch = async (u, o) => {
  const c = JSON.parse(o.body); cmds.push(c);
  return { json: async () => ({ result: 'OK' }) };
};
const h = require('../api/hotmart.js');
function res() { return { statusCode: 0, out: '', hd: {}, setHeader(k, v) { this.hd[k] = v; }, end(s) { this.out = s || ''; } }; }
function req(body) { return { method: 'POST', url: '/api/hotmart', headers: {}, body: body }; }
function achaHset() { return cmds.find(c => c[0] === 'HSET' && c[1] === 'pidmap'); }

(async () => {
  // 1) ABANDONO rastreado com produto -> ensina pidmap (ebook E ebook:versao)
  cmds = []; let r = res();
  await h(req({ event: 'PURCHASE_OUT_OF_SHOPPING_CART', data: {
    product: { id: 112233, name: 'Ang 27 na hadlang sa espiritwal' },
    buyer: { email: 'lead@x.com', name: 'Juan', phone: '+63 912' },
    purchase: { origin: { sck: 'obstaculos_ph_duzin' } },
    checkout_country: { iso: 'PH' } } }), r);
  let hs = achaHset();
  ok(!!hs, 'abandono rastreado faz HSET pidmap');
  if (hs) {
    const campos = {}; for (let i = 2; i < hs.length; i += 2) campos[hs[i]] = JSON.parse(hs[i + 1]);
    ok(!!campos['obstaculos'] && campos['obstaculos'].pid === '112233', 'campo ebook -> pid');
    ok(!!campos['obstaculos:ph'] && /hadlang/i.test(campos['obstaculos:ph'].pnm), 'campo ebook:versao -> pid+pnm');
  }
  ok(cmds.some(c => c[0] === 'LPUSH' && /^pendlog:/.test(c[1])), 'pendlog continua gravado normal');
  ok(!cmds.some(c => c[0] === 'HINCRBY'), 'abandono NUNCA toca em contador de venda');

  // 1b) EBOOK COM HÍFEN no nome (clones -redeN): a atribuição precisa PEGAR (bug: regex não aceitava
  //     hífen -> venda virava "direto/-"). O e gravado sai SLUGIFICADO (sem hífen), consistente com tudo.
  cmds = []; r = res();
  await h(req({ event: 'PURCHASE_OUT_OF_SHOPPING_CART', data: {
    product: { id: 445566, name: 'Ang 27 na hadlang (tagalo)' },
    buyer: { email: 'ph@x.com', name: 'Juan' },
    purchase: { origin: { sck: 'jesusdiz3-rede3_ph_duzin' } },
    checkout_country: { iso: 'PH' } } }), r);
  const plog = cmds.find(c => c[0] === 'LPUSH' && /^pendlog:/.test(c[1]));
  const prec = plog ? JSON.parse(plog[2]) : {};
  ok(prec.e === 'jesusdiz3rede3' && prec.vs === 'ph', 'ebook com hífen RASTREIA (e slugificado, não vira "-")');
  ok(prec.c === 'duzin', 'canal do ebook com hífen preservado');
  hs = achaHset();
  ok(!!hs && hs.indexOf('jesusdiz3rede3:ph') > 0, 'pidmap aprende o produto do ebook com hífen');

  // 2) VENDA APROVADA rastreada -> ensina o mapa E conta a venda como sempre
  //    + grava a IDENTIDADE DO PRODUTOR (pr): na conta do theuzim os papéis PRODUCER/COPRODUCER
  //    se invertem — sem o pr, o painel dos sócios não sabe de quem é o vn e de quem é o vc.
  cmds = []; r = res();
  await h(req({ event: 'PURCHASE_APPROVED', data: {
    product: { id: 777, name: 'Livro Real' },
    producer: { name: 'COIMBRA MKT' },
    buyer: { email: 'c@d.e', name: 'Maria' },
    purchase: { transaction: 'HP1TESTE', price: { value: 19.9, currency_value: 'BRL' }, payment: { type: 'PIX' }, origin: { sck: 'liv_br_duzin' } },
    commissions: [] } }), r);
  hs = achaHset();
  ok(!!hs && hs.indexOf('liv:br') > 0, 'venda aprovada ensina pidmap (liv:br)');
  ok(cmds.some(c => c[0] === 'HINCRBY'), 'venda aprovada segue contando normal (HINCRBY intacto)');
  const slog = cmds.find(c => c[0] === 'LPUSH' && /^salelog:/.test(c[1]));
  ok(!!slog, 'salelog intacto');
  const srec = slog ? JSON.parse(slog[2]) : {};
  ok(srec.pr === 'coimbramkt', 'venda grava a identidade do PRODUTOR (pr, slugificado)');
  ok(srec.st === 'aprovada' && srec.v === 1990, 'campos da venda intactos (st/valor)');

  // 3) evento SEM rastreio (ebook '-') NÃO ensina (não tem chave pra mapear)
  cmds = []; r = res();
  await h(req({ event: 'PURCHASE_CANCELED', data: {
    product: { id: 555, name: 'Sem rastreio' },
    buyer: { email: 'x@y.z' },
    purchase: { transaction: 'HP2TESTE', payment: { type: 'CREDIT_CARD', refusal_reason: 'refused' } } } }), r);
  ok(!achaHset(), 'sem atribuição -> NÃO grava no pidmap');

  // 4) evento rastreado mas SEM product.id -> não ensina (nada pra mapear)
  cmds = []; r = res();
  await h(req({ event: 'PURCHASE_EXPIRED', data: {
    buyer: { email: 'k@w.q' },
    purchase: { transaction: 'HP3TESTE', origin: { sck: 'liv_br_duzin' } } } }), r);
  ok(!achaHset(), 'sem product.id -> NÃO grava no pidmap');

  console.log('\n' + pass + ' passou, ' + fail + ' falhou');
  process.exit(fail ? 1 : 0);
})();
