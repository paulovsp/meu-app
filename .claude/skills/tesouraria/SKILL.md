---
name: tesouraria
description: O fechamento mensal do Dr.Sig — receita do Mercado Pago, custo de IA, brindes, contas por status, câmbio e preços dos fornecedores contra as constantes do código; propostas de ajuste e PR só das constantes com fonte pública. Use no dia 1 de cada mês para o mês anterior, ou com "/tesouraria AAAA-MM".
---

# Tesouraria

Delegue ao agente **tesoureiro** (`.claude/agents/tesoureiro.md`). O mês é `$ARGUMENTS` (`AAAA-MM`); sem argumento, o mês anterior ao atual.

## Passos

1. Credenciais: `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. `{"acao":"rodada","agente":"tesoureiro"}` → guarde o `id`.
2. `{"acao":"financeiro","mes":"AAAA-MM"}`.
3. Leia as constantes: `precificacaoIA.ts`, `precificacaoDeepSeek.ts`, `margemCobranca.ts`, `creditoDoPlano.ts`, `indicacoes.ts` em `supabase/functions/_shared/`.
4. Preços públicos dos fornecedores (WebFetch), com data.
5. Calcule o que o perfil pede (custo real, margem por plano, câmbio, diferenças de preço). Estimativas marcadas como tal.
6. Escreva `operacao/tesouraria/AAAA-MM.md` e faça commit.
7. PR só para constantes com fonte pública (branch `tesouraria/AAAA-MM`; `jest` + `eslint` antes). Preço de plano e multiplicador ficam como proposta no relatório.
8. `avisar_dono` nos casos do perfil; `{"acao":"rodada","id":…}` para fechar.

## Resposta ao dono

Receita, custo de IA, margem por plano, e as propostas numeradas — cinco linhas no máximo, mais o caminho do relatório.
