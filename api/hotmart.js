/* =====================================================================
   /api/hotmart  —  recebe o WEBHOOK (postback) de venda da Hotmart e
   grava no Redis. Completa o funil: acessos -> cliques -> VENDAS/RECEITA.
   - GET (ou validação) responde 200 (pra Hotmart aceitar a URL).
   - POST: lê o evento, pega o src (ebook_versao_canal) + valor + país do
     comprador, e soma/desconta no contador do dia.
   Sem dependências: só fetch + a REST API do Redis.
   ===================================================================== */
const { parse } = require('url');
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
// trava anti-fraude opcional. MULTI-CONTA: cada conta Hotmart (junin, theuzim...) tem o PRÓPRIO hottok —
// a env aceita a lista separada por vírgula: HOTMART_TOKEN="tok_junin,tok_theuzim". Vazio = gate desligado.
const TOKENS = String(process.env.HOTMART_TOKEN || process.env.HOTMART_HOTTOK || '').split(/[,;\s]+/).filter(Boolean);

function clean(s, max) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, max || 40); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 40); }
// acha o src (ebook_versao_canal_tema) em QUALQUER lugar do payload, independente do nome do campo
function findSrc(obj) {
  let found = '';
  (function walk(o, d) {
    if (found || d > 7 || o == null) return;
    if (typeof o === 'string') { if (o.length < 80 && /^[a-z0-9-]+_[a-z]{2,3}_[a-z0-9_-]+$/i.test(o)) found = o; return; }   // aceita HÍFEN no nome do ebook (clones -redeN); o slug() tira depois
    if (typeof o === 'object') { for (const k in o) { if (found) return; walk(o[k], d + 1); } }
  })(obj, 0);
  return found;
}
async function redis(cmd) { const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return r.json(); }

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // health/validação (a Hotmart precisa de uma URL que responda)
  if (req.method !== 'POST') {
    const q0 = parse(req.url, true).query || {};
    if (q0.raw === '1' && RURL && RTOK) { let lw = ''; try { lw = (await redis(['GET', 'lastwebhook'])).result || ''; } catch (e) {} res.statusCode = 200; res.end(JSON.stringify({ ok: true, last: lw })); return; }
    if (q0.raw === 'cancel' && RURL && RTOK) { let lc = ''; try { lc = (await redis(['GET', 'lastcancel'])).result || ''; } catch (e) {} res.statusCode = 200; res.end(JSON.stringify({ ok: true, last: lc })); return; }   // espião do último CANCELAMENTO
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, msg: 'Hotmart webhook pronto' })); return;
  }
  try {
    // o Vercel as vezes JA leu o corpo (req.body). Usa ele; senao le o stream.
    let body = (req.body && typeof req.body === 'object') ? req.body : null;
    if (!body) {
      let raw = (typeof req.body === 'string') ? req.body : '';
      if (!raw) await new Promise(function (done) { req.on('data', function (c) { raw += c; }); req.on('end', done); req.on('error', done); });
      try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
    }
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }
    try { await redis(['SET', 'lastwebhook', JSON.stringify(body).slice(0, 5000), 'EX', '172800']); } catch (e) {}  // debug: ultimo payload (2 dias)

    const q = parse(req.url, true).query || {};
    const hottok = body.hottok || q.hottok || req.headers['x-hotmart-hottok'] || '';
    if (TOKENS.length && TOKENS.indexOf(String(hottok).trim()) < 0) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'token' })); return; }

    const event = String(body.event || body.status || (body.data && body.data.purchase && body.data.purchase.status) || '').toUpperCase();
    const data = body.data || body;
    const purchase = data.purchase || {};
    const price = (purchase.price && purchase.price.value) || (purchase.full_price && purchase.full_price.value) || data.price || 0;
    const tracking = purchase.tracking || data.tracking || {};
    const src = (purchase.origin && purchase.origin.src) || tracking.source || tracking.src || data.src || q.src || '';
    const sckRaw = ((purchase.origin && purchase.origin.sck) || tracking.source_sck || tracking.sck || data.sck || q.sck || '');
    // A Hotmart so devolve o 'sck' de forma confiavel (sem 'off' o 'src' nao volta). Por isso a landing manda a ATRIBUICAO no sck: <ebook_pais_pessoa_rede>~<video>.
    const isAttr = function (s) { return /^[a-z0-9-]+_[a-z]{2,3}_/i.test(String(s)); };   // hífen permitido: "jesusdiz3-rede3_ph_..." é atribuição válida
    const KNOWN_WS = { upsell: 1, downsell: 1, downsell2: 1, upsell2: 1, downsell3: 1, principal: 1 };   // etapas do funil
    const _sk = String(sckRaw).split('~'); const sckAttr = _sk[0] || '';
    let sckVid = '', sckStage = '';
    // sck = atribuicao~video[~funil]. So' le o funil se o ULTIMO pedaco for um workspace CONHECIDO; senao mantem o parsing ANTIGO (nao quebra o rastreamento atual)
    if (_sk.length >= 3 && KNOWN_WS[String(_sk[_sk.length - 1] || '').toLowerCase()]) { sckStage = _sk[_sk.length - 1]; sckVid = _sk.slice(1, _sk.length - 1).join('~'); }
    else { sckVid = (_sk.length > 1 ? _sk.slice(1).join('~') : ''); }
    let track = '', vidRaw = '';
    if (isAttr(src)) { track = src; vidRaw = sckVid || (isAttr(sckRaw) ? '' : sckRaw); }            // COM 'off': a Hotmart devolveu o 'src'
    else if (isAttr(sckAttr)) { track = sckAttr; vidRaw = sckVid; }                                  // SEM 'off': a atribuicao veio no 'sck'
    else { const f = findSrc(data); track = f || ''; vidRaw = (isAttr(sckRaw) ? '' : sckRaw); }      // direto / fallback (acha o src no data — NÃO no body inteiro: o nome do evento PURCHASE_OUT_OF_SHOPPING_CART casa com o padrão de rastreio e viraria ebook "purchase")
    const buyer = data.buyer || {};
    const country = (buyer.address && (buyer.address.country_iso || buyer.address.country)) || buyer.country
      || (purchase.checkout_country && (purchase.checkout_country.iso || purchase.checkout_country.name))
      || (data.checkout_country && (data.checkout_country.iso || data.checkout_country.name)) || '';
    // moeda REAL da compra (ISO 4217: BRL, USD, EUR, CLP...) — vem do currency_value
    const curOf = function (o) { return String((o && (o.currency_value || o.currency_code || o.currency)) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); };
    let moeda = curOf(purchase.price) || curOf(purchase.full_price) || curOf(purchase.original_offer_price) || curOf(data) || 'BRL';
    if (moeda.length !== 3) moeda = 'BRL';

    // método de pagamento (pix/boleto/cartão...) — o payload manda em purchase.payment.type; entra no registro da venda e no vazamento do checkout
    const pmType = String((purchase.payment && purchase.payment.type) || (data.payment && data.payment.type) || '').toUpperCase();
    const pm = pmType.indexOf('PIX') >= 0 ? 'pix'
      : (pmType.indexOf('BILLET') >= 0 || pmType.indexOf('BOLETO') >= 0) ? 'boleto'
      : (pmType.indexOf('CARD') >= 0 || pmType.indexOf('CREDIT') >= 0) ? 'cartao'
      : pmType.indexOf('PAYPAL') >= 0 ? 'paypal'
      : (pmType ? slug(pmType) : '');

    // track = ebook_versao_canal_tema (ex.: arcturianos_br_luccas_deusdisse) — vem do 'src' (com off) OU do 'sck' (sem off)
    // (parse ANTES do gate de evento: o log de pendentes do checkout usa os mesmos campos)
    const parts = String(track).split('_');
    const ebook = slug(parts[0]) || '-';
    const versao = slug(parts[1]) || '-';
    const canalSo = slug(parts[2]) || 'direto';                            // canal sozinho (ex.: luccas)
    const tema = slug(parts[3]) || '-';                                    // nicho/tema (ex.: teste)
    const titulo = slug(parts[4]) || '';                                   // titulo da campanha/link (4o pedaco, opcional) — so aparece nas Vendas
    const canal = (parts.slice(2, 4).join('_').replace(/[^a-zA-Z0-9._-]/g, '')) || 'direto'; // combinado canal_tema (p/ o dashboard); o titulo NAO entra na chave agregada
    const pais = clean(country, 4).toUpperCase() || '??';
    const cents = Math.round((parseFloat(price) || 0) * 100);
    const date = new Date(Date.now() - 10800000).toISOString().slice(0, 10);   // data-chave em horário de Brasília (UTC-3), nao UTC
    const tx = String(purchase.transaction || data.transaction || '').trim();
    // dados do COMPRADOR + PRODUTO (usados nos pendentes E na venda aprovada — a jornada do lead cruza tudo pelo e-mail)
    const rz = String((purchase.payment && purchase.payment.refusal_reason) || '').replace(/[<>]/g, '').trim().slice(0, 100);
    const by = String((buyer && buyer.email) || '').toLowerCase().trim().slice(0, 80);
    const bn = String((buyer && buyer.name) || '').replace(/[<>]/g, '').trim().slice(0, 60);
    const ph = String((buyer && buyer.phone) || '').replace(/[^0-9+()\- ]/g, '').trim().slice(0, 24);
    const prodD = data.product || {};
    const pid = String(prodD.id || '').replace(/[^0-9]/g, '').slice(0, 20);
    const pnm = String(prodD.name || '').replace(/[<>]/g, '').trim().slice(0, 80);
    // identidade do PRODUTOR da conta que vendeu (junin OU theuzim): na conta do theuzim os papéis
    // PRODUCER/COPRODUCER se INVERTEM — o painel dos sócios usa o pr pra saber de quem é o vn e o vc
    const prName = slug((data.producer && data.producer.name) || '').slice(0, 30);
    // MAPA ebook->produto (pidmap): todo webhook RASTREADO ensina "qual pid é este ebook/versão".
    // O /api/lead usa pra carimbar pid/pnm nos leads dos popups (a automação de recuperação exige o produto em TODO lead).
    if (pid && ebook !== '-') {
      try {
        const pv = JSON.stringify({ pid: pid, pnm: pnm });
        const hargs = ['HSET', 'pidmap', ebook, pv];
        if (versao !== '-') hargs.push(ebook + ':' + versao, pv);   // versões (países) podem ser produtos Hotmart DIFERENTES
        await redis(hargs);
      } catch (e) {}
    }

    let sign = 0;
    if (/APPROV|APROVAD/.test(event)) sign = 1;                          // SO a aprovacao conta a venda
    else if (/REFUND|CHARGEBACK|REEMBOLS|ESTORN|DISPUTE|PROTEST/.test(event)) sign = -1; // SO reembolso/chargeback REAL
    // PURCHASE_COMPLETE = a MESMA venda mudando de status (fim da garantia) -> NAO conta de novo.
    if (!sign) {
      // VAZAMENTO DO CHECKOUT: aguardando pagamento (pix/boleto gerado), expirada e cancelada viram registro
      // SEPARADO (pendlog) — NUNCA tocam nos contadores de venda. Só chegam se os eventos estiverem marcados
      // no webhook do painel da Hotmart. Dedup próprio por (classe, transação).
      let pcls = '';
      if (/WAITING|PRINTED/.test(event)) pcls = 'wait';
      else if (/EXPIR/.test(event)) pcls = 'exp';
      else if (/CANCEL/.test(event) && /PURCHASE|COMPRA/.test(event)) pcls = 'can';   // só cancelamento de COMPRA (não de assinatura)
      else if (/OUT_OF_SHOPPING_CART|ABANDON/.test(event)) pcls = 'aband';   // ABANDONO de carrinho: preencheu o contato no checkout e saiu (a Hotmart só dispara se tiver e-mail; quem só abre a página não gera evento)
      if (pcls) {
        // espião: guarda o ÚLTIMO payload de CANCELAMENTO completo (7 dias) p/ investigar se o MOTIVO da recusa vem dentro — ler via GET ?raw=cancel
        if (pcls === 'can') { try { await redis(['SET', 'lastcancel', JSON.stringify(body).slice(0, 8000), 'EX', '604800']); } catch (e) {} }
        // (rz/by/bn/ph/pid/pnm já computados na zona compartilhada acima)
        // dedup: pela transação quando tem; abandono NÃO tem tx -> por comprador+dia (retry da Hotmart não duplica; abandono em OUTRO dia conta de novo)
        const pdk = tx ? ('pendk:' + pcls + ':' + tx) : (by ? ('pendk:' + pcls + ':' + by + ':' + date) : '');
        if (pdk) {
          const pk = await redis(['SET', pdk, '1', 'NX', 'EX', '15552000']);
          if (!pk || pk.result !== 'OK') { res.statusCode = 200; res.end(JSON.stringify({ ok: true, skip: 'pend-duplicado:' + (tx || by) })); return; }
        }
        await redis(['LPUSH', 'pendlog:' + date, JSON.stringify({ tx: tx, ev: pcls, pm: pm, rz: rz, by: by, bn: bn, ph: ph, pid: pid, pnm: pnm, e: ebook, vs: versao, c: canalSo, t: tema, p: pais, v: cents, cur: moeda, ts: Date.now() })]);
        await redis(['LTRIM', 'pendlog:' + date, '0', '999']);
        res.statusCode = 200; res.end(JSON.stringify({ ok: true, pend: pcls })); return;
      }
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, skip: event || '?' })); return;
    }

    // ANTI-DUPLICACAO: a mesma transacao NUNCA conta 2x (reenvio/retry da Hotmart, eventos repetidos)
    if (tx) {
      const dk = (sign > 0 ? 'txok:' : 'txref:') + tx;
      const dr = await redis(['SET', dk, '1', 'NX', 'EX', '15552000']);   // 180 dias
      if (!dr || dr.result !== 'OK') { res.statusCode = 200; res.end(JSON.stringify({ ok: true, skip: 'duplicado:' + tx })); return; }
    }
    const baseK = [ebook, versao, canal, pais].join('|');
    await redis(['HINCRBY', 'sales:' + date, baseK + '|n', sign]);               // contagem líquida (compat)
    await redis(['HINCRBY', 'sales:' + date, baseK + '|r|' + moeda, sign * cents]); // receita líquida por moeda (compat)
    if (sign > 0) {
      await redis(['HINCRBY', 'sales:' + date, baseK + '|na', 1]);                // contagem só de APROVADAS (estorno nao desconta)
      await redis(['HINCRBY', 'sales:' + date, baseK + '|ra|' + moeda, cents]);   // receita só de APROVADAS por moeda
    }
    // LÍQUIDO: no payload (data.commissions) a Hotmart JÁ divide entre os sócios —
    //   PRODUCER   = parte do dono da conta (junin)   -> vn/cn
    //   COPRODUCER = parte do coprodutor (theuzim/COIMBRA MKT) -> vc/cc
    // CUIDADO: 'COPRODUCER' contém a palavra PRODUCER -> comparação EXATA por ===.
    let vnCents = 0, curN = '', vcCents = 0, curC = '', vaCents = 0, curA = '';
    const comms = (data.commissions && Array.isArray(data.commissions)) ? data.commissions : [];
    const cops = [];   // pode haver MAIS DE UM coprodutor (ex.: rede3 = sócio + dono da rede como "afiliado de página")
    for (let ci = 0; ci < comms.length; ci++) {
      const srcC = String((comms[ci] && comms[ci].source) || '').toUpperCase().trim();
      const valC = Math.round((parseFloat(comms[ci] && comms[ci].value) || 0) * 100);
      const monC = String((comms[ci] && (comms[ci].currency_value || comms[ci].currency_code)) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || moeda;
      if (srcC === 'PRODUCER') { vnCents = valC; curN = monC; }
      else if (srcC === 'COPRODUCER') { cops.push({ v: valC, m: monC }); }
      else if (srcC === 'AFFILIATE') { vaCents += valC; if (!curA) curA = monC; }   // afiliado oficial da Hotmart -> comissão de rede
    }
    // sócio = o MAIOR coprodutor (a metade do junin/theuzim é sempre maior que o corte da rede);
    // os DEMAIS coprodutores são donos de rede ("afiliados de página") -> somam na comissão de rede (va)
    cops.sort(function (a, b) { return b.v - a.v; });
    if (cops.length) { vcCents = cops[0].v; curC = cops[0].m; }
    for (let ck = 1; ck < cops.length; ck++) { vaCents += cops[ck].v; if (!curA) curA = cops[ck].m; }
    // registro individual (p/ a lista de Vendas), no máximo 1000 por dia
    const rec = JSON.stringify({ tx: tx, st: sign > 0 ? 'aprovada' : 'estorno', v: cents, cur: moeda, vn: vnCents, cn: curN, vc: vcCents, cc: curC, va: vaCents, ca: curA, pr: prName, e: ebook, vs: versao, c: canalSo, t: tema, tit: titulo, ws: (slug(sckStage) || 'principal'), vid: slug(vidRaw), p: pais, pm: pm, by: by, bn: bn, ts: Date.now() });
    await redis(['LPUSH', 'salelog:' + date, rec]);
    await redis(['LTRIM', 'salelog:' + date, '0', '999']);
    res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false })); }
};
