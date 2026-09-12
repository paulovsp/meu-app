---
name: curadoria
description: A proposta semanal de publicação do Dr.Sig — que peça sai em que dia, de segunda a domingo, em marketing/semana/AAAA-MM-DD.md no repositório do site, com e-mail ao dono mostrando as imagens para ele aprovar na conversa. Use toda sexta-feira.
---

# Curadoria

Delegue ao agente **publicador** (`.claude/agents/publicador.md`), seção "Sexta: a proposta da semana".

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"publicador"}` → guarde o `id`.
2. Leia `marketing/plano/AAAA-MM.md`, `marketing/pendente/` e `marketing/aprovado/`. Só peça com `arte: pronta` entra na proposta.
3. Escreva `marketing/semana/AAAA-MM-DD.md` (data da segunda-feira seguinte). Commit e push no repositório do site.
4. `{"acao":"avisar_dono","agente":"publicador","assunto":"Semana de DD/MM: N peças para aprovar","corpo_html":…}` com a tabela e a primeira imagem de cada peça.
5. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/semana/AAAA-MM-DD.md","resumo":"N peças propostas"}`. Sem peça pronta: `resultado: "amarelo"` e o e-mail diz isso.

## Resposta ao dono

A tabela da semana e a frase: "Responda 'aprovo a semana', 'aprovo menos X' ou 'muda X para quinta'".

## Depois da resposta do dono (isto é do Claude na conversa, não da rotina)

Para cada peça aprovada: acrescentar `publicar_em: AAAA-MM-DD` ao cabeçalho de `peca.md` e mover a pasta para `marketing/aprovado/`; recusada vai para `recusado/` com a razão. Commit e push.
