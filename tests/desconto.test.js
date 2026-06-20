/* Testes (TDD) do desconto.js — rode: node tests/desconto.test.js  (NÃO vai pro dist/) */
const assert = require('assert');
const { descontoPct, downsellURLFrom } = require('../desconto.js');
let pass = 0, fail = 0;
function eq(got, exp, msg) { try { assert.strictEqual(got, exp); pass++; } catch (e) { fail++; console.log('  x ' + msg + ' | esperado ' + JSON.stringify(exp) + ' | recebi ' + JSON.stringify(got)); } }

/* ---- descontoPct: preserva moeda + estilo decimal ---- */
eq(descontoPct('R$ 19,90', 50), 'R$ 9,95', 'R$ vírgula 50%');
eq(descontoPct('37 zł', 50), '18,50 zł', 'zł sem decimais -> meia casa');
eq(descontoPct('500 zł', 50), '250 zł', 'zł resultado inteiro = sem casas');
eq(descontoPct('US$ 19.90', 50), 'US$ 9.95', 'US$ ponto 50%');
eq(descontoPct('R$ 100,00', 50), 'R$ 50,00', 'R$ mantém 2 casas');
eq(descontoPct('R$ 1.999,90', 50), 'R$ 999,95', 'milhar + decimal');
eq(descontoPct('R$ 19,90', 0), 'R$ 19,90', '0% = igual');
eq(descontoPct('R$ 19,90', 100), 'R$ 0,00', '100% = zero (mantém casas do original)');
eq(descontoPct('', 50), '', 'vazio');
eq(descontoPct('grátis', 50), 'grátis', 'sem número devolve igual');
eq(descontoPct('R$ 30', 50), 'R$ 15', 'inteiro simples');
eq(descontoPct('R$ 25', 50), 'R$ 12,50', 'ímpar vira 2 casas');
eq(descontoPct('R$ 100,00', 40), 'R$ 60,00', '% configurável (40% off)');
eq(descontoPct('R$ 100,00', 60), 'R$ 40,00', '% configurável (60% off)');

/* ---- downsellURLFrom: UPSELL -> downsell2 (clone do upsell); PRINCIPAL (raiz) -> downsell (clone do principal). Preserva ebook+idioma+atribuição ---- */
eq(downsellURLFrom('/upsell', '?ebook=x&p=pl'), '/downsell2?ebook=x&p=pl', 'upsell -> downsell2');
eq(downsellURLFrom('/upsell/', '?ebook=x&p=pl'), '/downsell2?ebook=x&p=pl', 'upsell/ -> downsell2');
eq(downsellURLFrom('/upsell/index.html', '?p=de'), '/downsell2?p=de', 'upsell/index.html -> downsell2');
eq(downsellURLFrom('/upsell', ''), '/downsell2', 'sem query');
eq(downsellURLFrom('/upsell', '?ebook=arcturianos&p=br&s=luccas&utm_source=ig&sck=abc'), '/downsell2?ebook=arcturianos&p=br&s=luccas&utm_source=ig&sck=abc', 'upsell preserva canal(s=)+utm+sck p/ atribuir a venda');
eq(downsellURLFrom('/', '?ebook=x&p=pl'), '/downsell?ebook=x&p=pl', 'PRINCIPAL -> downsell 1');
eq(downsellURLFrom('/index.html', '?p=de'), '/downsell?p=de', 'principal/index.html -> downsell 1');
eq(downsellURLFrom('/', '?ebook=arcturianos&p=br&s=luccas'), '/downsell?ebook=arcturianos&p=br&s=luccas', 'principal preserva atribuição');

console.log('\n' + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
