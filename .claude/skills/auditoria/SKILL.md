---
name: auditoria
description: A auditoria semanal do Dr.Sig — políticas e grants contra o snapshot, tabelas sem RLS, funções públicas, contas anômalas, segredos no repositório, consistência de deploy. Só lê; cada diferença vira incidente. Use toda sexta-feira, ou depois de qualquer migration.
---

# Auditoria

Delegue ao agente **auditor** (`.claude/agents/auditor.md`).

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"auditor"}` → guarde o `id`.
2. `{"acao":"politicas"}` → compare com `supabase/checks/politicas-esperadas.json` (mesmas colunas: tipo, objeto, nome, detalhe, regra). Liste: só no banco, só no snapshot, diferentes.
3. `{"acao":"auditoria"}` → cada contagem ≠ 0 precisa de explicação conhecida (a conta de demonstração é uma cortesia longa; convites pendentes são esperados enquanto testadoras não se cadastram). O resto vira incidente.
4. Segredos: `git grep -nE "(sk_live|sb_secret|service_role|whsec_|APP_USR-|eyJhbGciOi)" -- . ':!*.md' ':!operacao'`.
5. Deploy: para cada pasta em `supabase/functions/*/` (menos `_shared`), confira a entrada em `supabase/config.toml` e a linha em `supabase/functions/DEPLOY.md`.
6. Escreva `operacao/auditoria/AAAA-MM-DD.md` (conferido · resultado · evidência) e faça commit.
7. Incidentes com `{"acao":"abrir_incidente",…,"aberto_por":"auditor"}`; `avisar_dono` se algum for `critico`.
8. `{"acao":"rodada","id":…,"resultado":…,"relatorio_path":…,"resumo":…}`.

## Resposta ao dono

Veredito e a lista de diferenças (ou "nenhuma"), com o caminho do relatório.
