/* Testes (TDD) do gate de hottok MULTI-CONTA no api/hotmart.js — rode: node tests/hotmart-token.test.js
   Cada CONTA Hotmart tem o próprio hottok. Com produtos nas contas do junin E do theuzim apontando
   pro MESMO endpoint, a env HOTMART_TOKEN aceita uma LISTA separada por vírgula:
     HOTMART_TOKEN="tokjunin,toktheuzim"
   Regras: qualquer token da lista passa · token errado é rejeitado · 1 token só continua
   funcionando igual (retrocompatível) · env vazia = gate desligado (como sempre foi). */
const assert = require('assert');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

process.env.KV_REST_API_URL = 'http://mock';
process.env.KV_REST_API_TOKEN = 'tok';
process.env.HOTMART_TOKEN = 'tokjunin, toktheuzim';   // lista (com espaço de gente distraída)

let cmds = [];
global.fetch = async (u, o) => { const c = JSON.parse(o.body); cmds.push(c); return { json: async () => ({ result: 'OK' }) }; };
const h = require('../api/hotmart.js');
function res() { return { statusCode: 0, out: '', hd: {}, setHeader(k, v) { this.hd[k] = v; }, end(s) { this.out = s || ''; } }; }
function evento(hottok, tx) {
  return { method: 'POST', url: '/api/hotmart', headers: {}, body: {
    event: 'PURCHASE_APPROVED', hottok: hottok, data: {
      product: { id: 123, name: 'Livro' }, buyer: { email: 'a@b.c' },
      purchase: { transaction: tx, price: { value: 10, currency_value: 'BRL' }, payment: { type: 'PIX' }, origin: { sck: 'liv_br_duzin' } },
      commissions: [] } } };
}

(async () => {
  // 1) hottok do junin passa
  cmds = []; let r = res();
  await h(evento('tokjunin', 'HPJUNIN1'), r);
  ok(cmds.some(c => c[0] === 'HINCRBY'), 'hottok da conta 1 (junin) processa a venda');

  // 2) hottok do theuzim TAMBÉM passa (a conta nova)
  cmds = []; r = res();
  await h(evento('toktheuzim', 'HPTHEUZIM1'), r);
  ok(cmds.some(c => c[0] === 'HINCRBY'), 'hottok da conta 2 (theuzim) processa a venda');

  // 3) token desconhecido é rejeitado SEM tocar em nada
  cmds = []; r = res();
  await h(evento('hacker123', 'HPHACK1'), r);
  ok(/"error":"token"/.test(r.out) && !cmds.some(c => c[0] === 'HINCRBY' || c[0] === 'LPUSH'), 'token errado rejeitado sem gravar nada');

  // 4) sem hottok nenhum no payload também é rejeitado (env configurada = gate ligado)
  cmds = []; r = res();
  await h(evento('', 'HPVAZIO1'), r);
  ok(/"error":"token"/.test(r.out), 'payload sem hottok rejeitado quando o gate está ligado');

  console.log('\n' + pass + ' passou, ' + fail + ' falhou');
  process.exit(fail ? 1 : 0);
})();
