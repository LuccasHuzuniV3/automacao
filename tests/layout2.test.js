/* Testes (TDD) do LAYOUT V2 "ESCOLHIDOS" — rode: node tests/layout2.test.js
   Contrato entre index.html (#lay2v, o template) e builder.html (E2TXT, a tradução):
     1) TODO campo data-edit do template está na lista E2TXT (=> o 🌐 Traduzir pega TUDO)
     2) e nenhum campo listado ficou órfão (E2TXT ⊆ template)
     3) botões de compra são .ctaLink (=> checkout do país + rastreio + popups, igual v1)
     4) CSS do v2 é 100% escopado (#lay2v / body.lay2) — não vaza pro template v1
     5) as engrenagens existem: gate do model, e2Fill, migração da flag, vídeo e2v, skip de preços */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  x ' + msg); } }

const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bld = fs.readFileSync(path.join(__dirname, '..', 'builder.html'), 'utf8');

/* ---- recorta o bloco do template ---- */
const mIni = idx.indexOf('<div id="lay2v">'), mFim = idx.indexOf('<!-- /#lay2v -->');
ok(mIni > 0 && mFim > mIni, 'template #lay2v existe no index.html');
const tpl = idx.slice(mIni, mFim);

/* ---- 1+2) campos do template <-> lista de tradução E2TXT ---- */
const tplKeys = new Set([...tpl.matchAll(/data-edit="(e2\w+)"/g)].map(m => m[1]));
const e2Block = (bld.match(/var E2TXT=[\s\S]*?\)\(\);/) || [''])[0];
const listKeys = new Set([...e2Block.matchAll(/'(e2\w+)'/g)].map(m => m[1]));
ok(tplKeys.size >= 80, 'template tem 80+ campos editáveis (achou ' + tplKeys.size + ')');
const faltamNaLista = [...tplKeys].filter(k => !listKeys.has(k));
const sobramNaLista = [...listKeys].filter(k => !tplKeys.has(k));
ok(faltamNaLista.length === 0, 'TODO campo do template está na tradução (faltou: ' + faltamNaLista.join(',') + ')');
ok(sobramNaLista.length === 0, 'nenhum campo órfão na lista (sobrou: ' + sobramNaLista.join(',') + ')');

/* ---- 3) checkout: 2 botões de compra com ctaLink (href/pop-up/rastreio automáticos) ---- */
const ctas = (tpl.match(/class="plan-btn ctaLink"/g) || []).length;
ok(ctas === 2, 'exatamente 2 botões de compra .ctaLink (achou ' + ctas + ')');
ok(!/pay\.hotmart\.com/.test(tpl), 'nenhum link de checkout FIXO no template (vem do campo 🛒 do país)');
ok((tpl.match(/href="#l2comprar"/g) || []).length >= 4, 'CTAs internos rolam pra oferta (#l2comprar)');

