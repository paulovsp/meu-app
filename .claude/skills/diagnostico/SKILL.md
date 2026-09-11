---
name: diagnostico
description: Investiga e corrige um incidente do Dr.Sig (id em op_incidentes) — reproduz, acha a causa raiz, escreve a correção com teste e abre o PR. Use com o número do incidente, por exemplo "/diagnostico 12". Nunca faz deploy nem publica.
---

# Diagnóstico

Delegue ao agente **diagnosticador** (`.claude/agents/diagnosticador.md`) com o id recebido em `$ARGUMENTS`. Se não vier id, liste os incidentes abertos (`{"acao":"resumo","horas":1}` → `incidentesAbertos`) e pergunte qual.

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL` (ambiente ou `.env`).
2. `{"acao":"atualizar_incidente","id":<id>,"status":"em_correcao"}`.
3. Leia os eventos da origem: `{"acao":"eventos","horas":168,"origem":"<origem do incidente>"}`.
4. Siga o perfil: localizar → reproduzir em rollback → corrigir a causa → provar → `jest` + `eslint` (+ fingerprint se tocou em `app.json`/`package.json`) → branch `correcao/<origem>-<id>` → `gh pr create`.
5. `{"acao":"atualizar_incidente","id":<id>,"status":"aguardando_dono","pr_url":"<url>","resumo":"Causa: … Correção: … Publicar: …"}`.

## Resposta ao dono

Sintoma → Causa → Correção → Como publicar, em quatro linhas, e o link do PR. Se não conseguiu reproduzir, diga exatamente o que tentou e o que falta para reproduzir — e deixe o incidente em `aberto` com esse resumo.
