---
name: curadoria
description: A proposta semanal de publicação do Dr.Sig — que peça sai em que dia, de segunda a domingo, em marketing/semana/AAAA-MM-DD.md no repositório do site, com e-mail ao dono mostrando as imagens para ele aprovar na conversa. Use toda sexta-feira.
---

# Curadoria

Delegue ao agente **publicador** (`.claude/agents/publicador.md`), seção "Sexta: a proposta da semana".

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"publicador"}` → guarde o `id`.
2. `{"acao":"midias_meta","canal":"ambos"}` e `marketing/PENDENCIAS.md`: o estado do perfil (carrosséis, posts únicos, posts sem registro, pendências abertas). Isso abre a proposta.
3. Leia `marketing/plano/AAAA-MM.md`, `marketing/pendente/` e `marketing/aprovado/`. Só peça com `arte: pronta` entra na proposta. Nada de `substitui:` no Instagram; correção vira peça nova mais pendência de apagar a antiga.
4. Escreva `marketing/semana/AAAA-MM-DD.md` (data da segunda-feira seguinte): estado do perfil e pendências primeiro, tabela da semana depois. Commit e push no repositório do site.
5. `{"acao":"avisar_dono","agente":"publicador","assunto":"Semana de DD/MM: N peças para aprovar","corpo_html":…}` com a tabela, a primeira imagem de cada peça e as pendências com link.
6. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/semana/AAAA-MM-DD.md","resumo":"N peças propostas, P pendências do dono"}`. Sem peça pronta: `resultado: "amarelo"` e o e-mail diz isso.

## Resposta ao dono

O estado do perfil em uma linha, as pendências com link, a tabela da semana e a frase: "Responda 'aprovo a semana', 'aprovo menos X' ou 'muda X para quinta'".

## Depois da resposta do dono (isto é do Claude na conversa, não da rotina)

Mostrar ao dono a proposta com as imagens (página de aprovação, não só texto). Para cada peça aprovada: acrescentar `publicar_em: AAAA-MM-DD` ao cabeçalho de `peca.md` e mover a pasta para `marketing/aprovado/`; recusada vai para `recusado/` com a razão. Pendências que o dono disser que fez: conferir com `midias_meta` e riscar em `PENDENCIAS.md`. Commit e push.
