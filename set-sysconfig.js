/* escreve o sys-config.json com o link RAW do GitHub (de onde o operador baixa updates).
   Uso:  node set-sysconfig.js <usuario> <repo>   (chamado pelo CONFIGURAR-SISTEMA-GIT.bat) */
const fs = require('fs');
const user = (process.argv[2] || '').trim();
const repo = (process.argv[3] || '').trim();
const rawBase = 'https://raw.githubusercontent.com/' + user + '/' + repo + '/main';
fs.writeFileSync('sys-config.json', JSON.stringify({
  rawBase: rawBase,
  _nota: 'De onde o painel baixa as atualizacoes (GitHub raw). Gerado pelo CONFIGURAR-SISTEMA-GIT.bat.'
}, null, 2) + '\n');
console.log('sys-config.json -> ' + rawBase);
