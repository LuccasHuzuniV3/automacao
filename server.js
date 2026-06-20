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
const { exec, execFile, spawn } = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 4321;

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

/* ===== COMPARTILHAR (link de visualizacao/edicao por token) =====================
   - share-config.json guarda os tokens (gitignored, NUNCA vai pro dist/Vercel).
   - O DONO (conexao local direta) escreve sem token: fluxo local intacto.
   - CONVIDADO (via tunel Cloudflare/ngrok) so escreve com token de 'edit' valido.
   - Antes de cada save, backup rotativo do ebooks.js em backups/.
   ============================================================================ */
const CFG_FILE = path.join(ROOT, 'share-config.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const MAX_BACKUPS = 50;
function randToken(n) { return require('crypto').randomBytes(n || 18).toString('hex'); }
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveCfg(c) { try { fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2)); } catch (e) {} }
function getCfg() { const c = loadCfg(); if (!Array.isArray(c.shares)) c.shares = []; return c; }
function pruneShares(c) { const now = Date.now(); c.shares = (c.shares || []).filter(function (s) { return !s.exp || s.exp > now; }); return c; }
function findShare(c, token) { if (!token) return null; pruneShares(c); return (c.shares || []).find(function (s) { return s.token === token; }) || null; }
// Conexao local direta do dono? Tuneis injetam cabecalhos de encaminhamento que o acesso local NAO tem.
function isLocalDirect(req) {
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['forwarded']) return false;
  const ra = (req.socket && req.socket.remoteAddress) || '';
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}
// Autoriza ESCRITA: dono local (ok) OU convidado com token 'edit' valido.
function canWrite(req) {
  if (isLocalDirect(req)) return true;
  const tok = req.headers['x-edit-token'] || '';
  const sh = findShare(getCfg(), tok);
  return !!(sh && sh.perm === 'edit');
}
// Backup rotativo de um arquivo de dados (ebooks.js OU ebooks-upsell.js). Mantem os MAX_BACKUPS mais novos POR arquivo.
function backupDataFile(fname, stampSeed) {
  try {
    const src = path.join(ROOT, fname);
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const base = String(fname).replace(/\.js$/, ''), pref = base + '-';
    const stamp = new Date(typeof stampSeed === 'number' ? stampSeed : Date.now()).toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(src, path.join(BACKUP_DIR, pref + stamp + '.js'));
    const files = fs.readdirSync(BACKUP_DIR).filter(function (n) { return n.indexOf(pref) === 0 && /^\d/.test(n.slice(pref.length)); }).sort();
    while (files.length > MAX_BACKUPS) { try { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); } catch (e) {} }
  } catch (e) {}
}
function backupEbooks(stampSeed) { backupDataFile('ebooks.js', stampSeed); }   // compat (save-scope/save-ebook usam este)
// Mapa workspace -> arquivo de dados + nome do global. FONTE UNICA (save, save-scope, save-ebook, share).
const WS_FILE = { principal: 'ebooks.js', upsell: 'ebooks-upsell.js', downsell: 'ebooks-downsell.js', downsell2: 'ebooks-downsell2.js' };
const WS_GLOBAL = { principal: 'EBOOKS', upsell: 'EBOOKS_UPSELL', downsell: 'EBOOKS_DOWNSELL', downsell2: 'EBOOKS_DOWNSELL2' };
function normWs(ws) { return WS_FILE[ws] ? ws : 'principal'; }   // valida; desconhecido -> principal
// Le o arquivo de dados de UM workspace como OBJETO (avalia num sandbox isolado, igual o build-dist).
function readWsObj(ws) {
  ws = normWs(ws);
  try {
    const code = fs.readFileSync(path.join(ROOT, WS_FILE[ws]), 'utf8');
    const sandbox = { window: {} };
    require('vm').runInNewContext(code, sandbox, { timeout: 3000 });
    return sandbox.window[WS_GLOBAL[ws]] || null;
  } catch (e) { return null; }
}
// Grava o objeto inteiro de volta no arquivo do workspace (com backup antes). Mesmo formato do exportText() do builder.
function writeWsObj(ws, obj) {
  ws = normWs(ws);
  backupDataFile(WS_FILE[ws]);
  fs.writeFileSync(path.join(ROOT, WS_FILE[ws]),
    '/* Gerado pelo Painel. Suba junto do index.html. */\n' +
    'window.' + WS_GLOBAL[ws] + ' = ' + JSON.stringify(obj, null, 2) + ';\n');
}
// compat: save-scope/save-ebook do Principal (apontam pro workspace principal)
function readEbooksObj() { return readWsObj('principal'); }
function writeEbooksObj(obj) { return writeWsObj('principal', obj); }

