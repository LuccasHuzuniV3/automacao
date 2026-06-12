# Páginas de venda (multi-ebook, multi-país) com rastreio de SRC

Um **template** (`index.html`) que serve **N ebooks × N países × N canais**, repassando o
`src` pro checkout da Hotmart com o **país embutido**. Você edita tudo no **painel** (`builder.html`).

## Arquivos

| Arquivo | O que é |
|---|---|
| `builder.html` | **O PAINEL** — cria/edita/traduz, escolhe imagens do PC, prévia e exporta. |
| `index.html` | A página pública (o molde). Não precisa editar. |
| `ebooks.js` | Os dados (gerado pelo painel). |
| `deploy.bat` | **Publica na Vercel** com 1 duplo clique. |
| `vercel.json` / `.vercelignore` | Config do deploy. |

## Como usar (passo a passo)

1. Abra o **`builder.html`** (duplo clique).
2. Escolha o ebook (abas no topo) e o país. Preencha os textos.
3. Nas **imagens**, clique em **📁 PC** e escolha a foto do computador (ou cole uma URL).
4. Outro idioma: crie o país (**+ País**), defina o **Idioma** (ex.: `en-US`) e clique em **🌐 Traduzir** — depois revise e ajuste preços/moeda.
5. Veja a **prévia ao vivo** do lado.

## Publicar na Vercel (1 duplo clique)

**Agora** (a página Arcturianos já está pronta na pasta): dê **duplo clique no `deploy.bat`**.
- 1ª vez: instala a CLI da Vercel e pede login (abre o navegador).
- Depois: duplo clique → publica e mostra o link.

**Depois de editar no painel** (textos/imagens novas):
1. No painel, clique em **⬇ Baixar site (.zip)**.
2. **Extraia o zip POR CIMA** da pasta `thesalomoncode-landing` (substitui `ebooks.js` e `img/`).
3. Duplo clique no **`deploy.bat`** de novo.

> Só mudou texto? Clique em **ebooks.js** no painel, substitua o arquivo na pasta e rode o `deploy.bat`.
> O domínio `thesalomoncode.com` você aponta 1 vez no painel da Vercel (Settings → Domains).

## Links pra divulgar (o que vai no YouTube)

O painel tem o **gerador de link** embaixo da prévia. O formato é:

```
https://thesalomoncode.com/?ebook=<ebook>&pais=<pais>&src=<canal>_<tema>

exemplos:
https://thesalomoncode.com/?ebook=invidie&pais=br&src=jazzlofi_ansiedade
https://thesalomoncode.com/?ebook=salomao&pais=us&src=lofibeats_focus
```

Quem posta **não digita o país** no src — a página coloca sozinha.
Na Hotmart a venda aparece como `br_jazzlofi_ansiedade`, `us_lofibeats_focus`, etc.
(Relatório por SRC no painel da Hotmart = sua "planilha" automática, por produto.)

## O que trocar antes de publicar

1. No painel, em cada país, troque o **Link do checkout Hotmart** pelo real (um por país/moeda).
2. Preencha as **imagens** (capa, bônus, bundle, selo, atendente) via 📁 PC.
3. Ajuste os **textos** (e traduções por país).

## Conferir o rastreio (sem aparecer pro cliente)

Adicione `&debug=1` na URL (ex.: `index.html?ebook=invidie&pais=br&debug=1`) pra ver
qual `src` está sendo enviado. O comprador nunca vê esse painel.
