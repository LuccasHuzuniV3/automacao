/* =====================================================================
   /api/gastos  —  DESPESAS com anúncios lançadas à mão no painel Vendas
   (botão 💸 Despesas). Guardadas no Redis por DIA:
     - HASH  gastos            campo = YYYY-MM-DD, valor = total em CENTAVOS
     - LIST  gastoslog         últimos 500 lançamentos {id,d,v,ts} (p/ listar/apagar)
   GET  ?days=N | ?from=YYYY-MM-DD&to=YYYY-MM-DD [&token]  -> {ok,total,dias,list}
   POST body {d:'YYYY-MM-DD', v:centavos} [?token]         -> lança
   POST body {del:'id'} [?token]                           -> remove (desfaz no hash)
   Sem dependências: só fetch + a REST API do Redis (igual /api/sales).
   ===================================================================== */
const { parse } = require('url');
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
const VIEW = process.env.VIEW_TOKEN || '';   // se definido, exige ?token= (mesma trava do /api/sales)
async function redis(cmd) { const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return r.json(); }
const reDt = /^\d{4}-\d{2}-\d{2}$/;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = (typeof req.body === 'string') ? req.body : '';
  if (!raw) await new Promise(function (done) { req.on('data', function (c) { raw += c; }); req.on('end', done); req.on('error', done); });
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }
    const q = parse(req.url, true).query || {};
    if (VIEW && String(q.token || '') !== String(VIEW)) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, auth: true, error: 'token' })); return; }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body && body.del) {   // remover lançamento: tira do log e DESFAZ no total do dia
        const rows = (await redis(['LRANGE', 'gastoslog', '0', '499'])).result || [];
        for (let i = 0; i < rows.length; i++) {
          let o; try { o = JSON.parse(rows[i]); } catch (e) { continue; }
          if (String(o.id) === String(body.del)) {
            await redis(['LREM', 'gastoslog', '1', rows[i]]);
            await redis(['HINCRBY', 'gastos', o.d, String(-(o.v || 0))]);
            res.statusCode = 200; res.end(JSON.stringify({ ok: true, removed: o })); return;
          }
        }
        res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'lançamento não encontrado' })); return;
      }
      const d = String((body && body.d) || ''), v = Math.round(Number(body && body.v) || 0);
      const n = String((body && body.n) || '').replace(/[<>]/g, '').trim().slice(0, 60);   // descrição opcional (ex.: "Meta Ads")
      if (!reDt.test(d)) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'data inválida (YYYY-MM-DD)' })); return; }
      if (!(v > 0 && v < 1e11)) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'valor inválido (centavos > 0)' })); return; }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await redis(['HINCRBY', 'gastos', d, String(v)]);
      await redis(['LPUSH', 'gastoslog', JSON.stringify({ id: id, d: d, v: v, n: n, ts: Date.now() })]);
      await redis(['LTRIM', 'gastoslog', '0', '499']);
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, id: id })); return;
    }

    // GET — janela de dias em horário de BRASÍLIA (mesmo padrão do /api/sales)
    const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 365);
    function brDate(ms) { return new Date(ms - 10800000).toISOString().slice(0, 10); }
    const dates = [];
    let from = String(q.from || ''), to = String(q.to || '');
    if (reDt.test(from) && reDt.test(to)) {
      if (from > to) { const tmp = from; from = to; to = tmp; }
      let cur = new Date(to + 'T00:00:00Z'); const end = new Date(from + 'T00:00:00Z'); let guard = 0;
      while (cur >= end && guard < 400) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() - 86400000); guard++; }
    } else {
      for (let i = 0; i < days; i++) dates.push(brDate(Date.now() - i * 86400000));
    }
    const winSet = {}; dates.forEach(d => winSet[d] = 1);

    const hall = (await redis(['HGETALL', 'gastos'])).result || [];   // REST devolve array plano [campo, valor, ...]
    let total = 0; const dias = {};
    for (let i = 0; i + 1 < hall.length; i += 2) {
      const dt = hall[i], v = parseInt(hall[i + 1], 10) || 0;
      if (winSet[dt]) { dias[dt] = v; total += v; }
    }
    const rowsRaw = (await redis(['LRANGE', 'gastoslog', '0', '199'])).result || [];
    const list = [];
    rowsRaw.forEach(s => { try { const o = JSON.parse(s); if (winSet[o.d]) list.push(o); } catch (e) {} });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, total: Math.max(0, total), dias: dias, list: list }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 150) })); }
};
