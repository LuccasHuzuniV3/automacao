/* =====================================================================
   /api/reset  —  apaga SÓ os dados de analytics (stats:* e sales:*).
   Protegido: se a env RESET_TOKEN existir, exige ?token=ela; senão,
   exige ?confirm=APAGAR (e é sempre POST, pra crawler não disparar).
   Nao apaga outras chaves do Redis. Sem dependências.
   ===================================================================== */
const { parse } = require('url');
function pickEnv(re) { const ks = Object.keys(process.env); for (let i = 0; i < ks.length; i++) { if (re.test(ks[i]) && !/READ_?ONLY/i.test(ks[i])) return process.env[ks[i]]; } return ''; }
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pickEnv(/REST_API_URL$|REST_URL$/);
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pickEnv(/REST_API_TOKEN$|REST_TOKEN$/);
async function redis(cmd) { const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return r.json(); }

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'use POST' })); return; }
  try {
    if (!RURL || !RTOK) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'sem store' })); return; }
    const q = parse(req.url, true).query || {};
    const SECRET = process.env.RESET_TOKEN || '';
    if (SECRET) { if (String(q.token || '') !== String(SECRET)) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'token invalido' })); return; } }
    else { if (String(q.confirm || '') !== 'APAGAR') { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'confirme' })); return; } }

    const k1 = (await redis(['KEYS', 'stats:*'])).result || [];
    const k2 = (await redis(['KEYS', 'sales:*'])).result || [];
    const k3 = (await redis(['KEYS', 'salelog:*'])).result || [];
    const keys = k1.concat(k2).concat(k3);
    let del = 0;
    for (let i = 0; i < keys.length; i += 50) { const chunk = keys.slice(i, i + 50); if (chunk.length) { await redis(['DEL'].concat(chunk)); del += chunk.length; } }
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, apagadas: del }));
  } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 150) })); }
};