/* ===== TUNEL AUTOMATICO (compartilhar com 1 clique no start.bat) ==================
   Liga so quando a variavel de ambiente TUNNEL=1 (o start.bat seta). Sobe o cloudflared
   apontando pro app local, grava a URL publica em tunnel-url.txt (lida pelo /api/tunnel),
   e derruba tudo quando o app fecha. Sem TUNNEL=1, nada disso roda. ============== */
let tunnelProc = null;
function ensureCloudflared() {
  const exe = path.join(ROOT, 'cloudflared.exe');
  if (fs.existsSync(exe)) return Promise.resolve(exe);
  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  console.log('  Baixando o cloudflared (programa da Cloudflare, ~50MB, so na 1a vez)...');
  return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(function (ab) { fs.writeFileSync(exe, Buffer.from(ab)); return exe; });
}
function stopTunnel() {
  try { if (tunnelProc) tunnelProc.kill(); } catch (e) {}
  tunnelProc = null;
  try { fs.unlinkSync(path.join(ROOT, 'tunnel-url.txt')); } catch (e) {}
}
function startTunnel() {
  try { fs.unlinkSync(path.join(ROOT, 'tunnel-url.txt')); } catch (e) {}   // limpa URL de sessao anterior
  ensureCloudflared().then(function (exe) {
    tunnelProc = spawn(exe, ['tunnel', '--url', 'http://localhost:' + PORT], { cwd: ROOT });
    let found = false;
    function scan(d) {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
      if (m && !found) {
        found = true;
        try { fs.writeFileSync(path.join(ROOT, 'tunnel-url.txt'), m[0]); } catch (e) {}
        console.log('\n  >> COMPARTILHAR pronto! No editor, clique em "Compartilhar".\n     (link publico ativo enquanto esta janela estiver aberta)\n');
      }
    }
    tunnelProc.stdout.on('data', scan);
    tunnelProc.stderr.on('data', scan);
    tunnelProc.on('exit', function () { tunnelProc = null; try { fs.unlinkSync(path.join(ROOT, 'tunnel-url.txt')); } catch (e) {} });
    tunnelProc.on('error', function (e) { console.log('  (tunel: ' + (e && e.message) + ')'); });
  }).catch(function (e) { console.log('  (nao consegui iniciar o tunel de compartilhamento: ' + (e && e.message) + ')'); });
}
process.on('exit', stopTunnel);
process.on('SIGINT', function () { stopTunnel(); process.exit(0); });
process.on('SIGTERM', function () { stopTunnel(); process.exit(0); });

