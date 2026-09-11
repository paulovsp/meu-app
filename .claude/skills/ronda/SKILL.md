---
name: ronda
description: A ronda diária de manutenção do Dr.Sig — lê o estado das últimas 24 h, abre incidentes, escreve operacao/ronda/AAAA-MM-DD.md e avisa o dono só se houver amarelo ou vermelho. Use todo dia de manhã, ou quando o dono perguntar como está o app.
---

# Ronda

Delegue ao agente **vigia** (`.claude/agents/vigia.md`) com estas instruções, e devolva ao dono só o veredito e o caminho do relatório.

## Passos

1. Carregue as credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL` do ambiente ou de `.env` na raiz. Sem `OP_SECRET`, pare e diga que a ronda não pode rodar.
2. Chamada base (todas as ações são `POST` na mesma URL):
   ```bash
   curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/op-agente" \
     -H "Content-Type: application/json" -H "x-op-secret: $OP_SECRET" \
     -d '{"acao":"rodada","agente":"vigia"}'
   ```
   Guarde o `id` da rodada.
3. `{"acao":"resumo","horas":24}` → o estado. Se `incidentesAbertos` tiver algo com mais de 7 dias, isso conta para a régua.
4. Aplique a régua do perfil do vigia. Para cada grupo `erro`/`critico` sem incidente aberto da mesma `origem`: `{"acao":"abrir_incidente","titulo":"<origem>: <mensagem curta>","severidade":"erro|critico","origem":"<origem>","resumo":"<vezes> ocorrências desde <primeira>; último em <ultimo>","evento_ids":[...],"aberto_por":"vigia"}`. Para grupos `aviso`/`info`: `{"acao":"marcar_eventos","ids":[...]}`.
5. `{"acao":"funil_hoje"}` — grava o funil do dia (é barato e mantém a série completa).
6. Escreva `operacao/ronda/AAAA-MM-DD.md` no formato do perfil (data de hoje em Brasília). Faça commit: `git add operacao && git commit -m "ronda: AAAA-MM-DD · VERDE|AMARELO|VERMELHO"`. Não faça push se o ambiente não tiver permissão; diga isso no fim.
7. `{"acao":"rodada","id":<id>,"resultado":"verde|amarelo|vermelho","relatorio_path":"operacao/ronda/AAAA-MM-DD.md","resumo":"<as três linhas>"}`.
8. Se amarelo ou vermelho: `{"acao":"avisar_dono","agente":"vigia","assunto":"Ronda DD/MM: AMARELO|VERMELHO","corpo_html":"<p>…as três linhas…</p><ul><li>…cada incidente aberto hoje…</li></ul>"}`.

## Resposta ao dono

Uma linha com o veredito, as três linhas do relatório, e o caminho do arquivo. Nada mais.
