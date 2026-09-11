---
name: analise
description: O painel semanal do funil de divulgação do Dr.Sig — cadastros, assinaturas e cancelamentos por origem, conversão, custo por assinante quando houver gasto, indicação — com três recomendações, em marketing/analise/AAAA-MM-DD.md no repositório do site. Use toda segunda-feira.
---

# Análise

Delegue ao agente **analista** (`.claude/agents/analista.md`).

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"analista"}` → guarde o `id`.
2. `{"acao":"funil","dias":28}`. Leia `marketing/gastos/AAAA-MM.md` (se existir) e `marketing/publicado/`.
3. Calcule o que o perfil pede; o que não dá para calcular, diga por quê (sem estimar).
4. Escreva `marketing/analise/AAAA-MM-DD.md`; commit e push no repositório do site (`git add marketing && git commit -m "analise: AAAA-MM-DD"`).
5. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/analise/AAAA-MM-DD.md","resumo":"<cadastros → assinaturas da semana, em uma linha>"}`.

## Resposta ao dono

A tabela por origem e as três recomendações. Nada mais.
