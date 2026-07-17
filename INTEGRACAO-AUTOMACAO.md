# 🔌 Integração — Automação de Recuperação de Vendas

Como puxar os leads/eventos do banco (Redis via API própria, hospedada na Vercel).

## Endpoint principal (USE ESTE): a JORNADA

```
GET https://dist-gamma-sooty-36.vercel.app/api/lead?journey=1&days=30&token=SEU_TOKEN
```

| Parâmetro | Valor |
|---|---|
| `journey=1` | liga o modo jornada (1 entrada POR PESSOA, já classificada) |
| `days` | janela em dias (padrão 30, máx 90) |
| `token` | o MESMO token do painel (variável `VIEW_TOKEN` na Vercel). Sem ele → 401 |

### Resposta

```json
{
  "ok": true, "journey": true, "dias": 30,
  "list": [
    {
      "em": "fulano@gmail.com",        // e-mail (chave única da pessoa)
      "bn": "Fulano Silva",            // nome (quando a Hotmart mandou)
      "ph": "31999999999",             // telefone com DDI (quando veio — WhatsApp!)
      "estagio": "recusado_saldo_insuficiente",
      "motivo": "Saldo insuficiente para o cartão informado.",  // texto ORIGINAL da Hotmart
      "pid": "7827537",                // id do produto Hotmart
      "pnm": "Os 27 Obstáculos...",    // nome do produto
      "e": "obstaculos",               // slug do ebook (rastreio interno)
      "p": "BR",                       // país (ISO-2)
      "lang": "pt",                    // idioma da página que capturou
      "ts": 1783736000000              // último evento (epoch ms) — use p/ processar só o delta
    }
  ]
}
```
Lista ordenada do mais recente pro mais antigo.

## Os estágios (o que disparar pra cada um)

| `estagio` | Significado | Ação sugerida |
|---|---|---|
| `comprou` | pagou! | ❌ EXCLUIR de qualquer recuperação |
| `aguardando_pagamento` | pix/boleto gerado, ainda no prazo | esperar (ou lembrete suave) |
| `recusado_saldo_insuficiente` | 💰 tentou pagar, sem saldo | sequência "tenta outro cartão/pix" |
| `recusado_nao_autorizado` | ❌ banco negou | sequência "fala com teu banco / método alternativo" |
| `recusado_antifraude` | antifraude da Hotmart bloqueou | sequência método alternativo (pix/PayPal) |
| `recusado_outro` | recusa com motivo não mapeado (ver `motivo`) | genérica de recusa |
| `pix_boleto_nao_pago` | 🟡 gerou e EXPIROU sem pagar | "seu pix venceu, gera outro aqui" |
| `abandonou_checkout` | 🎣 preencheu dados no checkout e saiu | recuperação quente + cupom |
| `clicou_comprar_e_sumiu` | 🎣 deu e-mail no popup e não chegou a tentar pagar | recuperação quente |
| `so_deu_email_na_saida` | 🌱 só deixou e-mail no popup de saída | nutrição fria + cupom |

Prioridade: quem tem mais de um evento fica com o MAIS forte (ex.: recusou ontem e comprou hoje = `comprou`).

## Endpoints auxiliares

- **Catálogo de produtos aprendido:** `GET /api/lead?pidmap=1&token=...` → `{ok, total, map}` onde `map` é
  `{"ebook:versao": {pid, pnm}, "ebook": {pid, pnm}, ...}` (ex.: `escorpiao1:ru` → pid do produto russo do
  Escorpião). O mapa se alimenta SOZINHO dos webhooks — todo produto com pelo menos 1 evento de checkout
  rastreado aparece aqui. Use pra descobrir os pids de uma linha inteira (zodíaco etc.) sem pedir manualmente.

- **Leads crus (sem classificação):** `GET /api/lead?token=...&n=1000` → cada captura dos popups
  (`org` = `exit_intent` | `eu_quero`; pode ter 2 registros da mesma pessoa se ela "esquentou").
- **Gravação (usado pelos popups — a automação NÃO precisa):** `POST /api/lead` body JSON
  `{em, org, pid, pnm, lang, ok, e, vs, c}` — dedup automático por (origem, e-mail, dia).

## Recomendações de consumo

1. **Polling**: a cada 15–30 min é suficiente (o abandono da Hotmart chega com até ~30-60 min de atraso).
2. **Delta**: guarde o maior `ts` processado e, na próxima leitura, processe só `ts` maiores.
3. **Chave**: trate `em` (e-mail) como identidade única da pessoa.
4. **Re-classificação**: o `estagio` de uma pessoa PODE evoluir entre leituras (ex.: `pix_boleto_nao_pago` → `comprou`). Sempre respeite o estágio mais recente — especialmente `comprou` (pare a sequência!).
5. Janela: eventos fora dos últimos `days` dias saem da lista (não significa que a pessoa sumiu do banco).

## Observações

- **pid/pnm garantidos (12/07/2026):** o servidor mantém um MAPA ebook→produto aprendido automaticamente dos webhooks da Hotmart. Leads novos são **carimbados na gravação** e leads antigos ganham pid/pnm **retroativamente na leitura da jornada**. Um lead só fica sem `pid` se aquele ebook/versão nunca gerou NENHUM evento de checkout rastreado (raríssimo e temporário: no primeiro evento, todos os leads dele ganham o pid).
- E-mails de venda aprovada e telefone só existem nos registros **novos** (pós 10/07/2026) — o histórico antigo não tem.
- Tem 2 leads de teste `...@example.com` no banco ("pode apagar") — filtrar `@example.com` se incomodar.
- O e-mail do lead = e-mail da transação Hotmart (o popup pré-preenche o checkout), então o cruzamento é confiável.
