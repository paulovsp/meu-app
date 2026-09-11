---
name: design
description: A produção das artes das peças do Dr.Sig — cada imagens.md vira quadros.json e PNGs 1080×1350 no kit da marca, pelo renderizador marketing/designer/render.mjs do repositório do site. Use toda quarta-feira (depois da redação de terça), ou com "/design <pasta-da-peça>" para uma peça avulsa.
---

# Design

Delegue ao agente **designer** (`.claude/agents/designer.md`). Se `$ARGUMENTS` trouxer uma pasta, trabalhe só essa peça.

Os arquivos vivem em `drsig-site/marketing/`. O renderizador precisa de Node e do Chromium do Playwright.

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"designer"}` → guarde o `id`.
2. Prepare o renderizador uma vez por sessão, dentro de `drsig-site/marketing/designer/`: `npm install --silent && npx playwright install chromium`. Se falhar, escreva o relatório dizendo isso e pare.
3. Liste as peças em `marketing/pendente/` e `marketing/aprovado/` que têm `imagens.md` e **não** têm `quadros.json` (ou cujo `peca.md` não diz `arte: pronta`). Peças só de texto (LinkedIn sem imagem, e-mail, artigo) não precisam de arte: pule e diga no relatório.
4. Para cada peça, siga o perfil: `quadros.json` → `node marketing/designer/render.mjs <pasta>` → conferir dois PNGs → anotar `arte:` no `peca.md`.
5. `marketing/designer/AAAA-MM-DD.md` com uma linha por peça e a lista de capturas pendentes (nome do arquivo esperado em `marketing/capturas/`). Commit e push no repositório do site.
6. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/designer/AAAA-MM-DD.md","resumo":"N peças, M quadros, K capturas pendentes"}`. Se alguma peça não renderizou, `resultado: "amarelo"`.

## Resposta ao dono

Por peça: quantos quadros, e o caminho do primeiro PNG. Depois, só se houver, a lista de capturas que ele precisa tirar na conta de demonstração, com o nome exato do arquivo.
