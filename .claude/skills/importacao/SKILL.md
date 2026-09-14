---
name: importacao
description: A importação do consultório (Google Drive → app) do Dr.Sig, pelo Arquivista — uma pasta de analisante por rodada vira um doc de proposta no Drive para o dono aprovar; as aprovadas são gravadas na conta dele pela op-agente. Use com "/importacao ler" (próxima pasta), "/importacao ler <nome>" (uma pasta específica) ou "/importacao gravar" (todas as aprovadas).
---

# Importação do consultório

Delegue ao agente **arquivista** (`.claude/agents/arquivista.md`). Precisa do conector Google Drive (nesta sessão ou na rotina) e das credenciais `OP_SECRET` e `EXPO_PUBLIC_SUPABASE_URL`. A conta do dono é `paulovsp@gmail.com`.

## `/importacao ler [nome]`

1. `{"acao":"rodada","agente":"arquivista"}` → guarde o `id`.
2. Ache a pasta "Clínica" e, dentro dela, a pasta "Dr.Sig · importação" (crie se não existir) e o doc `00 · Painel.md` (crie se não existir, com a tabela vazia e a Lista Geral numerada).
3. Escolha a pasta: a indicada em `nome`, ou a primeira da Lista Geral sem estado no Painel. Liste os arquivos dela (paginar até o fim) e leia cada um (Docs, PDFs com texto; imagens e PDFs digitalizados só listam).
4. Escreva `Proposta · <Nome>` como diz o perfil, e atualize o Painel (estado `proposta`).
5. Relatório com números em `operacao/importacao/AAAA-MM-DD.md` (commit e push) e `{"acao":"rodada","id":…,"resultado":"verde","relatorio_path":"…","resumo":"pasta nº N: A arquivos, R registros propostos, P perguntas"}`.

## `/importacao gravar`

1. Rodada como acima. No Painel, pegue as linhas em estado `aprovada`.
2. Para cada uma: leia o doc de proposta com as respostas do dono; monte `ficha` e `registros[]` (`fonte` = id do arquivo do Drive; `data` AAAA-MM-DD; `categoria` sessao|estudo; `conteudo` = "Anotação original" + linha em branco + "Leitura organizada", exatamente como no doc); `importar_analisante` em `modo:"ensaio"`; se os números baterem com o doc, `modo:"gravar"`; marque `importada` no Painel com os números.
3. Relatório só com números; rodada `verde`, ou `amarelo` se alguma parou em erro.

## Resposta ao dono

Depois de `ler`: o link do doc de proposta e a lista de perguntas. Depois de `gravar`: quantas analisantes e quantos registros entraram, e quantas propostas ainda esperam aprovação.
