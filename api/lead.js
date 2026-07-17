/* =====================================================================
   /api/lead  —  LEADS capturados pelos popups da página de vendas
   (Popup de SAÍDA = origem "exit_intent" | Popup do EU QUERO = "eu_quero").
   Grava no NOSSO Redis — a automação de recuperação (externa) LÊ daqui:
     - LIST leadlog                 últimos 5000 leads {em,org,pid,pnm,lang,ok,e,vs,c,p,ts}
     - dedup leadk:<org>:<em>:<dia> mesmo lead na mesma origem no mesmo dia não duplica
   POST body {em,org,pid,pnm,lang,ok,e,vs,c,p}  -> grava (e-mail minúsculo)
   GET  [?token=]                               -> {ok,list} (p/ a automação/painel)
   Sem chave de terceiros: o banco é nosso. Payload do front vai sem
   Content-Type (simple request) -> sem preflight CORS.
   ===================================================================== */
const { parse } = require('url');
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
const VIEW = process.env.VIEW_TOKEN || '';   // se definido, o GET exige ?token= (o POST é público: é a página de vendas capturando)
async function redis(cmd) { const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return r.json(); }
const ORGS = { exit_intent: 1, eu_quero: 1 };   // whitelist da origem — é ela que separa lead frio/quente na automação

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = (typeof req.body === 'string') ? req.body : '';
  if (!raw) await new Promise(function (done) { req.on('data', function (c) { raw += c; }); req.on('end', done); req.on('error', done); });
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}
function clean(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max || 80); }
function slugE(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 40); }   // mesmo slug do webhook: "jesusdiz3-rede3" -> "jesusdiz3rede3" (chaves do pidmap casam)

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }

    if (req.method === 'POST') {
      const b = await readBody(req);
      const em = String((b && b.em) || '').toLowerCase().trim().slice(0, 80);
      const org = String((b && b.org) || '');
      if (!/.+@.+\..+/.test(em)) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'e-mail inválido' })); return; }
      if (!ORGS[org]) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'origem inválida' })); return; }
      const date = new Date(Date.now() - 10800000).toISOString().slice(0, 10);   // dia em horário de Brasília (mesmo padrão do resto)
      const dk = await redis(['SET', 'leadk:' + org + ':' + em + ':' + date, '1', 'NX', 'EX', '172800']);
      if (!dk || dk.result !== 'OK') { res.statusCode = 200; res.end(JSON.stringify({ ok: true, skip: 'lead-duplicado' })); return; }
      const rec = {
        em: em, org: org,
        pid: clean(b.pid, 20), pnm: clean(b.pnm, 80), lang: clean(b.lang, 8),
        ok: !!b.ok,
        e: slugE(b.e), vs: clean(b.vs, 8), c: clean(b.c, 40), p: clean(b.p, 4),
        ts: Date.now()
      };
      // PRODUTO EM TODO LEAD (pedido da automação): sem pid -> carimba do MAPA pidmap (aprendido dos
      // webhooks pelo api/hotmart.js); com pid (META do builder) -> ENSINA o mapa pros próximos.
      try {
        if (rec.e && !rec.pid) {
          let m = null;
          if (rec.vs) { const r1 = await redis(['HGET', 'pidmap', rec.e + ':' + rec.vs]); m = r1 && r1.result; }
          if (!m) { const r2 = await redis(['HGET', 'pidmap', rec.e]); m = r2 && r2.result; }
          if (m) { const o = JSON.parse(m); if (o.pid) rec.pid = String(o.pid).slice(0, 20); if (!rec.pnm && o.pnm) rec.pnm = String(o.pnm).slice(0, 80); }
        } else if (rec.e && rec.pid) {
          const pv = JSON.stringify({ pid: rec.pid, pnm: rec.pnm });
          const hargs = ['HSET', 'pidmap', rec.e, pv];
          if (rec.vs) hargs.push(rec.e + ':' + rec.vs, pv);
          await redis(hargs);
        }
      } catch (e) {}
      await redis(['LPUSH', 'leadlog', JSON.stringify(rec)]);
      await redis(['LTRIM', 'leadlog', '0', '4999']);
      res.statusCode = 200; res.end(JSON.stringify({ ok: true })); return;
    }

    // GET — a automação externa (e o painel) leem daqui
    const q = parse(req.url, true).query || {};
    if (VIEW && String(q.token || '') !== String(VIEW)) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, auth: true, error: 'token' })); return; }

    if (q.pidmap === '1') {
      // CATÁLOGO APRENDIDO: devolve o mapa ebook[:versao] -> {pid,pnm} que os webhooks/leads ensinaram.
      // A automação consulta aqui os IDs de produto (ex.: linha zodíaco) em vez de pedir manualmente.
      const cat = {};
      try {
        const pr = (await redis(['HGETALL', 'pidmap'])).result;
        if (Array.isArray(pr)) { for (let i = 0; i + 1 < pr.length; i += 2) { try { cat[pr[i]] = JSON.parse(pr[i + 1]); } catch (e) {} } }
        else if (pr && typeof pr === 'object') { Object.keys(pr).forEach(k => { try { cat[k] = JSON.parse(pr[k]); } catch (e) {} }); }
      } catch (e) {}
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, pidmap: true, total: Object.keys(cat).length, map: cat })); return;
    }

    if (q.journey === '1') {
      // JORNADA DA RECUPERAÇÃO: cruza leads (popups) + checkout (pendlog) + vendas (salelog) pelo E-MAIL e
      // devolve cada pessoa JÁ CLASSIFICADA no evento certo — a automação consome UMA lista e sabe o que disparar:
      //   comprou (EXCLUIR!) > recusado_saldo_insuficiente > recusado_nao_autorizado > recusado_antifraude >
      //   recusado_outro > pix_boleto_nao_pago > aguardando_pagamento > abandonou_checkout >
      //   clicou_comprar_e_sumiu > so_deu_email_na_saida
      const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 90);
      function brDate(ms) { return new Date(ms - 10800000).toISOString().slice(0, 10); }
      const dates = []; for (let i = 0; i < days; i++) dates.push(brDate(Date.now() - i * 86400000));
      const corte = Date.now() - days * 86400000;
      const leadsRaw = (await redis(['LRANGE', 'leadlog', '0', '1999'])).result || [];
      const pendRes = await Promise.all(dates.map(dt => redis(['LRANGE', 'pendlog:' + dt, '0', '-1']).catch(() => ({ result: [] }))));
      const saleRes = await Promise.all(dates.map(dt => redis(['LRANGE', 'salelog:' + dt, '0', '-1']).catch(() => ({ result: [] }))));
      const M = {};
      function noDe(em) { if (!M[em]) M[em] = { em: em, ts: 0 }; return M[em]; }
      leadsRaw.forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (!o.em || (o.ts || 0) < corte) return; const nd = noDe(o.em);
        nd.lead = true; if (o.org === 'eu_quero') nd.leadQuero = true; else nd.leadExit = true;
        ['pid', 'pnm', 'lang', 'e', 'p', 'vs'].forEach(k => { if (o[k] && !nd[k]) nd[k] = o[k]; });
        if ((o.ts || 0) > nd.ts) nd.ts = o.ts;
      });
      pendRes.forEach(day => (day && day.result || []).forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (!o.by || (o.ts || 0) < corte) return; const nd = noDe(o.by);
        if (o.ev === 'aband') nd.aband = true;
        else if (o.ev === 'wait') nd.wait = true;
        else if (o.ev === 'exp') nd.exp = true;
        else if (o.ev === 'can') { nd.can = true; if (o.rz) nd.motivo = o.rz; }
        if (o.bn && !nd.bn) nd.bn = o.bn; if (o.ph && !nd.ph) nd.ph = o.ph;
        if (o.pnm && !nd.pnm) nd.pnm = o.pnm; if (o.pid && !nd.pid) nd.pid = o.pid;
        if (o.p && !nd.p) nd.p = o.p; if (o.e && o.e !== '-' && !nd.e) nd.e = o.e;
        if (o.vs && o.vs !== '-' && !nd.vs) nd.vs = o.vs;
        if ((o.ts || 0) > nd.ts) nd.ts = o.ts;
      }));
      saleRes.forEach(day => (day && day.result || []).forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (!o.by || o.st !== 'aprovada' || (o.ts || 0) < corte) return; const nd = noDe(o.by);
        nd.sale = true; if (o.bn && !nd.bn) nd.bn = o.bn;
        if ((o.ts || 0) > nd.ts) nd.ts = o.ts;
      }));
      // backfill RETROATIVO do produto: lead antigo sem pid ganha pid/pnm do MAPA pidmap na LEITURA
      // (o mapa é alimentado pelos webhooks e pelos leads com META — 1 HGETALL cobre a lista toda)
      const PMAP = {};
      try {
        const pmr = (await redis(['HGETALL', 'pidmap'])).result;
        if (Array.isArray(pmr)) { for (let i = 0; i + 1 < pmr.length; i += 2) PMAP[pmr[i]] = pmr[i + 1]; }
        else if (pmr && typeof pmr === 'object') { Object.keys(pmr).forEach(k => { PMAP[k] = pmr[k]; }); }
      } catch (e) {}
      Object.keys(M).forEach(em => {
        const nd = M[em];
        if (nd.pid || !nd.e) return;
        const eKey = slugE(nd.e);   // lead ANTIGO pode ter sido gravado com hífen -> normaliza no lookup
        const raw = PMAP[eKey + ':' + (nd.vs || '')] || PMAP[eKey];
        if (!raw) return;
        try { const o = JSON.parse(raw); if (o.pid) nd.pid = String(o.pid); if (!nd.pnm && o.pnm) nd.pnm = String(o.pnm); } catch (e) {}
      });
      function estagio(nd) {
        if (nd.sale) return 'comprou';
        if (nd.can) {
          const rzl = String(nd.motivo || '').toLowerCase();
          if (/insufficient|saldo/.test(rzl)) return 'recusado_saldo_insuficiente';
          if (/fraud/.test(rzl)) return 'recusado_antifraude';
          if (/refus|not authorized|denied|não autorizada|nao autorizada/.test(rzl)) return 'recusado_nao_autorizado';
          return 'recusado_outro';
        }
        if (nd.exp) return 'pix_boleto_nao_pago';
        if (nd.wait) return 'aguardando_pagamento';
        if (nd.aband) return 'abandonou_checkout';
        if (nd.leadQuero) return 'clicou_comprar_e_sumiu';
        if (nd.leadExit) return 'so_deu_email_na_saida';
        return 'contato';
      }
      const lista = Object.keys(M).map(em => {
        const nd = M[em];
        return { em: em, bn: nd.bn || '', ph: nd.ph || '', estagio: estagio(nd), motivo: nd.motivo || '', pid: nd.pid || '', pnm: nd.pnm || '', e: nd.e || '', p: nd.p || '', lang: nd.lang || '', ts: nd.ts };
      }).sort((a, b) => b.ts - a.ts);
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, journey: true, dias: days, list: lista })); return;
    }

    const n = Math.min(Math.max(parseInt(q.n || '1000', 10) || 1000, 1), 5000);
    const raw = (await redis(['LRANGE', 'leadlog', '0', String(n - 1)])).result || [];
    const list = [];
    raw.forEach(s => { try { list.push(JSON.parse(s)); } catch (e) {} });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, list: list }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 150) })); }
};
