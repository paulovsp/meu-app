---
name: estrategia
description: O plano mensal de divulgação do Dr.Sig — diagnóstico do funil, meta, canais, temas, orçamento por canal, o que parar — escrito em marketing/plano/AAAA-MM.md no repositório do site (drsig-site). Use no dia 1 de cada mês, ou com "/estrategia AAAA-MM".
---

# Estratégia

Delegue ao agente **estrategista** (`.claude/agents/estrategista.md`). O mês é `$ARGUMENTS` (`AAAA-MM`); sem argumento, o mês atual.

Os arquivos de divulgação vivem no repositório do site (`drsig-site`, pasta `marketing/`); o app fica em `meu-app`. Numa sessão local, os dois estão lado a lado em `C:\Users\USER\Documents\`; na nuvem, os dois vêm como fontes da rotina.

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"estrategista"}` → guarde o `id`.
2. `{"acao":"funil","dias":35}`; leia `marketing/analise/` (último), `marketing/plano/` (anterior), `marketing/publicado/`, `marketing/ORCAMENTO.md`, `KIT-DA-MARCA.md`.
3. Escreva `marketing/plano/AAAA-MM.md` com as sete seções do perfil.
4. Commit no repositório do site: `git add marketing && git commit -m "plano: AAAA-MM"` e push.
5. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/plano/AAAA-MM.md","resumo":"<a meta do mês em uma linha>"}`.
6. `avisar_dono` com a seção "Pedidos ao dono" — sempre, porque o plano precisa do "sim" dele para virar peças e gasto.

## Resposta ao dono

A meta, os canais com o esforço de cada um, e os pedidos numerados.
