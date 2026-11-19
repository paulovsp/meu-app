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
4. Escreva `marketing/analise/AAAA-MM-DD.md`. **A primeira coisa do arquivo é o resumo para o Paulo** (seção abaixo); a análise detalhada vem depois dele, para quem quiser conferir. Commit e push no repositório do site (`git add marketing && git commit -m "analise: AAAA-MM-DD"`).
5. `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"drsig-site/marketing/analise/AAAA-MM-DD.md","resumo":"<cadastros → assinaturas da semana, em uma linha>"}`.

## Resumo para o Paulo (topo do relatório)

Desde 19/11/2026 o plano de divulgação mede a semana por quatro números.
O Paulo é psicanalista e não é da área de tecnologia: o resumo é em
português simples, sem nome de tabela, de ação, de código ou de sistema.

```
## Resumo da semana (DD/MM a DD/MM)

- Convites enviados: N   (os links de convite; "sem dado" enquanto não existirem)
- Instalações: N
- Cadastros novos: N   (de onde vieram, em palavras: "2 por indicação, 1 pelo Google")
- Assinantes novos: N   (e quantos pagam hoje, no total)

<Uma frase: o que isso quer dizer. Se um número parou, uma frase com o que mudar.>
```

Dia sem linha em `op_funil` não é dado perdido de cadastro: a função
`funil_hoje` só grava dia com movimento, então, nos dias em que a ronda rodou, dia sem linha é zero
cadastro. O que atrasa é a linha `loja` (instalações), porque o relatório
do Google Play chega com atraso. Diga "as instalações dos últimos N dias
ainda não chegaram do Google Play", numa linha, e não trate como incidente.

## Resposta ao dono

O resumo para o Paulo, igual ao do topo do relatório. Nada mais.
