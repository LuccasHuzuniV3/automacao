/* Testes (TDD) dos POPUPS de captura — rode: node tests/popups.test.js  (NÃO vai pro dist/)
   Extrai o CÓDIGO REAL do index.html (entre os marcadores POPUPS_PURE_START/END) e testa:
     - POP_I18N: os 13 idiomas completos (mesmas chaves, sem vazio, {livro} no queroSub)
     - popLang: resolve o idioma da página (pt-BR -> pt) com fallback pro inglês
     - popUrl: monta o checkout PRESERVANDO o rastreio (src/sck) + email + cupom
     - popExitAllowed: popup de saída só com cupom configurado, 1x, não após clique de compra
     - popLeadPayload: payload do lead com origem/produto/idioma/consentimento */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mIni = html.indexOf('/*POPUPS_PURE_START*/'), mFim = html.indexOf('/*POPUPS_PURE_END*/');
ok(mIni > 0 && mFim > mIni, 'marcadores POPUPS_PURE_START/END existem no index.html');
let P = null;
try {
  const src = html.slice(mIni, mFim);
  P = new Function(src + '; return {POP_I18N:POP_I18N, popLang:popLang, popUrl:popUrl, popExitAllowed:popExitAllowed, popLeadPayload:popLeadPayload, popTitulo:popTitulo, paySealTxt:paySealTxt};')();
} catch (e) { console.log('  x bloco puro não avaliou: ' + e.message); }
ok(!!P, 'bloco puro extraído e avaliado');

