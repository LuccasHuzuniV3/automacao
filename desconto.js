/* =====================================================================
   desconto.js — helpers do fluxo UPSELL -> DOWNSELL (super-desconto).
   Puro e SEM dependências: carregado no index.html (alerta) e no
   builder.html (clone do downsell), e testável no Node (tests/).
   ===================================================================== */
(function (g) {
  'use strict';

  /* Aplica `pct`% de desconto num PREÇO em string, preservando o símbolo da
     moeda (R$, zł, US$, €…) e o estilo decimal (vírgula/ponto).
       descontoPct("R$ 19,90", 50) -> "R$ 9,95"
       descontoPct("37 zł", 50)    -> "18,50 zł"
       descontoPct("500 zł", 50)   -> "250 zł"      (resultado inteiro = sem casas)
       descontoPct("US$ 19.90", 50)-> "US$ 9.95"
     Sem número na string (ex.: "grátis") devolve igual. */
  function descontoPct(valor, pct) {
    var s = (valor == null) ? '' : String(valor);
    var m = s.match(/\d[\d.,\s]*\d|\d/);
    if (!m) return s;
    var raw = m[0], pre = s.slice(0, m.index), suf = s.slice(m.index + raw.length);
    var dec = '', intPart = raw, dm = raw.match(/[.,](\d{1,2})$/);   // último .,/ seguido de 1-2 dígitos = decimal
    if (dm) { dec = dm[1]; intPart = raw.slice(0, raw.length - dm[0].length); }
    var num = parseFloat(intPart.replace(/[.,\s]/g, '') + (dec ? '.' + dec : ''));
    if (!isFinite(num)) return s;
    var p = Number(pct); if (!isFinite(p)) p = 0;
    var nv = num * (1 - p / 100); if (nv < 0) nv = 0;
    var seps = raw.match(/[.,]/g), ctx = pre + suf;
    var usaPonto = /US\$|USD|GBP|£/i.test(ctx) || /(^|[^A-Za-z])\$/.test(ctx);   // US$/£/$-puro = ponto; R$, €, zł… = vírgula
    var sep = seps ? seps[seps.length - 1] : (usaPonto ? '.' : ',');
    var out = (dec || nv % 1 !== 0) ? nv.toFixed(2).replace('.', sep) : String(Math.round(nv));
    return pre + out + suf;
  }

  /* Monta a URL do downsell a partir do caminho/query atuais, preservando a query (atribuição).
     Pura (recebe pathname/search) p/ dar pra testar sem o browser.
     FUNIL: UPSELL 2 -> /downsell3; UPSELL (1) -> /downsell2; PRINCIPAL (ou qualquer outro) -> /downsell.
       downsellURLFrom("/upsell2","?ebook=x&p=pl") -> "/downsell3?ebook=x&p=pl"
       downsellURLFrom("/upsell", "?ebook=x&p=pl") -> "/downsell2?ebook=x&p=pl"
       downsellURLFrom("/",       "?ebook=x&p=pl") -> "/downsell?ebook=x&p=pl" */
  function downsellURLFrom(pathname, search) {
    var path = String(pathname || '/');
    var target = '/downsell';                                                    // PRINCIPAL (ou qualquer outro) -> /downsell
    if (/\/upsell2(\/index\.html)?\/?$/i.test(path)) target = '/downsell3';       // UPSELL 2 -> /downsell3 (clone do upsell 2)
    else if (/\/upsell(\/index\.html)?\/?$/i.test(path)) target = '/downsell2';   // UPSELL (1) -> /downsell2 (clone do upsell 1)
    return target + (search || '');
  }

  var api = { descontoPct: descontoPct, downsellURLFrom: downsellURLFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (g) { g.descontoPct = descontoPct; g.downsellURLFrom = downsellURLFrom; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
