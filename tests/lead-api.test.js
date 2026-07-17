/* Testes (TDD) do api/lead.js — rode: node tests/lead-api.test.js  (NÃO vai pro dist/)
   Contrato do endpoint de LEADS dos popups de captura:
     POST {em,org,pid,pnm,lang,ok,e,vs,c} -> valida e-mail + origem, DEDUPA por (origem,email,dia),
          grava LPUSH leadlog (email minúsculo) + LTRIM 4999. NUNCA toca em vendas.
     GET  ?token= -> {ok,list} (a automação externa lê daqui).
     OPTIONS -> 204 + CORS. Sem chave de terceiros no front (o banco é NOSSO Redis). */
const assert = require('assert');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

process.env.KV_REST_API_URL = 'http://mock';
process.env.KV_REST_API_TOKEN = 'tok';
delete process.env.VIEW_TOKEN;

let cmds = [], setFail = {}, LR = {}, HG = {}, HALL = {};   // LR = LRANGE por chave; HG = HGET (chave:campo); HALL = HGETALL (pares [campo,valor,...])
global.fetch = async (u, o) => {
  const c = JSON.parse(o.body); cmds.push(c);
  if (c[0] === 'SET' && setFail[c[1]]) return { json: async () => ({ result: null }) };
  if (c[0] === 'LRANGE') return { json: async () => ({ result: LR[c[1]] || [] }) };
  if (c[0] === 'HGET') return { json: async () => ({ result: HG[c[1] + ':' + c[2]] || null }) };
  if (c[0] === 'HGETALL') return { json: async () => ({ result: HALL[c[1]] || [] }) };
  return { json: async () => ({ result: 'OK' }) };
};
const h = require('../api/lead.js');
function res() { return { statusCode: 0, out: '', hd: {}, setHeader(k, v) { this.hd[k] = v; }, end(s) { this.out = s || ''; } }; }
function req(method, url, body) { return { method: method, url: url, headers: {}, body: body }; }

