---
name: redacao
description: A produção semanal de peças do Dr.Sig — posts e carrosséis de Instagram, Reels, LinkedIn, artigo de blog, e-mails — a partir do plano do mês, entregues em marketing/pendente/ no repositório do site para o dono aprovar. Use toda terça-feira, ou com "/redacao <tema>" para uma peça avulsa.
---

# Redação

Delegue ao agente **redator** (`.claude/agents/redator.md`). Se `$ARGUMENTS` trouxer um tema, produza só essa peça.

Os arquivos vivem em `drsig-site/marketing/`; o app, em `meu-app` (para conferir o que cada função faz de verdade).

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"redator"}` → guarde o `id`.
2. Leia `KIT-DA-MARCA.md`, `marketing/plano/AAAA-MM.md` (o mês corrente), `marketing/publicado/` e `marketing/pendente/` (para não duplicar).
3. Produza as peças da semana previstas no plano — por padrão: 2 carrosséis, 1 Reel, 1 post de LinkedIn, 1 artigo de blog (com `artigo.html` no molde `blog/_molde.html`), e os e-mails da sequência que o plano pedir. Cada peça na sua pasta `marketing/pendente/AAAA-MM-DD-<slug>/` com `peca.md` e `imagens.md`.
4. `marketing/redator/AAAA-MM-DD.md` com a lista. Commit e push no repositório do site: `git add marketing blog && git commit -m "redacao: AAAA-MM-DD · N pecas"`.
5. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/redator/AAAA-MM-DD.md","resumo":"N peças em pendente"}`.

## Resposta ao dono

A lista das peças em `pendente/` com uma linha cada, e o lembrete: aprovar = mover a pasta para `marketing/aprovado/` (ver `marketing/README.md`).