/* ===== ANTIGRAVITY CLI (agy) — motor de traducao ==================================================
   MIGRADO do gemini-cli (Google descontinuou o @google/gemini-cli em ~jun/2026 -> "Antigravity"/agy).
   Diferencas vs gemini-cli: binario `agy`; flag --dangerously-skip-permissions (era --skip-trust);
   saida em TEXTO PURO no stdout (nao mais JSON {"response":...}); prompt vai TODO via STDIN (nao usa -p);
   nomes de modelo novos (ex.: "Gemini 3.5 Flash (Medium)"). Modelo INVALIDO -> agy devolve stdout VAZIO
   em silencio (exit 0) -> por isso NAO mandamos --model quando vazio (deixa o default do proprio agy).
   BUG WINDOWS: agy.exe escreve direto no Console (WriteConsole) ignorando redirect -> stdout vem VAZIO.
   SOLUCAO: rodar agy via WSL Linux (set USE_WSL_FOR_AGY=1 no start.bat; precisa WSL+Ubuntu+agy logado).
   Mantido do original: timeout proprio + taskkill /F /T (mata a ARVORE de node.exe que o agy faz spawn). */
let _agyWslPath = null;   // cache do path absoluto do agy dentro do WSL (.bashrc NAO carrega via "wsl --")
function _usarWslAgy() {
  if (process.platform !== 'win32') return false;
  return ['1', 'true', 'yes'].indexOf(String(process.env.USE_WSL_FOR_AGY || '').trim().toLowerCase()) >= 0;
}
function _acharAgyNoWsl() {
  if (_agyWslPath) return _agyWslPath;
  const sp = require('child_process').spawnSync;
  try {
    const r = sp('wsl.exe', ['--', 'bash', '-lc', 'which agy'], { encoding: 'utf8', timeout: 15000 });
    const hit = String((r && r.stdout) || '').split(/\r?\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.indexOf('/') === 0 && s.indexOf('agy') >= 0; })[0];
    if (hit) { _agyWslPath = hit; return hit; }
  } catch (e) {}
  const cands = ['$HOME/.local/bin/agy', '/usr/local/bin/agy', '/usr/bin/agy', '/opt/agy/bin/agy'];
  for (let i = 0; i < cands.length; i++) {
    try {
      const r = sp('wsl.exe', ['--', 'bash', '-lc', 'test -x ' + cands[i] + ' && echo ' + cands[i]], { encoding: 'utf8', timeout: 10000 });
      let s = String((r && r.stdout) || '').trim();
      if (s) {
        if (s.indexOf('$HOME') >= 0) { const h = sp('wsl.exe', ['--', 'bash', '-lc', 'echo $HOME'], { encoding: 'utf8', timeout: 5000 }); const home = String((h && h.stdout) || '').trim(); if (home) s = s.replace('$HOME', home); }
        _agyWslPath = s; return s;
      }
    } catch (e) {}
  }
  return null;
}
function geminiInvoke(model, promptInstr, inputData, cb) {
  let done = false, timer = null, child = null;
  const finish = function (err, text) { if (done) return; done = true; if (timer) clearTimeout(timer); cb(err, text); };
  // modelo: SEM fallback hardcoded (nomes antigos nao existem no agy). Vazio => agy usa o default dele.
  // mantem espacos/parenteses dos nomes novos ("Gemini 3.5 Flash (Medium)"); tira so caractere perigoso.
  const mdl = String(model || '').replace(/[^a-zA-Z0-9 .()\-]/g, '').trim();
  // agy NAO usa -p: instrucao + textos vao TODOS via stdin, com \n final (CLI as vezes espera end-of-line).
  let stdinData = String(promptInstr || '');
  if (inputData) stdinData += (stdinData.endsWith('\n') ? '' : '\n') + String(inputData);
  if (!stdinData.endsWith('\n')) stdinData += '\n';

  const usarWsl = _usarWslAgy();
  let exe, args;
  if (usarWsl) {
    const agyAbs = _acharAgyNoWsl();
    if (!agyAbs) { finish(new Error('agy nao encontrado no WSL. Confirme no PowerShell: wsl -- bash -lc "which agy". Se vier vazio, instale dentro do Ubuntu: curl -fsSL https://antigravity.google/cli/install.sh | bash')); return; }
    exe = 'wsl.exe'; args = ['--', agyAbs, '--dangerously-skip-permissions'];
  } else {
    exe = 'agy'; args = ['--dangerously-skip-permissions'];
  }
  if (mdl) args.push('--model', mdl);   // so passa --model quando NAO vazio (nome invalido zera a saida)

  const spawnOpts = { cwd: ROOT, env: Object.assign({}, process.env, { GEMINI_CLI_TRUST_WORKSPACE: 'true' }), windowsHide: true };
  let outBuf = '', errBuf = '';
  try {
    child = spawn(exe, args, spawnOpts);   // spawn com args em ARRAY: nome de modelo com espaco/parentese passa intacto (sem shell)
  } catch (e) { finish(new Error('nao consegui iniciar o agy: ' + (e && e.message) + '. Instale: curl -fsSL https://antigravity.google/cli/install.sh | bash')); return; }
  child.on('error', function (e) { finish(new Error('agy nao encontrado/falhou (' + (e && e.message) + '). Instale: curl -fsSL https://antigravity.google/cli/install.sh | bash' + (process.platform === 'win32' && !usarWsl ? ' — no Windows use WSL: set USE_WSL_FOR_AGY=1 no start.bat' : ''))); });
  if (child.stdout) child.stdout.on('data', function (d) { outBuf += d; });
  if (child.stderr) child.stderr.on('data', function (d) { errBuf += d; });
  child.on('close', function () {
    if (done) return;
    const out = String(outBuf || '').trim();
    const el = String(errBuf || '').toLowerCase();
    if (!out) {
      let msg = 'agy sem resposta.';
      if (/exhausted|resource_exhausted|rate.?limit|\b429\b|quota/.test(el)) { msg = 'Cota esgotada (agy / Google AI Ultra) — espere o reset ou troque de conta. Rode "agy" no terminal pra checar.'; }
      else if (/emfile|too many open files/.test(el)) { msg = 'Muitos node.exe abertos (EMFILE). Feche o app, rode no PowerShell: taskkill /F /IM node.exe, e reabra o start.bat.'; }
      else if (/\bauth\b|\blogin\b|not logged|credential|unauthorized/.test(el)) { msg = 'agy precisa logar — rode "agy" no terminal uma vez (login com conta Google AI Ultra).'; }
      else if (process.platform === 'win32' && !usarWsl) { msg = 'agy no Windows nativo devolve vazio (escreve direto no console, ignora redirect). Ative o WSL: "set USE_WSL_FOR_AGY=1" no start.bat (precisa WSL+Ubuntu+agy instalado e logado la).'; }
      else if (String(errBuf || '').trim()) { msg = 'agy: ' + String(errBuf).trim().slice(-300); }
      else { msg = 'agy devolveu resposta vazia. Se passou um modelo, confirme o nome EXATO (ex.: "Gemini 3.5 Flash (Medium)") — nome invalido zera a saida.'; }
      finish(new Error(msg)); return;
    }
    finish(null, out);
  });
  // timeout proprio + mata a ARVORE (agy faz spawn de varios node.exe; so matar o pai deixa zumbi)
  timer = setTimeout(function () {
    try {
      if (process.platform === 'win32') { exec('taskkill /F /T /PID ' + child.pid, function () {}); }
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} } }
    } catch (e) {}
    finish(new Error('A traducao demorou demais (>150s). Tente de novo, ou verifique cota/login do agy.'));
  }, 150000);
  try { if (child.stdin) { child.stdin.write(stdinData); child.stdin.end(); } } catch (e) {}
}

