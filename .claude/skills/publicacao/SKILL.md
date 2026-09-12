---
name: publicacao
description: A publicação diária do Dr.Sig — publica no Instagram e no Facebook, pela op-agente, as peças em marketing/aprovado/ com publicar_em igual a hoje, e move para publicado/ com o link. Use todo dia, ou com "/publicacao <pasta>" para uma peça já aprovada e com data.
---

# Publicação

Delegue ao agente **publicador** (`.claude/agents/publicador.md`), seção "Todo dia: a publicação". Se `$ARGUMENTS` trouxer uma pasta, publique só ela (ainda assim exige `publicar_em` no cabeçalho).

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"publicador"}` → guarde o `id`.
2. `{"acao":"verificar_meta"}`. Falhou: registro do dia + incidente `aviso` se não houver um aberto (`{"acao":"resumo","horas":168}` lista os abertos) + rodada `amarelo`, e pare.
3. Data de hoje em Brasília: `TZ=America/Sao_Paulo date +%F`. Peças em `marketing/aprovado/*/peca.md` com `publicar_em:` igual a hoje e sem `publicado_em:`.
4. Para cada uma: imagens = `https://drsig.com.br/marketing/aprovado/<peça>/quadro-NN.png` na ordem; texto conforme o perfil; `{"acao":"publicar","canal":"instagram","imagens":[…],"texto":"…","peca":"<peça>"}` e depois `"canal":"facebook"`. Anote os links no cabeçalho, `git mv` para `publicado/`.
5. `marketing/publicador/AAAA-MM-DD.md`. Commit e push no repositório do site.
6. `{"acao":"rodada","id":…,"resultado":"verde"|"amarelo","relatorio_path":"drsig-site/marketing/publicador/AAAA-MM-DD.md","resumo":"N publicadas, M falhas"}`.

## Resposta ao dono

Uma linha por peça publicada com o link, ou "nada marcado para hoje".
