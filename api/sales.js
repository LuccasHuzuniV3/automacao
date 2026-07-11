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
    const fTrk = (q.track === 'sim' || q.track === 'nao') ? q.track : '';   // rastreio: ''=todas | sim=só rastreadas | nao=só NÃO rastreadas (regra igual ao /api/stats: sem rastreio = ebook '-')

    // datas em horário de BRASÍLIA (UTC-3): from/to (YYYY-MM-DD, dias BR) tem prioridade; senão, janela de N dias BR.
    function brDate(ms) { return new Date(ms - 10800000).toISOString().slice(0, 10); }   // dia-BR de um timestamp (UTC-3)
    const reDt = /^\d{4}-\d{2}-\d{2}$/, dates = [];
    let from = String(q.from || ''), to = String(q.to || '');
    if (reDt.test(from) && reDt.test(to)) {
      if (from > to) { const tmp = from; from = to; to = tmp; }
      let cur = new Date(to + 'T00:00:00Z'); const end = new Date(from + 'T00:00:00Z'); let guard = 0;
      while (cur >= end && guard < 400) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() - 86400000); guard++; }
    } else {
      for (let i = 0; i < days; i++) dates.push(brDate(Date.now() - i * 86400000));   // dias-BR, mais novo primeiro
    }
    // agrupa cada venda pelo DIA-BR do seu ts exato (corrige o histórico gravado em UTC). LÊ 1 dia extra à frente pq
    // a venda da NOITE-BR fica gravada no salelog do dia UTC seguinte -> precisa buscar pra reagrupar certo.
    const winSet = {}; dates.forEach(d => winSet[d] = 1);
    const readKeys = dates.slice();
    if (dates.length) { const buf = new Date(new Date(dates[0] + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); if (readKeys.indexOf(buf) < 0) readKeys.unshift(buf); }
    const results = await Promise.all(readKeys.map(dt => redis(['LRANGE', 'salelog:' + dt, '0', '-1']).catch(() => ({ result: [] }))));
    const resultsP = await Promise.all(readKeys.map(dt => redis(['LRANGE', 'pendlog:' + dt, '0', '-1']).catch(() => ({ result: [] }))));   // vazamento do checkout (aguardando/expirada/cancelada)

    const list = []; const byDay = {};
    results.forEach(day => {
      (day && day.result || []).forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (fE && o.e !== fE) return;
        if (fC && o.c !== fC) return;
        if (fT && o.t !== fT) return;
        if (fP && o.p !== fP) return;
        if (fW && (o.ws || 'principal') !== fW) return;   // filtro por etapa do funil (venda antiga sem ws = principal)
        const untr = ((o.e || '-') === '-');
        if (fTrk === 'sim' && untr) return;               // só rastreadas
        if (fTrk === 'nao' && !untr) return;              // só NÃO rastreadas
        const bd = brDate(o.ts || 0);
        if (!winSet[bd]) return;                          // fora da janela BR (ex.: venda de amanhã que veio no buffer)
        list.push(o);
        const sg = o.st === 'estorno' ? -1 : 1, cur = (o.cur || 'BRL');
        if (!byDay[bd]) byDay[bd] = { vd: 0, r: {} };
        byDay[bd].vd += sg; byDay[bd].r[cur] = (byDay[bd].r[cur] || 0) + sg * (o.v || 0);
      });
    });
    const serie = dates.map(d => { const dd = byDay[d] || { vd: 0, r: {} }; const rr = {}; Object.keys(dd.r).forEach(c => { rr[c] = dd.r[c] / 100; }); return { d: d, vd: dd.vd, r: rr }; });
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
    // VAZAMENTO DO CHECKOUT: agrega o pendlog com os MESMOS filtros (o registro pendente não tem ws/funil)
    const ck = { wait: 0, exp: 0, can: 0, aband: 0, m: {}, pagos: {}, list: [] };
    resultsP.forEach(day => {
      (day && day.result || []).forEach(s => {
        let o; try { o = JSON.parse(s); } catch (e) { return; }
        if (fE && o.e !== fE) return;
        if (fC && o.c !== fC) return;
        if (fT && o.t !== fT) return;
        if (fP && o.p !== fP) return;
        const untrP = ((o.e || '-') === '-');
        if (fTrk === 'sim' && untrP) return;              // rastreio também vale pro checkout (pendentes)
        if (fTrk === 'nao' && !untrP) return;
        const bd = brDate(o.ts || 0);
        if (!winSet[bd]) return;
        if (o.ev === 'aband') {   // abandono: sem método de pagamento (não entra no mapa por método) — só conta + vai pra lista (nome/e-mail/telefone/produto p/ recuperação)
          ck.aband++;
          if (ck.list.length < 500) ck.list.push({ ev: 'aband', pm: '', rz: '', by: o.by || '', bn: o.bn || '', ph: o.ph || '', pid: o.pid || '', pnm: o.pnm || '', p: o.p || '', v: 0, cur: o.cur || 'BRL', e: o.e || '-', ts: o.ts || 0 });
          return;
        }
        if (o.ev === 'wait') ck.wait++; else if (o.ev === 'exp') ck.exp++; else if (o.ev === 'can') ck.can++; else return;
        const k = o.pm || '?'; if (!ck.m[k]) ck.m[k] = { w: 0, x: 0, c: 0 };
        if (o.ev === 'wait') ck.m[k].w++; else if (o.ev === 'exp') ck.m[k].x++; else ck.m[k].c++;
        if (ck.list.length < 500) ck.list.push({ ev: o.ev, pm: k, rz: o.rz || '', by: o.by || '', bn: o.bn || '', ph: o.ph || '', pid: o.pid || '', pnm: o.pnm || '', p: o.p || '', v: o.v || 0, cur: o.cur || 'BRL', e: o.e || '-', ts: o.ts || 0 });   // registros p/ o drill-down (motivos, país, comprador nome+email+telefone, produto)
      });
    });
    list.forEach(o => { if (o.pm && o.st !== 'estorno') ck.pagos[o.pm] = (ck.pagos[o.pm] || 0) + 1; });   // pagos por método (só as vendas novas carregam pm)
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, vendas: totV, receita: totRcents / 100, receitas: receitas, serie: serie, ranks: ranks, list: list.slice(0, 5000), checkout: ck,
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
