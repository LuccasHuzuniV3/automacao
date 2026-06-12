/* =====================================================================
   server.js  —  App local (motor). Roda com Node puro (sem dependencias).
   - Serve o painel e a pagina (http://localhost:4321/builder.html)
   - /api/save    grava o ebooks.js no disco
   - /api/image   grava uma imagem na pasta img/
   - /api/deploy  roda "vercel --prod --yes" e devolve o link
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');

const ROOT = __dirname;
const PORT = 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.mp4':  'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
  '.ogv':  'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v'
};

function readBody(req) {
  return new Promise(function (resolve) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // ---- grava o ebooks.js ----
  if (p === '/api/save' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      fs.writeFileSync(path.join(ROOT, 'ebooks.js'), body);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- grava uma imagem na pasta img/ ----
  if (p === '/api/image' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const j = JSON.parse(body.toString('utf8'));
      const name = String(j.name || 'img.png').replace(/[^a-zA-Z0-9._-]/g, '');
      fs.mkdirSync(path.join(ROOT, 'img'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'img', name), Buffer.from(j.dataB64, 'base64'));
      json(res, 200, { ok: true, path: 'img/' + name });
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- grava um arquivo (video) na pasta img/ (upload bruto, sem base64) ----
  if (p === '/api/file' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const name = String(u.searchParams.get('name') || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '');
      fs.mkdirSync(path.join(ROOT, 'img'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'img', name), body);
      json(res, 200, { ok: true, path: 'img/' + name });
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- tradução via Gemini CLI (gemini -p ...) ----
  if (p === '/api/gemini' && req.method === 'POST') {
    const body = await readBody(req);
    let model = 'gemini-2.5-flash', prompt = '', input = '';
    try { const j = JSON.parse(body.toString('utf8')); if (j.model) model = String(j.model); prompt = String(j.prompt || ''); input = String(j.input || ''); } catch (e) {}
    if (!prompt) { json(res, 200, { ok: false, error: 'sem prompt' }); return; }
    // Monta o comando manualmente com a instrucao entre ASPAS (execFile+shell nao poe aspas no Windows).
    // Os textos vao por STDIN (sem problema de aspas).
    const safeModel = String(model).replace(/[^a-zA-Z0-9.\-]/g, '') || 'gemini-2.5-flash';
    const safePrompt = String(prompt).replace(/[\r\n]+/g, ' ').replace(/["%&|<>^`]/g, ' ').trim();
    const cmd = 'gemini --skip-trust -m ' + safeModel + ' -p "' + safePrompt + '" -o text';
    const child = exec(cmd,
      { cwd: ROOT, timeout: 180000, maxBuffer: 1024 * 1024 * 30, env: Object.assign({}, process.env, { GEMINI_CLI_TRUST_WORKSPACE: 'true' }) },
      function (err, stdout, stderr) {
        const out = String(stdout || '').trim();
        if (!out) { json(res, 200, { ok: false, error: ('Gemini CLI: ' + String(stderr || (err && err.message) || 'sem resposta')).slice(-700) }); return; }
        json(res, 200, { ok: true, text: out });
      });
    try { if (input) child.stdin.write(input); child.stdin.end(); } catch (e) {}
    return;
  }

  // ---- deploy na Vercel (monta dist/ LIMPA e sobe so ela; o admin nunca vai pro ar) ----
  if (p === '/api/deploy' && req.method === 'POST') {
    const body = await readBody(req);
    let ebooks = [];
    try { const j = JSON.parse(body.toString('utf8') || '{}'); if (Array.isArray(j.ebooks)) ebooks = j.ebooks.filter(Boolean); else if (j.ebook) ebooks = [j.ebook]; } catch (e) {}
    let prodUrl = '';
    try { prodUrl = (JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy-config.json'), 'utf8')) || {}).prodUrl || ''; } catch (e) {}

    function finish(ok, url, hint, log) { json(res, 200, { ok: ok, url: url || '', hint: hint || '', log: String(log || '').slice(-4000) }); }

    function deployNow() {
      execFile('vercel', ['dist', '--prod', '--yes'], { cwd: ROOT, shell: true, timeout: 180000, maxBuffer: 1024 * 1024 * 30 },
        function (err, stdout, stderr) {
          const out = String(stdout || '') + '\n' + String(stderr || '');
          const ok = !err && /"readyState":\s*"READY"|\.vercel\.app/i.test(out);
          let hint = '';
          if (!ok) {
            if (/log ?in|credential|authenticat|vercel login|not logged|no existing|missing_scope/i.test(out))
              hint = 'Faca o login uma vez: rode o "login-vercel.bat" e tente de novo.';
            else if (err && err.killed) hint = 'O deploy demorou demais. Tente de novo.';
            else hint = 'Falha no deploy — veja o log abaixo.';
          }
          // URL publica = dominio de producao estavel (a URL com hash do output e protegida pela Vercel)
          finish(ok, ok ? prodUrl : '', hint, out);
        });
    }

    function buildThenDeploy() {
      execFile('node', ['build-dist.js'].concat(ebooks), { cwd: ROOT, shell: true, timeout: 60000, maxBuffer: 1024 * 1024 * 30 },
        function (berr, bout, bstderr) {
          if (berr) { finish(false, '', 'Falha ao montar a dist limpa.', String(bout || '') + String(bstderr || '')); return; }
          deployNow();
        });
    }

    exec('vercel --version', { shell: true }, function (verr) {
      if (verr) { exec('npm i -g vercel', { maxBuffer: 1024 * 1024 * 30 }, function () { buildThenDeploy(); }); }
      else { buildThenDeploy(); }
    });
    return;
  }

  // ---- atualizar o sistema: puxa a ultima versao do GitHub do criador ----
  if (p === '/api/update' && req.method === 'POST') {
    try {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sys-config.json'), 'utf8')) || {}; } catch (e) {}
      const rawBase = String(cfg.rawBase || '').replace(/\/+$/, '');
      if (!/^https:\/\/raw\.githubusercontent\.com\/.+/i.test(rawBase)) {
        json(res, 200, { ok: false, error: 'Atualizacao ainda nao configurada. O criador precisa rodar o CONFIGURAR-SISTEMA-GIT.bat.' }); return;
      }
      const NEVER = ['ebooks.js', 'sys-config.json', 'deploy-config.json', '.gitignore'];   // nunca sobrescreve dados/config
      const bust = '?t=' + Date.now();
      let man = null;
      try { man = await fetch(rawBase + '/manifest.json' + bust, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }); } catch (e) {}
      if (!man || !Array.isArray(man.files)) { json(res, 200, { ok: false, error: 'Nao encontrei o manifest.json em ' + rawBase + ' (o criador ja publicou?).' }); return; }
      const updated = [], failed = [];
      for (const f of man.files) {
        const rel0 = String(f).replace(/^[\/\\]+/, '').replace(/\\/g, '/');
        if (!rel0 || rel0.indexOf('..') >= 0 || NEVER.indexOf(rel0) >= 0) continue;
        const dst = path.join(ROOT, rel0);
        if (!dst.startsWith(ROOT)) continue;
        try {
          const r = await fetch(rawBase + '/' + rel0.split('/').map(encodeURIComponent).join('/') + bust, { cache: 'no-store' });
          if (!r.ok) { failed.push(rel0); continue; }
          const buf = Buffer.from(await r.arrayBuffer());
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, buf);
          updated.push(rel0);
        } catch (e) { failed.push(rel0); }
      }
      json(res, 200, { ok: updated.length > 0, version: man.version || '', updated: updated, failed: failed });
    } catch (e) { json(res, 500, { ok: false, error: String(e).slice(0, 300) }); }
    return;
  }

  // ---- versao do sistema: local (version.json) vs ultima no GitHub (manifest) ----
  if (p === '/api/version' && req.method === 'GET') {
    let local = 0;
    try { local = parseInt(JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version, 10) || 0; } catch (e) {}
    let latest = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sys-config.json'), 'utf8')) || {};
      const rawBase = String(cfg.rawBase || '').replace(/\/+$/, '');
      if (/^https:\/\/raw\.githubusercontent\.com\/.+/i.test(rawBase)) {
        const man = await fetch(rawBase + '/manifest.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        if (man && typeof man.version !== 'undefined') latest = parseInt(man.version, 10);
      }
    } catch (e) {}
    json(res, 200, { ok: true, local: local, latest: latest });
    return;
  }

  // ---- arquivos estaticos ----
  let rel = decodeURIComponent(p === '/' ? '/builder.html' : p);
  let fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT)) { json(res, 403, { error: 'forbidden' }); return; }
  fs.stat(fp, function (err, st) {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404'); return; }
    const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    const h = { 'Content-Type': type, 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range;
    if (range) {
      const mm = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = mm[1] ? parseInt(mm[1], 10) : 0;
      let end = mm[2] ? parseInt(mm[2], 10) : st.size - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return; }
      h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      h['Content-Length'] = (end - start + 1);
      res.writeHead(206, h);
      fs.createReadStream(fp, { start: start, end: end }).pipe(res);
    } else {
      h['Content-Length'] = st.size;
      res.writeHead(200, h);
      fs.createReadStream(fp).pipe(res);
    }
  });
});

server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE') {
    const url = 'http://localhost:' + PORT + '/builder.html';
    console.log('\n  O painel JA esta rodando. Abrindo no navegador:\n  ' + url + '\n  (para reiniciar, feche a outra janela do painel antes)\n');
    if (!process.env.NO_OPEN) { try { exec('start "" "' + url + '"', function () {}); } catch (e2) {} }
    setTimeout(function () { process.exit(0); }, 1800);
  } else { throw e; }
});

server.listen(PORT, function () {
  const url = 'http://localhost:' + PORT + '/builder.html';
  console.log('\n  App rodando em: ' + url + '\n  (feche esta janela para parar)\n');
  if (!process.env.NO_OPEN) { try { exec('start "" "' + url + '"', function () {}); } catch (e) {} }
});