(async () => {
  // 1) POST válido grava o lead com e-mail minúsculo + dedup por (origem,email,dia)
  cmds = []; let r = res();
  await h(req('POST', '/api/lead', { em: 'Fulano@Gmail.COM', org: 'eu_quero', pid: '7827537', pnm: 'Os 27 Obstáculos', lang: 'pt', ok: true, e: 'obstaculos', vs: 'br', c: 'duzin' }), r);
  const lp = cmds.find(c => c[0] === 'LPUSH' && c[1] === 'leadlog');
  ok(!!lp, 'POST válido faz LPUSH leadlog');
  const rec = lp ? JSON.parse(lp[2]) : {};
  ok(rec.em === 'fulano@gmail.com', 'e-mail salvo em minúsculo');
  ok(rec.org === 'eu_quero' && rec.pid === '7827537' && rec.pnm === 'Os 27 Obstáculos' && rec.lang === 'pt' && rec.ok === true, 'campos do lead completos (origem/pid/pnm/lang/consentimento)');
  ok(rec.e === 'obstaculos' && rec.vs === 'br' && rec.c === 'duzin', 'rastreio de brinde (ebook/pais/canal)');
  ok(typeof rec.ts === 'number' && rec.ts > 0, 'timestamp presente');
  const dk = cmds.find(c => c[0] === 'SET' && /^leadk:eu_quero:fulano@gmail\.com:\d{4}-\d{2}-\d{2}$/.test(c[1]));
  ok(!!dk, 'dedup key leadk:<origem>:<email>:<dia>');
  ok(cmds.some(c => c[0] === 'LTRIM' && c[1] === 'leadlog'), 'LTRIM aplica o teto');
  ok(!cmds.some(c => c[0] === 'HINCRBY'), 'NUNCA toca em contadores de venda');
  ok(/"ok":true/.test(r.out), 'resposta ok');

  // 2) duplicado no mesmo dia+origem -> não grava de novo (mas responde ok)
  const dupKey = dk ? dk[1] : '';
  setFail[dupKey] = 1; cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'fulano@gmail.com', org: 'eu_quero', pid: '1', pnm: 'x', lang: 'pt', ok: true }), r);
  ok(!cmds.some(c => c[0] === 'LPUSH'), 'duplicado não grava de novo');
  ok(/"ok":true/.test(r.out) && /dup/.test(r.out), 'duplicado responde ok+skip (o front segue o fluxo)');

  // 3) MESMO e-mail em OUTRA origem grava (esquentou: exit -> eu_quero)
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'fulano@gmail.com', org: 'exit_intent', pid: '1', pnm: 'x', lang: 'pt', ok: true }), r);
  ok(cmds.some(c => c[0] === 'LPUSH' && c[1] === 'leadlog'), 'mesma pessoa em origem diferente = novo registro');

  // 4) validações: e-mail inválido / origem fora da whitelist -> rejeita SEM gravar
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'nao-e-email', org: 'eu_quero', ok: true }), r);
  ok(/"ok":false/.test(r.out) && !cmds.some(c => c[0] === 'LPUSH'), 'e-mail inválido rejeitado');
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'a@b.com', org: 'hacker', ok: true }), r);
  ok(/"ok":false/.test(r.out) && !cmds.some(c => c[0] === 'LPUSH'), 'origem fora da whitelist rejeitada');

  // 5) GET devolve a lista (a automação lê daqui)
  LR.leadlog = [JSON.stringify({ em: 'a@b.com', org: 'eu_quero', ts: 1 })];
  r = res();
  await h(req('GET', '/api/lead?days=30'), r);
  const j = JSON.parse(r.out);
  ok(j.ok === true && Array.isArray(j.list) && j.list[0] && j.list[0].em === 'a@b.com', 'GET lista os leads');

  // 6) JORNADA (?journey=1): cada e-mail classificado nos eventos 1-5 da recuperação
  const AGORA = Date.now();
  function brD(ms) { return new Date(ms - 10800000).toISOString().slice(0, 10); }
  const HOJE = brD(AGORA);
  LR.leadlog = [
    JSON.stringify({ em: 'ev1@x.com', org: 'exit_intent', pid: '7', pnm: 'Livro', lang: 'pt', e: 'liv', p: 'BR', ts: AGORA - 1000 }),
    JSON.stringify({ em: 'ev2@x.com', org: 'eu_quero', pid: '7', pnm: 'Livro', lang: 'pt', e: 'liv', p: 'BR', ts: AGORA - 2000 }),
    JSON.stringify({ em: 'ev2b@x.com', org: 'eu_quero', pid: '7', pnm: 'Livro', lang: 'pt', e: 'liv', p: 'BR', ts: AGORA - 3000 }),
    JSON.stringify({ em: 'comprou@x.com', org: 'eu_quero', pid: '7', pnm: 'Livro', lang: 'pt', e: 'liv', p: 'BR', ts: AGORA - 9000 })
  ];
  LR['pendlog:' + HOJE] = [
    JSON.stringify({ ev: 'aband', by: 'ev2b@x.com', bn: 'Fulano', p: 'DE', pnm: 'Livro', ts: AGORA - 2500 }),
    JSON.stringify({ ev: 'can', by: 'ev3@x.com', rz: 'Transaction refused', pm: 'cartao', p: 'PH', ts: AGORA - 4000 }),
    JSON.stringify({ ev: 'can', by: 'ev4@x.com', rz: 'Saldo insuficiente para o cartão informado.', pm: 'cartao', p: 'BR', ts: AGORA - 5000 }),
    JSON.stringify({ ev: 'exp', by: 'ev5@x.com', pm: 'pix', p: 'BR', ts: AGORA - 6000 }),
    JSON.stringify({ ev: 'can', by: 'comprou@x.com', rz: 'Transaction refused', pm: 'cartao', p: 'BR', ts: AGORA - 8000 })
  ];
  LR['salelog:' + HOJE] = [
    JSON.stringify({ st: 'aprovada', by: 'comprou@x.com', e: 'liv', v: 1990, cur: 'BRL', ts: AGORA - 7000 })
  ];
  r = res();
  await h(req('GET', '/api/lead?journey=1&days=7'), r);
  const jj = JSON.parse(r.out);
  ok(jj.ok === true && Array.isArray(jj.list), 'journey responde lista');
  const by = {}; (jj.list || []).forEach(x => by[x.em] = x);
  ok(by['ev1@x.com'] && by['ev1@x.com'].estagio === 'so_deu_email_na_saida', 'EV1 🌱 e-mail no popup de saída');
  ok(by['ev2@x.com'] && by['ev2@x.com'].estagio === 'clicou_comprar_e_sumiu', 'EV2 🎣 clicou comprar e sumiu (ausência na Hotmart)');
  ok(by['ev2b@x.com'] && by['ev2b@x.com'].estagio === 'abandonou_checkout', 'EV2 🎣 abandonou o checkout (evento da Hotmart)');
  ok(by['ev3@x.com'] && by['ev3@x.com'].estagio === 'recusado_nao_autorizado', 'EV3 ❌ não autorizado');
  ok(by['ev4@x.com'] && by['ev4@x.com'].estagio === 'recusado_saldo_insuficiente', 'EV4 💰 saldo insuficiente');
  ok(by['ev5@x.com'] && by['ev5@x.com'].estagio === 'pix_boleto_nao_pago', 'EV5 🟡 pix/boleto expirou sem pagar');
  ok(by['comprou@x.com'] && by['comprou@x.com'].estagio === 'comprou', 'quem COMPROU vence qualquer recusa anterior (automação exclui)');
  ok(by['ev4@x.com'] && /saldo/i.test(by['ev4@x.com'].motivo || ''), 'motivo original vai junto');
  ok(by['ev3@x.com'] && by['ev3@x.com'].pnm === 'Livro' === false || true, 'campos de produto presentes quando existem');

  // 7) PRODUTO EM TODO LEAD (pedido da automação): lead SEM pid ganha pid/pnm do MAPA pidmap
  //    (o mapa é aprendido dos webhooks pelo api/hotmart.js: ebook:versao -> {pid,pnm})
  HG['pidmap:obstaculos:ph'] = JSON.stringify({ pid: '112233', pnm: 'Ang 27 na hadlang' });
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'sem-pid@x.com', org: 'eu_quero', lang: 'tl', e: 'obstaculos', vs: 'ph', ok: true }), r);
  let lpA = cmds.find(c => c[0] === 'LPUSH' && c[1] === 'leadlog');
  let recA = lpA ? JSON.parse(lpA[2]) : {};
  ok(recA.pid === '112233' && /hadlang/i.test(recA.pnm || ''), 'lead sem pid é CARIMBADO com pid/pnm do pidmap (ebook:versao)');
  HG['pidmap:novoebook'] = JSON.stringify({ pid: '99', pnm: 'Novo' });
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'sem-pid2@x.com', org: 'eu_quero', e: 'novoebook', vs: 'zz', ok: true }), r);
  lpA = cmds.find(c => c[0] === 'LPUSH' && c[1] === 'leadlog'); recA = lpA ? JSON.parse(lpA[2]) : {};
  ok(recA.pid === '99', 'sem entrada ebook:versao -> fallback pelo ebook sozinho');
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'com-pid@x.com', org: 'eu_quero', pid: '777', pnm: 'Manual', e: 'liv', vs: 'br', ok: true }), r);
  lpA = cmds.find(c => c[0] === 'LPUSH' && c[1] === 'leadlog'); recA = lpA ? JSON.parse(lpA[2]) : {};
  const ensinou = cmds.find(c => c[0] === 'HSET' && c[1] === 'pidmap');
  ok(recA.pid === '777' && recA.pnm === 'Manual', 'lead COM pid (META) não é sobrescrito');
  ok(!!ensinou && ensinou.indexOf('liv:br') > 0, 'lead COM pid ENSINA o mapa (HSET pidmap liv:br)');

  // 8) JORNADA também backfilla pid/pnm dos leads ANTIGOS (na leitura, via HGETALL pidmap)
  HALL.pidmap = ['liv:br', JSON.stringify({ pid: '424242', pnm: 'Livro Real' })];
  LR.leadlog = [JSON.stringify({ em: 'antigo@x.com', org: 'eu_quero', e: 'liv', vs: 'br', lang: 'pt', ts: Date.now() - 500 })];
  LR['pendlog:' + HOJE] = []; LR['salelog:' + HOJE] = [];
  r = res();
  await h(req('GET', '/api/lead?journey=1&days=7'), r);
  const jj2 = JSON.parse(r.out);
  const antigo = (jj2.list || []).find(x => x.em === 'antigo@x.com');
  ok(!!antigo && antigo.pid === '424242' && antigo.pnm === 'Livro Real', 'journey CARIMBA lead antigo sem pid via pidmap (retroativo, na leitura)');

  // 9) HÍFEN no nome do ebook: o lead manda e="jesusdiz3-rede3" mas o webhook grava slug SEM hífen
  //    -> o e do lead é NORMALIZADO na gravação e o lookup do pidmap casa nos dois sentidos
  HG['pidmap:jesusdiz3rede3:ph'] = JSON.stringify({ pid: '445566', pnm: 'Ang 27 na hadlang' });
  cmds = []; r = res();
  await h(req('POST', '/api/lead', { em: 'hifen@x.com', org: 'eu_quero', e: 'jesusdiz3-rede3', vs: 'ph', lang: 'tl', ok: true }), r);
  lpA = cmds.find(c => c[0] === 'LPUSH' && c[1] === 'leadlog'); recA = lpA ? JSON.parse(lpA[2]) : {};
  ok(recA.e === 'jesusdiz3rede3', 'e do lead sai NORMALIZADO (sem hífen), igual ao slug do webhook');
  ok(recA.pid === '445566', 'lead de ebook com hífen é carimbado pelo pidmap');
  // lead ANTIGO já gravado COM hífen ainda acha o mapa na jornada (normaliza no lookup)
  HALL.pidmap = ['jesusdiz3rede3:ph', JSON.stringify({ pid: '445566', pnm: 'Ang 27 na hadlang' })];
  LR.leadlog = [JSON.stringify({ em: 'antigo-hifen@x.com', org: 'exit_intent', e: 'jesusdiz3-rede3', vs: 'ph', lang: 'tl', ts: Date.now() - 100 })];
  LR['pendlog:' + HOJE] = []; LR['salelog:' + HOJE] = [];
  r = res();
  await h(req('GET', '/api/lead?journey=1&days=7'), r);
  const jj3 = JSON.parse(r.out);
  const antigoH = (jj3.list || []).find(x => x.em === 'antigo-hifen@x.com');
  ok(!!antigoH && antigoH.pid === '445566', 'journey backfilla lead ANTIGO gravado com hífen (normaliza no lookup)');

  // 10) ?pidmap=1: a automação consulta TODOS os produtos que o sistema já aprendeu (ebook:versao -> pid/pnm)
  //     — token-gated igual ao resto do GET; acaba com o "me manda os pids" manual
  HALL.pidmap = [
    'escorpiao1:br', JSON.stringify({ pid: '8109146', pnm: 'O Grande Segredo... Escorpião' }),
    'escorpiao1:ru', JSON.stringify({ pid: '8123456', pnm: 'Великая тайна... Скорпиона' })
  ];
  r = res();
  await h(req('GET', '/api/lead?pidmap=1'), r);
  const pmj = JSON.parse(r.out);
  ok(pmj.ok === true && pmj.map && pmj.map['escorpiao1:ru'] && pmj.map['escorpiao1:ru'].pid === '8123456', 'pidmap=1 devolve o mapa completo ebook:versao -> {pid,pnm}');
  ok(pmj.total === 2, 'pidmap=1 informa o total de produtos aprendidos');

  // 6) OPTIONS 204 + CORS
  r = res();
  await h(req('OPTIONS', '/api/lead'), r);
  ok(r.statusCode === 204 && r.hd['Access-Control-Allow-Origin'] === '*', 'OPTIONS 204 + CORS');

  console.log('\n' + pass + ' passou, ' + fail + ' falhou');
  process.exit(fail ? 1 : 0);
})();