/* ---- 4) CSS 100% escopado ---- */
const cIni = idx.indexOf('<style id="lay2css">'), cFim = idx.indexOf('</style>', cIni);
ok(cIni > 0 && cFim > cIni, 'bloco de CSS lay2css existe');
const css = idx.slice(cIni + 20, cFim).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').replace(/@keyframes[^{]*\{/g, '');
let vazou = [];
for (const m of css.matchAll(/(?:^|\})\s*([^@{}]+?)\s*\{/g)) {
  const sel = m[1].trim();
  if (!sel) continue;
  if (/^(#lay2v|body\.lay2|html\.edit)/.test(sel)) continue;
  if (/^\d|^from$|^to$/.test(sel)) continue;   /* frames de keyframes (0%, from, to) */
  vazou.push(sel.slice(0, 40));
}
ok(vazou.length === 0, 'CSS sem seletor vazando do escopo (vazou: ' + vazou.slice(0, 4).join(' | ') + ')');
/* regressão do "hexágono fantasma": a classe GLOBAL .badge do v1 (clip-path:polygon, escudo) vazava no badge do v2 -> reset obrigatório */
ok(/#lay2v \.plan-pro \.badge\{[^}]*clip-path:none/.test(idx), 'badge do v2 RESETA clip-path (mata o vazamento da classe global .badge do v1 = escudo hexagonal)');
ok(/\.badge\{[^}]*clip-path:polygon/.test(idx.slice(0, cIni)), 'confirma que existe a classe global .badge do v1 com polygon (a fonte do vazamento)');

/* ---- 4b) MODO CANVA: layout ÚNICO (sem breakpoint de desktop) + mover blocos ---- */
const cssRaw = idx.slice(cIni + 20, cFim);
ok(cssRaw.indexOf('min-width:768') < 0, 'SEM layout de desktop no v2 (coluna única = nada desformata no PC)');
ok(/max-width:480px/.test(cssRaw) && /margin:0 auto/.test(cssRaw), 'coluna fixa de 480px centralizada (estilo Canva)');
ok(/body\.lay2::before/.test(cssRaw), 'decoração de fundo do template v1 escondida no v2 (hexágonos não vazam)');
const lay2js = idx.slice(idx.indexOf('var LAY2='), idx.indexOf('var LAY2=') + 7000);
ok(/e2mCard/.test(lay2js) && /e2mPlan/.test(lay2js) && /e2mGar/.test(lay2js), 'blocos (cards/planos/garantia) ganham data-move — alça ✛ de mover no editor');
ok(/_pos\|\|\{\}/.test(lay2js) && /_posM\|\|\{\}/.test(lay2js), 'posições arrastadas valem no PUBLICADO (t._pos mesclado com _posM)');

/* ---- 5) engrenagens ---- */
ok(/ebook==='model'/.test(idx) && /layout2/.test(idx), 'gate do LAY2 (model/layout2) no render');
ok(/var L2FAM=/.test(idx) && /layout2\)\|\|ebook==='model'/.test(idx), 'família do model detectada (flag layout2 herda nos clones)');
ok(/TXT\.concat\(_lay2\?E2TXT\.concat\(E3TXT\):\[\]\)/.test(bld), 'translatePais concatena as listas E2+E3 quando o ebook é da família');
ok(/e2P1Preco:1/.test(bld) && /e2P2Preco:1/.test(bld), 'preços do v2 no SKIP da tradução (copiam sem traduzir)');
ok(/function e2Fill/.test(bld) && /e2Fill\(S\.t/.test(bld), 'e2Fill materializa defaults antes de traduzir');
ok(/e2MigraModel\(\)/.test(bld) && /model\.model\.layout2=true/.test(bld), 'migração: model ganha a flag layout2 (clones herdam)');
ok(/WS==='upsell'&&!model\.model/.test(bld) && /model\.model=\{layout2:true/.test(bld), 'o model do UPSELL nasce SOZINHO no workspace (sem clonar), já com o template Obrigado/Coleção');
ok(/e\[23\]v/.test(bld) && /data-img="e2v\.v1"/.test(tpl) && /data-img="e2v\.v2"/.test(tpl), 'slots de vídeo (e2v) com upload próprio');
ok(/\[data-edit\]\[data-html\]/.test(bld), 'campos ricos (data-html) salvam innerHTML no editor');
const htmlKeys = new Set([...tpl.matchAll(/data-edit="(e2\w+)" data-html/g)].map(m => m[1]));
ok(htmlKeys.has('e2Title') && htmlKeys.has('e2GarTxt'), 'título e garantia marcados como ricos (preservam <b>/<strong>)');

/* ---- 7) LAYOUT V2 do UPSELL (#lay3v — "Obrigado/Coleção") ---- */
const m3i = idx.indexOf('<div id="lay3v">'), m3f = idx.indexOf('<!-- /#lay3v -->');
ok(m3i > 0 && m3f > m3i, 'template #lay3v (upsell) existe no index.html');
const tpl3 = idx.slice(m3i, m3f);
const tpl3Keys = new Set([...tpl3.matchAll(/data-edit="(e3\w+)"/g)].map(m => m[1]));
const e3Block = (bld.match(/var E3TXT=[\s\S]*?\)\(\);/) || [''])[0];
const list3 = new Set([...e3Block.matchAll(/'(e3\w+)'/g)].map(m => m[1]));
ok(tpl3Keys.size >= 20, 'upsell: 20+ campos editáveis (achou ' + tpl3Keys.size + ')');
const falta3 = [...tpl3Keys].filter(k => !list3.has(k));
const sobra3 = [...list3].filter(k => !tpl3Keys.has(k));
ok(falta3.length === 0, 'upsell: TODO campo do template está na tradução (faltou: ' + falta3.join(',') + ')');
ok(sobra3.length === 0, 'upsell: nenhum campo órfão na lista (sobrou: ' + sobra3.join(',') + ')');
ok((tpl3.match(/ctaLink/g) || []).length === 1, 'upsell: exatamente 1 botão de compra .ctaLink (checkout do país)');
ok(!/pay\.hotmart\.com/.test(tpl3), 'upsell: nenhum link de checkout FIXO no template');
const c3i = idx.indexOf('<style id="lay3css">'), c3f = idx.indexOf('</style>', c3i);
ok(c3i > 0 && c3f > c3i, 'bloco de CSS lay3css existe');
const css3 = idx.slice(c3i + 20, c3f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').replace(/@keyframes[^{]*\{/g, '');
let vaz3 = [];
for (const m of css3.matchAll(/(?:^|\})\s*([^@{}]+?)\s*\{/g)) {
  const s = m[1].trim(); if (!s) continue;
  if (/^(#lay3v|body\.lay3|html\.edit)/.test(s)) continue;
  if (/^\d|^from$|^to$/.test(s)) continue;
  vaz3.push(s.slice(0, 40));
}
ok(vaz3.length === 0, 'upsell: CSS 100% escopado (vazou: ' + vaz3.slice(0, 3).join(' | ') + ')');
ok(/LAY2=L2FAM&&L2WS==='principal'/.test(idx) && /LAY3=L2FAM&&L2WS==='upsell'/.test(idx), 'gates por WORKSPACE real: lay2 (principal) e lay3 (upsell) mutuamente exclusivos');
ok(/URLSearchParams\(location\.search\)\.get\('ws'\)/.test(idx), 'workspace vem do ?ws= (editor) com fallback pro caminho /upsell/ (publicado)');
ok(/edit=1&ws='\+encodeURIComponent\(WS\)/.test(bld), 'o editor manda ?ws= pro iframe (upsell mostra o template CERTO dentro do editor)');
ok(/e3mOferta/.test(idx) && /l3ctaZone/.test(idx) && /l3vslVideo/.test(idx), 'upsell: mover + zona de revelação + VSL presentes');
/* upsell v2 (melhorias do parceiro): autoplay mudo + botão de som + revela no FIM do vídeo + glow fix */
ok(/<video id="l3vslVideo"[^>]*muted autoplay/.test(idx), 'VSL com autoplay MUDO (navegadores exigem mudo p/ autoplay)');
ok(/id="l3btnUnmute"/.test(idx) && /data-edit="e3Unmute"/.test(idx) && /function ativarSom/.test(idx), 'botão "ativar o som" (traduzível) + ativarSom só muda muted (sem race que congela)');
ok(/vid\.duration-gap/.test(idx) && /vid\.addEventListener\('ended',reveal\)/.test(idx), 'oferta revela no FINALZINHO do vídeo (últimos ~3s / ended), não em 55s fixos');
ok(/vid\.duration\+8/.test(idx), 'rede de segurança: revela duration+8s se o vídeo travar');
ok(/#l3ctaZone\.show\{[^}]*overflow:visible/.test(idx), 'glow do botão não corta nas laterais (overflow:visible ao revelar)');
ok(/el\.tagName==='VIDEO'&&String\(v\)\.indexOf\('#'\)<0/.test(idx) && /#t=0\.1/.test(idx), 'VSL sem capa: #t=0.1 pinta um frame do próprio vídeo');
ok(tpl3Keys.has('e3Unmute') && list3.has('e3Unmute'), 'e3Unmute no template E na tradução (contrato do upsell)');
ok(/#lay3v h1 \.hl\{[^}]*background:none/.test(idx), 'h1 .hl do upsell RESETA o fundo (mata a caixa/marca-texto da classe global .hl que vazava atrás do texto)');
ok(/\.hl\{background:linear-gradient/.test(idx.slice(0, cIni)), 'confirma que existe a classe global .hl do v1 com fundo (a fonte do vazamento)');
ok(/model\.model && model\.model\.layout2/.test(bld) && /novoUp\.tema=JSON\.parse/.test(bld), 'upsell: clonar = estrutura do MODEL local + SÓ as cores (tema) da principal');
ok(/prin\[slug\]&&prin\[slug\]\.tema/.test(bld), 'as cores vêm do tema do ebook correspondente na principal');
ok(/recusarBtn/.test(idx.slice(idx.indexOf('if(LAY3)'))), '"Não, obrigado" reusa o fluxo do funil (recusar -> alerta 50% -> downsell)');
ok(/E2TXT\.concat\(E3TXT\)/.test(bld), 'tradução concatena os DOIS templates da família model');
ok(/e3De:1/.test(bld) && /e3Por:1/.test(bld), 'preços do upsell no SKIP da tradução');
ok(/e\[23\]v/.test(bld), 'upload de vídeo cobre e2v (principal) e e3v (upsell)');
ok(/template ATIVO/.test(bld), 'e2Fill materializa só o template ativo (upsell não herda os 92 campos do principal)');

/* ---- 8) elementos livres do template ANTIGO não vazam pro V2 ---- */
ok(/if\(LAY2\|\|LAY3\)return;/.test(idx), 'extras do v1 (prancheta 1280) NÃO renderizam nos templates v2 (era o hexágono fantasma)');
ok(/Elemento livre ainda não funciona no template novo/.test(bld), 'botão ➕ Elemento avisa e não cria extra invisível no v2');
ok(/if\(t\.extras\)delete t\.extras/.test(bld) && /if\(t\.decor\)delete t\.decor/.test(bld), 'e2MigraModel LIMPA extras/decor/capaX das famílias v2 no boot (mata o shape fantasma travado, à prova de cache)');
/* LAYOUT ÚNICO (Canva): posição/largura MESMAS no PC e celular — mata o "movi e mudou de lugar ao trocar de dispositivo" */
ok(/curDevice==='mobile'&&!isLay2\(curEbook\)\)\?'_posM':'_pos'/.test(bld), 'lay2: posição é ÚNICA (força _pos, ignora _posM device-split)');
ok(/if\(t\._posM\)\{if\(!t\._pos\)t\._pos=\{\};/.test(bld) && /delete t\._posM;/.test(bld), 'e2MigraModel dobra _posM no _pos único (preserva o visível) e apaga o mobile');
ok(/isL2\?'_w':'_wM'/.test(bld), 'lay2: largura de imagem também é campo único (_w)');

/* ---- 9) SISTEMA DE CORES (tema v2 — a "puxar cores" do parceiro) ---- */
ok(/var\(--c-fundo\)/.test(idx) && /var\(--c-ouro\)/.test(idx), 'lay2 CSS usa variáveis de tema (--c-fundo/--c-ouro)');
ok(/rgba\(var\(--rgb-ouro\)/.test(idx), 'transparências usam --rgb-* (derivado dos hexes)');
ok(/body\.lay2\{--c-fundo:/.test(idx) && /body\.lay3\{--c-fundo:/.test(idx), 'defaults do tema no BODY (ancestral — var CSS não sobe pro pai)');
ok(/function l2ApplyTema\(temaOverride\)/.test(idx) && /EB\[ebook\]&&EB\[ebook\]\.tema/.test(idx), 'l2ApplyTema aplica EB[ebook].tema (paleta por ebook)');
ok(/host=document\.body/.test(idx), 'tema aplicado no BODY (não no :root -> não vaza pro v1)');
ok(/tipo==='tema'/.test(idx) && /L2FAM\)\{try\{window\.addEventListener\('message'/.test(idx), 'preview AO VIVO da paleta via postMessage (só na família)');
ok(/id="btnCores"/.test(bld) && /PALETA DE CORES/.test(bld), 'builder tem o botão 🎨 Cores + painel de paleta');
ok(/function derive\(m\)/.test(bld) && /model\[curEbook\]\.tema/.test(bld), 'paleta: 6 mestras derivam o tema e gravam em model[ebook].tema');
ok(/Gerar da capa/.test(bld) && /getImageData/.test(bld), 'gerar-da-capa amostra as cores do mockup via canvas');
ok(/function paletaDaImagem/.test(bld) && /hist\[Math\.floor\(h\/15\)/.test(bld), 'gerar-da-capa usa histograma de matiz (algoritmo harmônico do parceiro)');
ok(/function hsl2hex/.test(bld) && /H\(Ha,100,74\)/.test(bld), 'reconstrói as 22 cores por HSL (ouro = hue de destaque Ha)');
ok(/dd>=60/.test(bld) && /\(Hb\+165\)%360/.test(bld), 'família ouro = hue >=60° do fundo (senão quase-complementar)');
ok(/receber hoje/.test(idx), 'seção usa o título "O que você vai receber hoje" (igual ao do parceiro)');
ok(/O que você vai <span>receber hoje<\/span>/.test(bld), 'migração troca o título antigo pelo "receber hoje" quando não editado');
ok(/btn\.style\.display=isLay2\(curEbook\)/.test(bld) && /window\.__refreshCores=refreshBtn/.test(bld), 'botão de cores só aparece na família model');

/* ---- 10) seção "O que você vai receber" (recard) ---- */
ok((tpl.match(/class="recard/g) || []).length === 3, 'lay2 tem 3 cards .recard na seção receber');
['e2RecLabel1', 'e2RecDesc1', 'e2RecLabel2', 'e2RecDesc2', 'e2RecLabel3', 'e2RecDesc3'].forEach(function (k) {
  ok(tplKeys.has(k) && listKeys.has(k), 'receber: ' + k + ' no template E na tradução');
});
ok(/data-img="e2i\.rec1"/.test(tpl) && /data-img="e2i\.rec3"/.test(tpl), 'receber: 3 imagens trocáveis (e2i.rec1..3)');
ok(/#lay2v \.recard \.tag\{[^}]*var\(--c-ouro/.test(idx), 'receber: chip dourado acompanha o tema');
ok(/\['\.recard','e2mRec'\]/.test(idx), 'receber: cards móveis (data-move e2mRec)');

/* ---- 11) barra de escassez turbinada ---- */
ok(/vagas-track/.test(tpl) && /class="vagas-bar" id="l2bar"/.test(tpl), 'vagas: bar dentro do trilho (.vagas-track)');
ok(/l2vagasShine/.test(idx) && /l2vagasPulse/.test(idx), 'vagas: shimmer correndo + caixa pulsando');

/* ---- integração leve: os dois botões ficam dentro do #lay2v e o v1 continua intacto ---- */
ok(/data-sec="footer"/.test(idx), 'template v1 intacto (footer com data-sec segue lá)');
ok(idx.indexOf('id="dr-ov"') > mFim, 'popups de captura ficam FORA do #lay2v (funcionam nos dois layouts)');

/* ---- 12) "a limpa": workspaces mortos fora do menu + painel de cores v1 escondido na família ---- */
['navDownsell', 'navDownsell2', 'navUpsell2', 'navDownsell3'].forEach(function (id) {
  ok(!new RegExp('id="' + id + '"').test(bld), 'nav rail: botão ' + id + ' removido do menu (workspace não usado)');
});
ok(/id="navPrincipal"/.test(bld) && /id="navUpsell"/.test(bld), 'nav rail: Principal + UPSELL continuam no menu');
ok(/if\(!isLay2\(curEbook\)\)form\.appendChild\(renderTema\(\)\)/.test(bld), 'painel de cores v1 (swatches) escondido na família model — usa a paleta 🎨 Cores');

/* ---- 13) imagens/vídeos da família editáveis na ESQUERDA (renderFamilyImages) ---- */
ok(/function renderFamilyImages/.test(bld), 'builder tem renderFamilyImages (imagens do template na esquerda)');
ok(/function getByPath/.test(bld), 'builder tem getByPath (lê o valor atual da imagem no model)');
ok(/if\(isLay2\(curEbook\)\)\{form\.appendChild\(renderFamilyImages\(P\)\)/.test(bld), 'família troca o grupo de imagens v1 pelo painel do template');
ok(/if\(!isLay2\(curEbook\)\)\{[\s\S]{0,160}renderList\('trust'/.test(bld), 'listas de imagem do v1 (confiança/blocos/bônus) escondidas na família');
/* contrato: TODO data-img e2* do lay2 está editável na esquerda (menos e2i.colecao = seção .certificado escondida) */
const famTplImgs2 = new Set([...tpl.matchAll(/data-img="(e2[iv]\.\w+)"/g)].map(m => m[1]));
const famBlock2 = (bld.match(/var FAM_IMGS_LAY2=\[[\s\S]*?\];/) || [''])[0];
const famKeys2 = new Set([...famBlock2.matchAll(/'(e2[iv]\.\w+)'/g)].map(m => m[1]));
famTplImgs2.delete('e2i.colecao');
const famFaltam2 = [...famTplImgs2].filter(k => !famKeys2.has(k));
ok(famFaltam2.length === 0, 'toda imagem/vídeo do lay2 está na esquerda (faltou: ' + famFaltam2.join(',') + ')');
ok(!famKeys2.has('e2i.colecao'), 'e2i.colecao (certificado escondido) fica FORA da esquerda');
/* idem para o lay3 (upsell) */
const famL3a = idx.indexOf('<div id="lay3v">'), famL3b = idx.indexOf('<!-- /#lay3v -->'), famTpl3 = idx.slice(famL3a, famL3b);
const famTplImgs3 = new Set([...famTpl3.matchAll(/data-img="(e3[iv]\.\w+)"/g)].map(m => m[1]));
const famBlock3 = (bld.match(/var FAM_IMGS_LAY3=\[[\s\S]*?\];/) || [''])[0];
const famKeys3 = new Set([...famBlock3.matchAll(/'(e3[iv]\.\w+)'/g)].map(m => m[1]));
const famFaltam3 = [...famTplImgs3].filter(k => !famKeys3.has(k));
ok(famFaltam3.length === 0, 'toda imagem/vídeo do lay3 (upsell) está na esquerda (faltou: ' + famFaltam3.join(',') + ')');
ok(/degradê é do layout v1|degradê do título é do layout v1/i.test(bld) && /if\(!isLay2\(curEbook\)\)\{/.test(bld), 'degradê do título (v1) escondido na família');

/* ---- 14) preços por moeda na família (auto ao traduzir + botão manual) ---- */
ok(/var MOEDA_PAIS=\{[\s\S]*?br:'BRL'/.test(bld), 'MOEDA_PAIS mapeia br -> BRL');
ok(/es:'USD'/.test(bld) && /en:'USD'/.test(bld), 'Espanha e Inglês -> USD (conforme o padrão passado)');
ok(/fr:'EUR'/.test(bld) && /it:'EUR'/.test(bld) && /de:'EUR'/.test(bld), 'França/Itália/Alemanha -> EUR');
ok(/BRL:\{cur:'BRL',\s*p1:'R\$ 12,90',\s*p2:'R\$ 19,90'/.test(bld), 'BRL: Guia R$ 12,90 / Coleção R$ 19,90');
ok(/EUR:\{cur:'EUR',\s*p1:'€12,00',\s*p2:'€20,00'/.test(bld), 'EUR: Guia €12,00 / Coleção €20,00');
ok(/USD:\{cur:'USD',\s*p1:'\$12,90',\s*p2:'\$19,90'/.test(bld), 'USD: Guia $12,90 / Coleção $19,90');
ok(/function aplicarPrecosFamilia/.test(bld), 'existe a função aplicarPrecosFamilia');
ok(/T\.t\.e2P1Preco=m\.p1;[\s\S]{0,60}T\.t\.e2P2Preco=m\.p2/.test(bld), 'aplica p1 no Guia (e2P1Preco) e p2 na Coleção (e2P2Preco)');
ok(/aplicarMoeda\(\)\{ try\{aplicarPrecosFamilia\(T,tgtCode\)/.test(bld), 'ao TRADUZIR, aplica os preços na moeda do país de destino');
ok(/skip=\{[^}]*e2P1Preco:1[^}]*e2P2Preco:1/.test(bld), 'preços V2 seguem no skip (não traduzem antes de aplicar a moeda)');
ok(/Aplicar preços da moeda neste país/.test(bld), 'botão manual de aplicar preços por moeda (pro BR/origem)');
ok(/var PRECO_TOKENS=\[/.test(bld) && /'R\$ 12,90'/.test(bld) && /'\$12,90'/.test(bld), 'copy troca preço em QUALQUER moeda de origem (PRECO_TOKENS: €/R$/$)');

/* ---- 15) popup de saída: sem timer de 30s, texto editável + cores do tema ---- */
ok(!/setTimeout\(mostrarExit,\s*30000\)/.test(idx), 'popup NÃO aparece mais sozinho (timer de 30s parado removido)');
ok(/mouseout/.test(idx) && /mostrarExit\(\)/.test(idx), 'popup ainda dispara na saída real (mouse pro topo / voltar)');
ok(/window\.__popQuero=function\(ev\)\{buyClicked=true;return false;\}/.test(idx), 'popup do "EU QUERO" removido -> clique vai DIRETO pro checkout (sem captura de e-mail)');
ok(/oT\('popTit',PT\.exitTit\)/.test(idx) && /oT\('popBtn',PT\.exitBtn\)/.test(idx), 'popup usa o texto editável do país (popTit/popSub1/popSub2/popBtn), senão o padrão');
ok(/groupFields\('✉️ Mensagem do popup de saída'/.test(bld), 'builder tem os campos pra editar a mensagem do popup');
ok(/\['popTit','popSub1','popSub2','popBtn'\]\.forEach/.test(bld), 'a mensagem do popup traduz junto no 🌐 Traduzir');
ok(/\.dr-pop\{[^}]*var\(--c-card/.test(idx) && /\.dr-btn\{[^}]*var\(--c-acento-claro/.test(idx), 'cores do popup vêm do tema da página (var --c-*), com fallback pro v1');

/* ---- 16) copy da oferta com preço/diferença automáticos por moeda ({colecao}/{guia}/{diff}) ---- */
ok(/\{colecao\}/.test(tpl) && /\{diff\}/.test(tpl), 'template da oferta usa placeholders {colecao} e {diff}');
ok(/data-edit="e2RoiSub"[^>]*data-html/.test(idx), 'e2RoiSub vira HTML (pra destacar o {diff})');
ok(/var l2ph=function/.test(idx) && /\.split\('\{diff\}'\)/.test(idx), 'index.html preenche os placeholders no render do lay2');
ok(/_pF=function\(sym,n\)/.test(idx) && /_colN-_guiN/.test(idx), 'index.html calcula a diferença (Coleção - Guia) e formata na moeda');
ok(/var OFFER_COPY_PT=/.test(bld) && /\{diff\} a mais/.test(bld), 'builder tem a copy da oferta com {diff} a mais');
ok(/Aplicar copy \+ preços da oferta/.test(bld), 'builder tem o botão de aplicar copy+preços da oferta');
ok(/Só <strong>\{diff\} a mais<\/strong> que o guia sozinho/.test(idx) && /Quem quer resultado de verdade escolhe a Coleção/.test(idx), 'copy da oferta = redação da imagem do parceiro (Coleção {colecao} + {diff} por país)');
ok(/OFFER_COPY_PT=[\s\S]*?Só <strong>\{diff\} a mais/.test(bld), 'builder (OFFER_COPY_PT) bate com a copy da imagem');

/* ---- 17) barra "últimas unidades do lote" alinhada à referência (ouro + 🔥 + pulsações) ---- */
const vagasCss = idx.slice(idx.indexOf('#lay2v .vagas-box{'), idx.indexOf('#lay2v .vagas-box .count #l2vagas') + 400);
ok(/\.label::before\{content:'🔥/.test(idx) && /\.label::after\{content:' 🔥/.test(idx), 'vagas: 🔥 dos dois lados do rótulo');
ok(!/var\(--c-acento\)/.test(vagasCss) && !/var\(--c-alerta\)/.test(vagasCss), 'vagas: sem coral/vermelho (--c-acento/--c-alerta) — família ouro pura, segue o tema');
ok(/var\(--c-ouro-suave\) 100%/.test(idx), 'vagas: barra termina em --c-ouro-suave (gradiente ouro, igual à referência)');
ok(/l2barPulse/.test(idx) && /l2numBeat/.test(idx) && /l2vagasLabel/.test(idx), 'vagas: pulsações da barra, do número e do rótulo (5 animações da referência)');

/* ---- 18) upsell (lay3): preço por moeda igual ao principal (e3Por/e3De) ---- */
ok(/if\(!isLay2\(curEbook\)\|\|!T\)return false/.test(bld), 'aplicarPrecosFamilia atende principal E upsell (gate sem excluir WS)');
ok(/if\(WS==='upsell'\)\{[\s\S]{0,90}T\.t\.e3Por=m\.p1;[\s\S]{0,40}T\.t\.e3De=m\.p2de/.test(bld), 'upsell: e3Por = preço do guia por moeda (BR 12,90 / EUR 12 / USD 12,90); e3De = 97');
ok(/\/\^e\[23\]\/\.test\(k\)/.test(bld), 'troca de preço na copy roda em e2* (principal) e e3* (upsell)');
ok(/Oferta do upsell/.test(bld), 'grupo de preços mostra "Oferta do upsell" no workspace upsell');

/* ---- 19) cupom automático no botão do GUIA (só ele): EUR=40OFF, BRL/USD=35OFF ---- */
ok(/plan-btn\.ctaLink \[data-edit="e2P1Btn"\]/.test(idx), 'cupom mira SÓ o botão do Guia (e2P1Btn), não o da Coleção');
ok(/\/€\/\.test\(String\(t\.e2P1Preco\|\|t\.e2P2Preco\|\|''\)\)\?'40OFF':'35OFF'/.test(idx), 'EUR -> 40OFF, resto (BRL/USD) -> 35OFF (detecta pela moeda do preço)');
ok(/offDiscount='\+cup/.test(idx), 'aplica o cupom via offDiscount= (auto-aplica na Hotmart)');

/* ---- 20) regressão: comentário do CSS do popup NÃO pode fechar antes da hora (quebrava .dr-ov -> #dr-pop vazio vermelho aparecia) ---- */
ok(/\.dr-ov\{position:fixed;inset:0;z-index:99998;display:none/.test(idx), 'popup: .dr-ov escondido por padrão (evita o quadrado vazio do #dr-pop)');
ok(!idx.includes('--c-*/'), 'CSS do popup: sem "*/" acidental no comentário (esse "*/" fechava o comentário e derrubava .dr-ov)');

/* ---- 21) selo "15 DIAS" (garantia-selo) centralizado na bolinha no MOBILE (regra v1 div[data-edit]{display:block} vazava) ---- */
ok(/#lay2v \.garantia-selo\{[^}]*display:flex!important/.test(idx), 'garantia-selo blindado com display:flex!important -> "15 DIAS" fica centrado na bolinha no mobile');
ok(/#lay2v \.plan-btn \.b-main\{display:flex!important/.test(idx), 'botão .b-main blindado com display:flex!important -> a setinha › não vaza pro fim do texto quebrado no mobile');

/* ---- 22) e2MigraModel CRIA o molde (model) no PRINCIPAL se faltar (colega que só atualizou o sistema ganha o layout novo) ---- */
ok(/if\(WS==='principal'\)\{[\s\S]{0,160}if\(!model\.model\)\{/.test(bld), 'e2MigraModel cria o model no principal quando não existe -> quem atualiza o sistema já tem o molde pra clonar');

/* ---- 23) "+ Ebook" sai do MOLDE "model" (layout novo), não do ebook aberto -> não herda os v1 antigos ---- */
ok(/var moldeKey=\(model\.model\)\?'model':curEbook;/.test(bld) && /var base=JSON\.parse\(JSON\.stringify\(model\[moldeKey\]\)\)/.test(bld), 'addEbook clona o "model" (não o ebook aberto) -> ebook novo já sai no layout novo em qualquer conta');

/* ---- 24) link com &amp; (codificado por anúncio/encurtador) ainda lê p/s -> não cai no idioma automático (PT) ---- */
ok(/location\.search[^;]*\.replace\(\/&amp;\/gi,'&'\)/.test(idx), "getParams decodifica &amp; -> & antes de ler os parâmetros (link torto ainda força o país certo)");

/* ---- 25) MODEL_DEFAULT: o model do Luccas (copy arrumada) vira o molde de TODOS ---- */
ok(/<script src="model-default\.js">/.test(bld), 'builder carrega o model-default.js (molde padrão distribuído no git)');
ok(/model\.model=\(window\.MODEL_DEFAULT[\s\S]{0,120}JSON\.parse\(JSON\.stringify\(window\.MODEL_DEFAULT\)\)/.test(bld), 'e2MigraModel cria o model a partir do MODEL_DEFAULT (não mais em branco)');
const mdef = fs.readFileSync(path.join(__dirname, '..', 'model-default.js'), 'utf8');
ok(/window\.MODEL_DEFAULT\s*=/.test(mdef) && /\{diff\}|\{colecao\}/.test(mdef), 'model-default.js = model do Luccas com a copy de placeholder ({colecao}/{diff})');
ok(/pay\.hotmart\.com\/XXXXXXXX/.test(mdef) && !/J106390212Q/.test(mdef), 'model-default.js: checkout resetado pra placeholder (não vaza o link do Luccas)');

/* ---- 26) BANCO DE DEPOIMENTOS: ao traduzir, auto-preenche e2i.depo1/2/3 a partir de img/depo/<rede>/<code>/ ---- */
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/p === '\/api\/depo-manifest' && req\.method === 'GET'/.test(srv), 'server: existe o endpoint GET /api/depo-manifest');
ok(/'img\/depo\/'\s*\+\s*rede\.name\s*\+\s*'\/'\s*\+\s*code/.test(srv), 'server: o manifesto monta os paths img/depo/<rede>/<code>/<foto>');
ok(/function aplicarDepoBanco\(T,code\)/.test(bld), 'existe a função aplicarDepoBanco');
ok(/fetch\('\/api\/depo-manifest'\)[\s\S]{0,120}window\.DEPO_BANK=d\.depo/.test(bld), 'builder carrega o banco (/api/depo-manifest) pro window.DEPO_BANK no boot');
ok(/try\{aplicarDepoBanco\(T,tgtCode\);\}catch/.test(bld), 'ao TRADUZIR, puxa os depoimentos do país de destino (dentro do aplicarMoeda)');
ok(/var arr=bancoDe\(window\.DEPO_BANK,code\)/.test(bld), 'aplicarDepoBanco puxa da rede selecionada (bancoDe)');
ok(/setByPath\(T\.t,'e2i\.depo1'/.test(bld) && /setByPath\(T\.t,'e2i\.depo2'/.test(bld) && /setByPath\(T\.t,'e2i\.depo3'/.test(bld), 'aplicarDepoBanco seta e2i.depo1/2/3');

/* ---- 26-rede) seleção de banco POR PÁGINA em campo PRÓPRIO (model[ebook].bancoMidia), default 'principal', sem fallback ----
   IMPORTANTE: NÃO pode usar model[ebook].rede (esse campo já é o canal/rede do ebook na analytics/vendas). */
ok(/function bancoDoEbook\(\)\{ return \(model\[curEbook\]&&model\[curEbook\]\.bancoMidia\)\|\|'principal'/.test(bld), 'bancoDoEbook: banco por página em model[ebook].bancoMidia (campo próprio), default principal');
ok(/function bancoDe\(BANK,code\)\{[\s\S]{0,120}BANK\[bancoDoEbook\(\)\]/.test(bld), 'bancoDe pega SÓ o banco escolhido (não mistura)');
ok(/function bancosDisponiveis\(\)/.test(bld), 'existe bancosDisponiveis (lista os bancos dos dois manifests)');
ok(/model\[curEbook\]\.bancoMidia=sel\.value/.test(bld), 'o seletor 🗂️ grava em model.bancoMidia');
ok(!/model\[curEbook\]\.rede=sel\.value/.test(bld), 'GUARDA: o seletor de mídia NÃO grava em model.rede (não sobrescreve o canal/rede do ebook)');

/* ---- 26b) o banco no disco: img/depo/<rede>/<código>/N.png (sem espaço/acento, senão o imgsOf/build-dist ignora) ---- */
const depoDir = path.join(__dirname, '..', 'img', 'depo');
if (fs.existsSync(depoDir)) {
  const badFolder = [], badFile = [];
  fs.readdirSync(depoDir, { withFileTypes: true }).filter(function (e) { return e.isDirectory(); }).forEach(function (rede) {
    fs.readdirSync(path.join(depoDir, rede.name), { withFileTypes: true }).filter(function (e) { return e.isDirectory(); }).forEach(function (cd) {
      if (!/^[a-z]{2,3}$/.test(cd.name)) badFolder.push(rede.name + '/' + cd.name);
      fs.readdirSync(path.join(depoDir, rede.name, cd.name)).forEach(function (n) {
        if (/\.(png|jpe?g|webp|gif)$/i.test(n) && !/^\d+\.(png|jpe?g|webp|gif)$/i.test(n)) badFile.push(rede.name + '/' + cd.name + '/' + n);
      });
    });
  });
  ok(badFolder.length === 0, 'img/depo: estrutura <rede>/<código país> (ruins: ' + badFolder.slice(0, 4).join(', ') + ')');
  ok(badFile.length === 0, 'img/depo: fotos normalizadas N.png (ruins: ' + badFile.slice(0, 4).join(', ') + ')');
} else {
  ok(true, 'img/depo ainda não existe — auto-preencher inativo (sem erro)');
}

/* ---- 27) BANCO DE VÍDEOS: ao traduzir, auto-preenche e2v.v1/v2 a partir de img/video/<rede>/<code>/ ---- */
ok(/p === '\/api\/video-manifest' && req\.method === 'GET'/.test(srv), 'server: existe o endpoint GET /api/video-manifest');
ok(/'img\/video\/'\s*\+\s*rede\.name\s*\+\s*'\/'\s*\+\s*code/.test(srv), 'server: o manifesto de vídeo monta os paths img/video/<rede>/<code>/<slot>');
ok(/function aplicarVideoBanco\(T,code\)/.test(bld), 'existe a função aplicarVideoBanco');
ok(/fetch\('\/api\/video-manifest'\)[\s\S]{0,120}window\.VIDEO_BANK=d\.video/.test(bld), 'builder carrega o banco de vídeo (/api/video-manifest) no boot');
ok(/try\{aplicarVideoBanco\(T,tgtCode\);\}catch/.test(bld), 'ao TRADUZIR, puxa os vídeos do país de destino (dentro do aplicarMoeda)');
ok(/var arr=bancoDe\(window\.VIDEO_BANK,code\)/.test(bld), 'aplicarVideoBanco puxa da rede selecionada (bancoDe)');
ok(/setByPath\(T\.t,'e2v\.v'\+m\[1\]/.test(bld), 'aplicarVideoBanco mapeia pelo número do arquivo (1.mp4 -> e2v.v1)');
const dmerge = require('../deploy-merge.js');
ok(dmerge.imgsOf('"img/video/principal/de/1.mp4"').length === 1, 'imgsOf casa o path de vídeo com rede (sem espaço) -> build-dist copia pro Vercel');

/* ---- 27b) o banco de vídeo no disco: img/video/<rede>/<código>/N.mp4 ---- */
const vidDir = path.join(__dirname, '..', 'img', 'video');
if (fs.existsSync(vidDir)) {
  const badVF = [], badVfile = [];
  fs.readdirSync(vidDir, { withFileTypes: true }).filter(function (e) { return e.isDirectory(); }).forEach(function (rede) {
    fs.readdirSync(path.join(vidDir, rede.name), { withFileTypes: true }).filter(function (e) { return e.isDirectory(); }).forEach(function (cd) {
      if (!/^[a-z]{2,3}$/.test(cd.name)) badVF.push(rede.name + '/' + cd.name);
      fs.readdirSync(path.join(vidDir, rede.name, cd.name)).forEach(function (n) {
        if (/\.(mp4|webm|mov|m4v)$/i.test(n) && !/^\d+\.(mp4|webm|mov|m4v)$/i.test(n)) badVfile.push(rede.name + '/' + cd.name + '/' + n);
      });
    });
  });
  ok(badVF.length === 0, 'img/video: estrutura <rede>/<código país> (ruins: ' + badVF.slice(0, 4).join(', ') + ')');
  ok(badVfile.length === 0, 'img/video: vídeos normalizados N.mp4 (ruins: ' + badVfile.slice(0, 4).join(', ') + ')');
} else {
  ok(true, 'img/video ainda não existe (compressão/inativo) — sem erro');
}

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