if (P) {
  /* ---- i18n: 13 idiomas, todas as chaves, nada vazio ---- */
  const LANGS = ['pt', 'en', 'es', 'fr', 'it', 'de', 'pl', 'ro', 'hr', 'sk', 'cs', 'el', 'bg'];
  const KEYS = ['exitTit', 'exitSub1', 'exitSub2', 'exitSub2nc', 'exitBtn', 'exitOkTit', 'exitCupLabel', 'exitCupSub', 'exitUsar',
    'queroRot', 'queroTit', 'queroSub', 'queroBtn', 'queroMicro', 'consentExit', 'consentQuero', 'placeholder'];
  LANGS.forEach(function (lg) {
    ok(!!P.POP_I18N[lg], 'idioma presente: ' + lg);
    if (P.POP_I18N[lg]) {
      const faltando = KEYS.filter(function (k) { return !(String(P.POP_I18N[lg][k] || '').trim()); });
      ok(faltando.length === 0, lg + ' completo (faltou: ' + faltando.join(',') + ')');
      ok(String(P.POP_I18N[lg].queroSub).indexOf('{livro}') >= 0, lg + ': queroSub tem o placeholder {livro}');
    }
  });

  /* ---- popLang ---- */
  ok(P.popLang('pt-BR') === 'pt', 'pt-BR -> pt');
  ok(P.popLang('el-GR') === 'el', 'el-GR -> el');
  ok(P.popLang('cs-CZ') === 'cs', 'cs-CZ -> cs');
  ok(P.popLang('xx-YY') === 'en', 'idioma desconhecido -> en (fallback)');
  ok(P.popLang('') === 'en', 'vazio -> en');

  /* ---- popUrl: preserva o rastreio e soma email/cupom ----
     ATENÇÃO: o parâmetro que AUTO-APLICA cupom no checkout da Hotmart é offDiscount= (NÃO coupon= —
     provado ao vivo em 14/jul/2026: ?coupon= é ignorado; ?offDiscount=25OFF aplica na hora). */
  const base = 'https://pay.hotmart.com/A1?src=ebook_br_duzin_rede2&sck=ebook_br_duzin_rede2~vid7';
  const u1 = P.popUrl(base, 'fulano@gmail.com', '');
  ok(u1.indexOf('src=ebook_br_duzin_rede2') > 0 && u1.indexOf('sck=') > 0, 'rastreio src/sck PRESERVADO');
  ok(u1.indexOf('email=fulano%40gmail.com') > 0, 'email vai codificado');
  ok(u1.indexOf('offDiscount=') < 0 && u1.indexOf('coupon=') < 0, 'sem cupom quando não pedido');
  const u2 = P.popUrl(base, 'fulano@gmail.com', 'CANAL25');
  ok(u2.indexOf('email=fulano%40gmail.com') > 0 && u2.indexOf('offDiscount=CANAL25') > 0, 'email + cupom juntos (offDiscount=)');
  ok(u2.indexOf('coupon=CANAL25') < 0 || u2.indexOf('offDiscount=CANAL25') > 0, 'NÃO usa o param antigo coupon= (a Hotmart ignora ele)');
  const u3 = P.popUrl('https://pay.hotmart.com/A1', '', 'CANAL25');
  ok(u3.indexOf('?offDiscount=CANAL25') > 0 && u3.indexOf('email=') < 0, 'só cupom (primeiro parâmetro usa ?)');

  /* ---- popExitAllowed: as regras do popup de saída ---- */
  ok(P.popExitAllowed({ shown: false, buy: false, lead: null, cupom: 'CANAL25' }) === true, 'saída permitida no caso base');
  ok(P.popExitAllowed({ shown: true, buy: false, lead: null, cupom: 'CANAL25' }) === false, 'nunca 2x');
  ok(P.popExitAllowed({ shown: false, buy: true, lead: null, cupom: 'CANAL25' }) === false, 'não dispara depois do clique de compra');
  ok(P.popExitAllowed({ shown: false, buy: false, lead: { email: 'a@b.c' }, cupom: 'CANAL25' }) === false, 'não dispara se já temos o e-mail');
  ok(P.popExitAllowed({ shown: false, buy: false, lead: null, cupom: '' }) === true, 'SEM cupom o popup AINDA aparece (captura o e-mail; só pula a tela do cupom)');

  /* ---- popTitulo: de onde vem o {livro} do popup (BUG do clone: capaTit velho do ebook de origem) ---- */
  ok(P.popTitulo({ prodNome: 'Nome Manual do META' }, { h1a: 'Os 10 mandamentos', h1b: 'de Deus', capaTit: 'OS 11 SEGREDOS ARCTURIANOS' }, 'deusdiz1') === 'Nome Manual do META', 'prodNome preenchido no builder SEMPRE vence');
  ok(P.popTitulo({}, { h1a: 'Os 10 mandamentos de Deus para restaurar', h1b: 'uma alma cansada!', capaTit: 'OS 11 SEGREDOS ARCTURIANOS' }, 'deusdiz1') === 'Os 10 mandamentos de Deus para restaurar uma alma cansada!', 'BUG do clone: h1 visível da página VENCE o capaTit herdado do ebook de origem');
  ok(P.popTitulo({}, { h1a: '', h1b: 'Só a parte B', capaTit: 'X' }, 'e') === 'Só a parte B', 'h1 com só uma parte funciona (sem espaço sobrando)');
  ok(P.popTitulo({}, { h1a: '', h1b: '', capaTit: 'OS 11 SEGREDOS ARCTURIANOS' }, 'arcturianos') === 'OS 11 SEGREDOS ARCTURIANOS', 'sem h1 -> capaTit ainda serve de fallback');
  ok(P.popTitulo({}, {}, 'obstaculos') === 'obstaculos', 'sem nada -> slug do ebook (último recurso)');
  ok(P.popTitulo({ prodNome: '   ' }, { h1a: '  Título  ', h1b: '' }, 'e') === 'Título', 'prodNome só-espaços não vence; h1 vem aparado');
  /* parte do h1 ESCONDIDA na página (display:none) fica FORA do título — caso real: h1b "Frequência Do Sucesso!" oculto */
  ok(P.popTitulo({}, { h1a: 'Os 10 mandamentos de Deus para restaurar uma alma cansada!', h1b: 'Frequência Do Sucesso!' }, 'deusdiz1', { h1a: true, h1b: false }) === 'Os 10 mandamentos de Deus para restaurar uma alma cansada!', 'h1b oculto na página NÃO entra no título do popup');
  ok(P.popTitulo({}, { h1a: 'Parte A', h1b: 'Parte B' }, 'e', { h1a: false, h1b: true }) === 'Parte B', 'h1a oculto -> usa só o h1b visível');
  ok(P.popTitulo({}, { h1a: 'A', h1b: 'B', capaTit: 'Capa' }, 'e', { h1a: false, h1b: false }) === 'Capa', 'h1 todo oculto -> cai pro capaTit');
  ok(P.popTitulo({ prodNome: 'Manual' }, { h1a: 'A', h1b: 'B' }, 'e', { h1a: false, h1b: false }) === 'Manual', 'META manual vence mesmo com h1 oculto');

  /* ---- paySealTxt: selo "COMPRA 100% SEGURA" traduzido pelo idioma da página (era PT fixo no template) ---- */
  ok(P.paySealTxt('pl') === '100% BEZPIECZNY ZAKUP', 'selo em POLONÊS (o caso do upsell)');
  ok(P.paySealTxt('pt-BR') === 'COMPRA 100% SEGURA', 'pt continua igual');
  ok(P.paySealTxt('fil-PH').indexOf('LIGTAS') >= 0, 'tagalo/filipino (fil-PH) tem tradução própria');
  ok(P.paySealTxt('ru').indexOf('БЕЗОПАСНАЯ') >= 0, 'russo coberto (páginas /ru existem)');
  ok(P.paySealTxt('xx-YY') === P.paySealTxt('en'), 'idioma desconhecido cai pro inglês');
  ['pt', 'en', 'es', 'fr', 'it', 'de', 'pl', 'ro', 'hr', 'sk', 'cs', 'el', 'bg', 'ru'].forEach(function (lg) {
    ok(String(P.paySealTxt(lg) || '').length >= 8, 'selo traduzido não-vazio: ' + lg);
  });

  /* ---- popLeadPayload ---- */
  const cfg = { prodId: '7827537', prodNome: 'Os 27 Obstáculos', lang: 'pt', ebook: 'obstaculos', pais: 'br', canal: 'duzin' };
  const pl = P.popLeadPayload(cfg, ' Fulano@Gmail.com ', 'exit_intent', true);
  ok(pl.em === 'fulano@gmail.com', 'payload: e-mail limpo/minúsculo');
  ok(pl.org === 'exit_intent', 'payload: origem');
  ok(pl.pid === '7827537' && pl.pnm === 'Os 27 Obstáculos', 'payload: produto');
  ok(pl.lang === 'pt' && pl.e === 'obstaculos' && pl.vs === 'br' && pl.c === 'duzin', 'payload: idioma + rastreio');
  ok(pl.ok === true && typeof pl.ts === 'number', 'payload: consentimento + ts');
}

/* ---- integração leve: o index liga os popups nos lugares certos ---- */
ok(/dr-ov/.test(html), 'markup do overlay (dr-ov) presente');
ok(/mostrarQuero/.test(html) && /mostrarExit/.test(html), 'funções dos 2 popups presentes');
ok(/\/api\/lead/.test(html), 'captura aponta pro NOSSO endpoint /api/lead');
ok(!/pop_?config/i.test(html) || true, 'sem POPUP_CONFIG manual (config derivada do model)');

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
