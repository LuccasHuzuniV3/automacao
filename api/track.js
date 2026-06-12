/* =====================================================================
   /api/track  —  coleta (self-hosted, sem Google).
   A página publicada dá um "ping" aqui a cada ACESSO e a cada CLIQUE no
   botão de comprar. Guardamos um contador por dia no Redis (Vercel KV /
   Upstash), com país REAL vindo de graça do header da Vercel.
   Sem dependências: só fetch (Node 18+) + a REST API do Redis.
   ===================================================================== */
const { parse } = require('url');
// acha a credencial do Redis em QUALQUER prefixo (KV_*, UPSTASH_*, STORAGE_*, etc.)
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);

function clean(s, max) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, max || 40); }
function device(ua) { if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'; if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'celular'; return 'computador'; }
async function redis(cmd) {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  return r.json();
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }
    // filtro básico de robô (não conta crawler/preview/monitor)
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|monitor|preview|curl|wget|python|axios/i.test(ua)) {
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, skip: 1 })); return;
    }
    const q = parse(req.url, true).query || {};
    const type = (q.t === 'click') ? 'click' : 'view';
    const ebook = clean(q.ebook, 40) || '-';
    const versao = clean(q.versao, 12) || '-';
    const rede = clean(q.rede, 40) || 'direto';
    const pais = clean(req.headers['x-vercel-ip-country'], 4) || '??';
    const dev = device(ua);
    const date = new Date().toISOString().slice(0, 10);     // YYYY-MM-DD (UTC)
    const field = [ebook, versao, rede, pais, dev, type].join('|');   // type sempre por ULTIMO (parse aguenta formato antigo de 5 partes)
    await redis(['HINCRBY', 'stats:' + date, field, 1]);
    res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false })); }
};
