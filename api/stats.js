/* =====================================================================
   /api/stats  —  leitura (self-hosted). Lê os contadores do Redis no
   período pedido, filtra (ebook/versão/rede) e soma por país real,
   canal ou versão. Devolve o funil (acessos, cliques) + as linhas.
   CORS aberto p/ o painel local conseguir ler. Sem dependências.
   ===================================================================== */
const { parse } = require('url');
// acha a credencial do Redis em QUALQUER prefixo (KV_*, UPSTASH_*, STORAGE_*, etc.)
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
const VIEW = process.env.VIEW_TOKEN || '';   // se definido, exige ?token= (protege o painel do "cara")

async function redis(cmd) {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  return r.json();
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store — crie o banco na Vercel' })); return; }
    const q = parse(req.url, true).query || {};
    if (VIEW && String(q.token || '') !== String(VIEW)) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, auth: true, error: 'token' })); return; }
    const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 365);
    const offset = Math.min(Math.max(parseInt(q.offset || '0', 10) || 0, 0), 3650); // p/ comparar c/ período anterior
    const fEbook = q.ebook || '', fVersao = q.versao || '', fRede = q.rede || '';
    const fTrack = (q.track === 'nao' || q.track === 'all') ? q.track : 'sim';   // 'sim'=só rastreadas (padrão) | 'nao'=só NÃO rastreadas | 'all'=todas
    const verPor = ['pais', 'canal', 'versao', 'dispositivo'].indexOf(q.verPor) >= 0 ? q.verPor : 'pais';

    // datas (UTC): intervalo DE/ATÉ (from/to = YYYY-MM-DD) tem prioridade; senão, janela de N dias recuada por 'offset'.
    const reDt = /^\d{4}-\d{2}-\d{2}$/, dates = [];
    let from = String(q.from || ''), to = String(q.to || '');
    if (reDt.test(from) && reDt.test(to)) {
      if (from > to) { const tmp = from; from = to; to = tmp; }
      let cur = new Date(to + 'T00:00:00Z'); const end = new Date(from + 'T00:00:00Z'); let guard = 0;
      while (cur >= end && guard < 400) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() - 86400000); guard++; }   // mais novo -> mais antigo (mesma ordem da janela de dias)
    } else {
      const base = Date.now();
      for (let i = 0; i < days; i++) dates.push(new Date(base - (i + offset) * 86400000).toISOString().slice(0, 10));
    }

    // lê os hashes dos dias em paralelo
    const results = await Promise.all(dates.map(dt => redis(['HGETALL', 'stats:' + dt]).catch(() => ({ result: [] }))));

    let totView = 0, totClick = 0; const serie = [];
    const aggs = { pais: {}, canal: {}, versao: {}, dispositivo: {} };
    function bump(map, key, type, cnt) { if (!map[key]) map[key] = { ac: 0, cl: 0 }; if (type === 'view') map[key].ac += cnt; else if (type === 'click') map[key].cl += cnt; }
    results.forEach((day, idx) => {                        // results[idx] <-> dates[idx] (mais novo primeiro)
      let dac = 0, dcl = 0;
      const flat = (day && day.result) || [];
      for (let i = 0; i < flat.length; i += 2) {
        const field = flat[i], cnt = parseInt(flat[i + 1], 10) || 0;
        const p = String(field).split('|');               // ebook|versao|rede|pais|[device]|type
        const ebook = p[0], versao = p[1], rede = p[2], pais = p[3];
        const type = p[p.length - 1];                      // type sempre por ULTIMO
        const dev = p.length >= 6 ? p[p.length - 2] : '?'; // device so existe no formato novo
        if (fEbook && ebook !== fEbook) continue;
        if (fVersao && versao !== fVersao) continue;
        if (fRede && rede !== fRede) continue;
        if (type === 'view') { totView += cnt; dac += cnt; } else if (type === 'click') { totClick += cnt; dcl += cnt; }
        bump(aggs.pais, pais, type, cnt);
        bump(aggs.canal, rede, type, cnt);
        bump(aggs.versao, versao, type, cnt);
        bump(aggs.dispositivo, dev, type, cnt);
      }
      serie.push({ d: dates[idx], ac: dac, cl: dcl });
    });
    serie.reverse();                                       // mais antigo -> mais novo (p/ o grafico)

    // ---- VENDAS (Hotmart, gravadas pelo /api/hotmart) ----
    const salesRes = await Promise.all(dates.map(dt => redis(['HGETALL', 'sales:' + dt]).catch(() => ({ result: [] }))));
    let totVendas = 0, totReceitaCents = 0;
    const vAgg = { pais: {}, canal: {}, versao: {} };
    const receitasCents = {};                              // receita por moeda (BRL, USD, CLP...)
    salesRes.forEach(day => {
      const flat = (day && day.result) || [];
      for (let i = 0; i < flat.length; i += 2) {
        const field = flat[i], val = parseInt(flat[i + 1], 10) || 0;
        const p = String(field).split('|');                // ebook|versao|canal|pais|type(n|na|r)|[moeda]
        const ebook = p[0], versao = p[1], canal = p[2], pais = p[3], type = p[4];
        const untracked = (ebook === '-');                                       // venda SEM rastreio (outro produto da conta Hotmart)
        if (fTrack === 'sim' && untracked) continue;
        if (fTrack === 'nao' && !untracked) continue;
        if (fEbook && ebook !== fEbook) continue;
        if (fVersao && versao !== fVersao) continue;
        if (fRede && canal !== fRede) continue;
        if (type === 'na') { totVendas += val; vAgg.pais[pais] = (vAgg.pais[pais] || 0) + val; vAgg.canal[canal] = (vAgg.canal[canal] || 0) + val; vAgg.versao[versao] = (vAgg.versao[versao] || 0) + val; } // só APROVADAS
        else if (type === 'ra') { const cur = (p[5] || 'BRL'); totReceitaCents += val; receitasCents[cur] = (receitasCents[cur] || 0) + val; } // receita só de APROVADAS
      }
    });
    const receitas = {}; Object.keys(receitasCents).forEach(c => { receitas[c] = receitasCents[c] / 100; });

    function toRows(map, vmap) { return Object.keys(map).map(k => ({ p: k, ac: map[k].ac, cl: map[k].cl, vd: (vmap && vmap[k]) || 0 })).sort((a, b) => b.ac - a.ac).slice(0, 8); }
    const breakdowns = { pais: toRows(aggs.pais, vAgg.pais), canal: toRows(aggs.canal, vAgg.canal), versao: toRows(aggs.versao, vAgg.versao), dispositivo: toRows(aggs.dispositivo, null) };
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, acessos: totView, cliques: totClick, vendas: totVendas, receita: totReceitaCents / 100, receitas: receitas, serie: serie, breakdowns: breakdowns, days: dates.length }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 200) })); }
};