const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // ---- grava os dados (ebooks.js = Principal | ebooks-upsell.js = UPSELL | ebooks-downsell.js = DOWNSELL via ?ws=) ----
  if (p === '/api/save' && req.method === 'POST') {
    if (!canWrite(req)) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
    const fname = WS_FILE[normWs(u.searchParams.get('ws'))];
    const body = await readBody(req);
    try {
      backupDataFile(fname);          // backup rotativo ANTES de sobrescrever (por arquivo)
      fs.writeFileSync(path.join(ROOT, fname), body);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- grava SO a fatia de um ebook+pais (merge) — usado pelo link compartilhado ----
  if (p === '/api/save-scope' && req.method === 'POST') {
    const local = isLocalDirect(req);
    const tok = req.headers['x-edit-token'] || '';
    const sh = findShare(getCfg(), tok);
    if (!local && !(sh && sh.perm === 'edit')) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
    const body = await readBody(req);
    let j; try { j = JSON.parse(body.toString('utf8')); } catch (e) { json(res, 400, { ok: false, error: 'json invalido' }); return; }
    const ebook = String(j.ebook || ''), pais = String(j.pais || '');
    if (!ebook || !pais || !j.pais_data || typeof j.pais_data !== 'object') { json(res, 400, { ok: false, error: 'faltam ebook/pais/dados' }); return; }
    // convidado SO grava no escopo do proprio link (anti-sobrescrever o resto)
    if (!local) {
      if (sh.ebook !== ebook) { json(res, 403, { ok: false, error: 'fora do escopo do link' }); return; }
      if (sh.scope !== 'ebook' && sh.pais !== pais) { json(res, 403, { ok: false, error: 'fora do escopo do link' }); return; }
    }
    // workspace: convidado SEMPRE usa o do token (autoridade); dono local pode mandar ?ws/j.ws
    const ws = normWs((!local && sh) ? sh.ws : (j.ws || u.searchParams.get('ws') || 'principal'));
    const all = readWsObj(ws);
    if (!all || !all[ebook]) { json(res, 409, { ok: false, error: 'ebook nao existe no servidor' }); return; }
    if (!all[ebook].paises || typeof all[ebook].paises !== 'object') all[ebook].paises = {};
    all[ebook].paises[pais] = j.pais_data;   // troca SO esta fatia; o resto do arquivo do workspace fica intacto
    try { writeWsObj(ws, all); json(res, 200, { ok: true, ebook: ebook, pais: pais, ws: ws }); }
    catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- grava o EBOOK inteiro (todos os idiomas) — link compartilhado com permissao de traduzir ----
  if (p === '/api/save-ebook' && req.method === 'POST') {
    const local = isLocalDirect(req);
    const tok = req.headers['x-edit-token'] || '';
    const sh = findShare(getCfg(), tok);
    if (!local && !(sh && sh.perm === 'edit' && sh.scope === 'ebook')) { json(res, 403, { ok: false, error: 'sem permissao (link nao permite traduzir)' }); return; }
    const body = await readBody(req);
    let j; try { j = JSON.parse(body.toString('utf8')); } catch (e) { json(res, 400, { ok: false, error: 'json invalido' }); return; }
    const ebook = String(j.ebook || '');
    if (!ebook || !j.ebook_data || typeof j.ebook_data !== 'object') { json(res, 400, { ok: false, error: 'faltam ebook/dados' }); return; }
    if (!local && sh.ebook !== ebook) { json(res, 403, { ok: false, error: 'fora do escopo do link' }); return; }
    // workspace: convidado SEMPRE usa o do token (autoridade); dono local pode mandar ?ws/j.ws
    const ws = normWs((!local && sh) ? sh.ws : (j.ws || u.searchParams.get('ws') || 'principal'));
    const all = readWsObj(ws);
    if (!all) { json(res, 409, { ok: false, error: 'nao li o ' + WS_FILE[ws] }); return; }
    all[ebook] = j.ebook_data;   // troca SO este ebook (todos os idiomas dele); os OUTROS ebooks ficam intactos
    try { writeWsObj(ws, all); json(res, 200, { ok: true, ebook: ebook, ws: ws }); }
    catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- grava uma imagem na pasta img/ ----
  if (p === '/api/image' && req.method === 'POST') {
    if (!canWrite(req)) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
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
    if (!canWrite(req)) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
    const body = await readBody(req);
    try {
      const name = String(u.searchParams.get('name') || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '');
      fs.mkdirSync(path.join(ROOT, 'img'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'img', name), body);
      json(res, 200, { ok: true, path: 'img/' + name });
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  // ---- tradução via Antigravity CLI (agy) — instrução + textos via STDIN, saída texto puro, mata a árvore; ver geminiInvoke ----
  if (p === '/api/gemini' && req.method === 'POST') {
    if (!canWrite(req)) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
    const body = await readBody(req);
    let model = '', prompt = '', input = '';   // model vazio => agy usa o default dele (sem nome de modelo antigo hardcoded)
    try { const j = JSON.parse(body.toString('utf8')); if (j.model) model = String(j.model); prompt = String(j.prompt || ''); input = String(j.input || ''); } catch (e) {}
    if (!prompt) { json(res, 200, { ok: false, error: 'sem prompt' }); return; }
    geminiInvoke(model, prompt, input, function (gerr, text) {
      if (gerr) { json(res, 200, { ok: false, error: String((gerr && gerr.message) || gerr).slice(0, 700) }); return; }
      json(res, 200, { ok: true, text: text });
    });
    return;
  }

  // ---- deploy na Vercel (monta dist/ LIMPA e sobe so ela; o admin nunca vai pro ar) ----
  if (p === '/api/deploy' && req.method === 'POST') {
    if (!canWrite(req)) { json(res, 403, { ok: false, error: 'sem permissao de edicao' }); return; }
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
    if (!isLocalDirect(req)) { json(res, 403, { ok: false, error: 'so o dono atualiza o sistema' }); return; }
    try {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sys-config.json'), 'utf8')) || {}; } catch (e) {}
      const rawBase = String(cfg.rawBase || '').replace(/\/+$/, '');
      if (!/^https:\/\/raw\.githubusercontent\.com\/.+/i.test(rawBase)) {
        json(res, 200, { ok: false, error: 'Atualizacao ainda nao configurada. O criador precisa rodar o CONFIGURAR-SISTEMA-GIT.bat.' }); return;
      }
      const NEVER = ['ebooks.js', 'ebooks-upsell.js', 'ebooks-downsell.js', 'ebooks-downsell2.js', 'sys-config.json', 'deploy-config.json', '.gitignore', 'share-config.json', 'tunnel-url.txt', 'start.bat'];   // nunca sobrescreve dados/config/launcher
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

  // ---- COMPARTILHAR: criar link (dono local only) ----
  if (p === '/api/share/create' && req.method === 'POST') {
    if (!isLocalDirect(req)) { json(res, 403, { ok: false, error: 'so o dono cria links' }); return; }
    const body = await readBody(req);
    let perm = 'view', ttlH = 0, ebook = '', pais = '', scope = 'pais', ws = 'principal';
    try { const j = JSON.parse(body.toString('utf8') || '{}'); if (j.perm === 'edit') perm = 'edit'; ttlH = parseInt(j.ttlHours, 10) || 0; ebook = String(j.ebook || ''); pais = String(j.pais || ''); if (j.scope === 'ebook') scope = 'ebook'; ws = normWs(j.ws); } catch (e) {}
    const c = getCfg();
    const tok = randToken(18);
    const exp = ttlH > 0 ? (Date.now() + ttlH * 3600 * 1000) : 0;   // 0 = nao expira
    c.shares.push({ token: tok, perm: perm, ebook: ebook, pais: pais, scope: scope, ws: ws, exp: exp, created: Date.now() });   // ws: qual workspace (principal/upsell/downsell); escopo: 'pais' (so este pais) ou 'ebook' (todos os idiomas, p/ traduzir)
    pruneShares(c); saveCfg(c);
    json(res, 200, { ok: true, token: tok, perm: perm, ebook: ebook, pais: pais, scope: scope, ws: ws, exp: exp });
    return;
  }
  // ---- COMPARTILHAR: revogar (dono local only) ----
  if (p === '/api/share/revoke' && req.method === 'POST') {
    if (!isLocalDirect(req)) { json(res, 403, { ok: false }); return; }
    const body = await readBody(req);
    let tok = ''; try { tok = String(JSON.parse(body.toString('utf8') || '{}').token || ''); } catch (e) {}
    const c = getCfg();
    c.shares = (c.shares || []).filter(function (s) { return s.token !== tok; });
    saveCfg(c);
    json(res, 200, { ok: true });
    return;
  }
  // ---- COMPARTILHAR: listar links ativos (dono local only) ----
  if (p === '/api/share/list' && req.method === 'GET') {
    if (!isLocalDirect(req)) { json(res, 403, { ok: false }); return; }
    const c = pruneShares(getCfg()); saveCfg(c);
    json(res, 200, { ok: true, shares: c.shares });
    return;
  }
  // ---- COMPARTILHAR: checar um token (publico — builder/index descobrem a permissao) ----
  if (p === '/api/share/check' && req.method === 'GET') {
    const sh = findShare(getCfg(), u.searchParams.get('token') || '');
    json(res, 200, { ok: !!sh, perm: sh ? sh.perm : null, ebook: sh ? (sh.ebook || '') : '', pais: sh ? (sh.pais || '') : '', scope: sh ? (sh.scope || 'pais') : 'pais', ws: sh ? normWs(sh.ws) : 'principal', exp: sh ? sh.exp : null });
    return;
  }
  // ---- quem sou eu: dono local ou convidado? (builder ajusta a UI) ----
  if (p === '/api/whoami' && req.method === 'GET') {
    json(res, 200, { ok: true, local: isLocalDirect(req) });
    return;
  }
  // ---- URL publica do tunel (o COMPARTILHAR.bat grava em tunnel-url.txt) ----
  if (p === '/api/tunnel' && req.method === 'GET') {
    let url = ''; try { url = String(fs.readFileSync(path.join(ROOT, 'tunnel-url.txt'), 'utf8') || '').trim(); } catch (e) {}
    json(res, 200, { ok: !!url, url: url });
    return;
  }

  // ---- /upsell e /downsell LOCAIS: espelham o deploy (testar o fluxo upsell->downsell sem hospedar) ----
  let servePath = p;
  if (p === '/upsell' || p === '/downsell' || p === '/downsell2') { res.writeHead(302, { Location: p + '/' + (u.search || '') }); res.end(); return; }   // precisa da barra final senão os caminhos relativos (ebooks.js) resolvem pra raiz = Principal
  const _wsm = /^\/(upsell|downsell2|downsell)\/(.*)$/.exec(p);   // downsell2 ANTES de downsell (senão /downsell pega o prefixo)
  if (_wsm) {
    const _sub = _wsm[1], _rest = _wsm[2];
    if (_rest === '' || _rest === 'index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); return; }
    if (_rest === 'ebooks.js') { let _src = 'window.EBOOKS={};'; try { _src = fs.readFileSync(path.join(ROOT, 'ebooks-' + _sub + '.js'), 'utf8').replace('window.EBOOKS_' + _sub.toUpperCase(), 'window.EBOOKS'); } catch (e) {} res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(_src); return; }
    servePath = '/' + _rest;   // desconto.js, img/.., css -> servidos da RAIZ
  }

  // ---- arquivos estaticos ----
  let rel = decodeURIComponent(servePath === '/' ? '/builder.html' : servePath);
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
  try { fs.unlinkSync(path.join(ROOT, 'tunnel-url.txt')); } catch (e) {}   // zera URL de compartilhamento de sessao anterior
  if (process.env.TUNNEL === '1') { startTunnel(); }                       // start.bat liga o compartilhamento automatico
});
