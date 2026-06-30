/* =====================================================================
   /api/sales  —  lista as VENDAS individuais (registros gravados pelo
   /api/hotmart). Filtra por ebook / canal / nicho(tema) / país / período.
   Devolve a lista (mais nova primeiro) + totais. Sem dependências.
   ===================================================================== */
const { parse } = require('url');
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
const VIEW = process.env.VIEW_TOKEN || '';   // se definido, exige ?token= (protege o painel do "cara")
async function redis(cmd) { const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return r.json(); }

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }
    const q = parse(req.url, true).query || {};
    if (VIEW && String(q.token || '') !== String(VIEW)) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, auth: true, error: 'token' })); return; }
    const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 365);
    const fE = q.ebook || '', fC = q.canal || '', fT = q.tema || '', fP = q.pais || '', fW = q.ws || q.funil || '';

    // datas (UTC): intervalo DE/ATÉ (from/to = YYYY-MM-DD) tem prioridade; senão, janela de N dias.
    const reDt = /^\d{4}-\d{2}-\d{2}$/, dates = [];
    let from = String(q.from || ''), to = String(q.to || '');
    if (reDt.test(from) && reDt.test(to)) {
      if (from > to) { const tmp = from; from = to; to = tmp; }
      let cur = new Date(to + 'T00:00:00Z'); const end = new Date(from + 'T00:00:00Z'); let guard = 0;
      while (cur >= end && guard < 400) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() - 86400000); guard++; }
    } else {
      const base = Date.now();
      for (let i = 0; i < days; i++) dates.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
    }
    const results = await Promise.all(dates.map(dt => redis(['LRANGE', 'salelog:' + dt, '0', '-1']).catch(() => ({ result: [] }))));

    const list = [], serie = [];
    results.forEach((day, idx) => {                          // results[idx] <-> dates[idx] (mais novo primeiro)
      let dVd = 0; const dR = {};
      (day && day.result || []).forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (fE && o.e !== fE) return;
        if (fC && o.c !== fC) return;
        if (fT && o.t !== fT) return;
        if (fP && o.p !== fP) return;
        if (fW && (o.ws || 'principal') !== fW) return;   // filtro por etapa do funil (venda antiga sem ws = principal)
        list.push(o);
        const sg = o.st === 'estorno' ? -1 : 1, cur = (o.cur || 'BRL');
        dVd += sg; dR[cur] = (dR[cur] || 0) + sg * (o.v || 0);  // vendas + receita do DIA (respeita os mesmos filtros)
      });
      const rr = {}; Object.keys(dR).forEach(c => { rr[c] = dR[c] / 100; });
      serie.push({ d: dates[idx], vd: dVd, r: rr });
    });
    serie.reverse();                                          // mais antigo -> mais novo (p/ o gráfico)
    list.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    let totV = 0, totRcents = 0; const canais = {}, temas = {}, ebooks = {}, paises = {}, funis = {}, receitasCents = {};
    list.forEach(o => {
      const sg = o.st === 'estorno' ? -1 : 1, cur = (o.cur || 'BRL');
      totV += sg; totRcents += sg * (o.v || 0); receitasCents[cur] = (receitasCents[cur] || 0) + sg * (o.v || 0);
      if (o.c) canais[o.c] = 1; if (o.t) temas[o.t] = 1; if (o.e) ebooks[o.e] = 1; if (o.p) paises[o.p] = 1; funis[(o.ws || 'principal')] = 1;
    });
    const receitas = {}; Object.keys(receitasCents).forEach(c => { receitas[c] = receitasCents[c] / 100; });
    const ranks = rankSales(list);   // rankings (pais / src / ebook) sobre as vendas JÁ filtradas (respeita os filtros)
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, vendas: totV, receita: totRcents / 100, receitas: receitas, serie: serie, ranks: ranks, list: list.slice(0, 5000),
      filtros: { ebooks: Object.keys(ebooks), canais: Object.keys(canais), temas: Object.keys(temas), paises: Object.keys(paises), funis: Object.keys(funis) } }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 150) })); }
};

// rankings de vendas (puro/testável): agrupa por país / src(vídeo) / ebook, soma vendas líquidas + receita por moeda,
// filtra só os com venda > 0, ordena do que mais vende e pega o top 12. Valores em CENTAVOS viram unidade (/100).
function rankSales(list) {
  const P = {}, S = {}, E = {};
  function bump(m, k, sg, cur, val) { if (k == null || k === '') k = '-'; if (!m[k]) m[k] = { vd: 0, r: {} }; m[k].vd += sg; m[k].r[cur] = (m[k].r[cur] || 0) + sg * val; }
  (list || []).forEach(function (o) { const sg = o.st === 'estorno' ? -1 : 1, cur = (o.cur || 'BRL'), v = o.v || 0; bump(P, o.p, sg, cur, v); bump(S, o.vid, sg, cur, v); bump(E, o.e, sg, cur, v); });
  function cents(rc) { const o = {}; Object.keys(rc).forEach(function (c) { o[c] = rc[c] / 100; }); return o; }
  function top(m) { return Object.keys(m).map(function (k) { return { k: k, vd: m[k].vd, r: cents(m[k].r) }; }).filter(function (x) { return x.vd > 0; }).sort(function (a, b) { return b.vd - a.vd; }).slice(0, 12); }
  return { pais: top(P), src: top(S), ebook: top(E) };
}
module.exports.rankSales = rankSales;
