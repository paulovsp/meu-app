# Sistema de manutenção técnica — arquitetura

Versão de 17/09/2026, escrita a partir do que existe (rotinas na nuvem,
agentes em `.claude/`, a função `op-agente`, as tabelas `op_*`). Serve para
o dono enxergar o todo antes de redesenhar. Não propõe nada: descreve.

## 1. Para que serve

Manter o Dr.Sig de pé sem que o dono precise olhar painel nenhum: perceber
erro antes da usuária, tratar o que chega dela, conferir segurança e
dependências, fechar o mês em números, corrigir com PR. O dono só aparece
para decidir (aprovar PR, deploy, migration, build, dinheiro) e para o que
só ele pode fazer (senhas, lojas, contas de terceiros).

## 2. As seis camadas

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ 6. DONO  ── chat com o Claude (PC ou celular) · e-mail · celular   │
 ├──────────────────────────────────────────────────────────────────┤
 │ 5. REGISTRO ── git: operacao/<agente>/AAAA-MM-DD.md · PRs          │
 ├──────────────────────────────────────────────────────────────────┤
 │ 4. AGENTES ── .claude/agents/*.md (quem) + .claude/skills (como)   │
 │    rodam em: rotina na nuvem (cron)  ou  sessão local (Claude)     │
 ├──────────────────────────────────────────────────────────────────┤
 │ 3. PORTA ── Edge Function op-agente (x-op-secret), 21 ações        │
 ├──────────────────────────────────────────────────────────────────┤
 │ 2. MEMÓRIA DA OPERAÇÃO ── Postgres: op_eventos, op_incidentes,     │
 │    op_rodadas, op_feedbacks, op_backlog, op_funil + funções op_*   │
 ├──────────────────────────────────────────────────────────────────┤
 │ 1. O APP ── Supabase (banco, auth, storage, 34 Edge Functions,     │
 │    cron), Expo/Play, Mercado Pago, Resend, AssemblyAI/DeepSeek…    │
 └──────────────────────────────────────────────────────────────────┘
```

- **Camada 1, o app.** Cada Edge Function passa por `servir()`
  (`_shared/registrarEvento.ts`): toda resposta 5xx vira uma linha em
  `op_eventos`, sem ninguém precisar lembrar de logar. É o único sensor
  automático que existe hoje. O que não é 5xx (uma página que falha no
  navegador, um app que trava) não gera sinal.
- **Camada 2, a memória.** `op_eventos` (o que aconteceu), `op_incidentes`
  (o que precisa de tratamento; estados aberto → em_tratamento →
  aguardando_dono → fechado), `op_rodadas` (cada execução de agente: início,
  resultado verde/amarelo/vermelho, relatório), `op_feedbacks` (o que as
  usuárias mandaram), `op_backlog` (sugestões), `op_funil` (cadastros,
  assinaturas, instalações por origem e dia). As funções `op_*` são consultas
  prontas (políticas RLS, auditoria, cron com falha, status de assinaturas).
- **Camada 3, a porta.** `op-agente` é a única forma de um agente ler ou
  escrever isso: segredo de operação no cabeçalho, nunca a chave de serviço.
  Ações de manutenção: `resumo`, `eventos`, `marcar_eventos`,
  `abrir_incidente`, `atualizar_incidente`, `adicionar_backlog`,
  `registrar_feedback`, `feedbacks_pendentes`, `classificar_feedback`,
  `rodada`, `politicas`, `auditoria`, `financeiro`, `funil_hoje`,
  `instalacoes`, `avisar_dono` (e-mail ao dono).
- **Camada 4, os agentes.** Um perfil por papel (o que faz, o que nunca
  faz) e uma skill por tarefa (o passo a passo). O mesmo perfil roda de dois
  jeitos: numa rotina na nuvem, sem o dono, ou na conversa, quando o dono
  chama `/ronda`, `/diagnostico 5`, etc.
- **Camada 5, o registro.** Cada rodada deixa um arquivo em `operacao/` (só
  contagens e ids, nunca dado de usuária) e um commit. Correções chegam
  como PR, nunca como deploy.
- **Camada 6, o dono.** Hoje recebe e-mail (`avisar_dono`) quando algo é
  amarelo/vermelho e responde na conversa com o Claude. É a camada que
  falhou no lançamento: e-mail não é onde o dono vive.

## 3. Quem faz o quê, e quando

| Agente | Cadência (Brasília) | Lê | Escreve | Chama o dono quando |
|---|---|---|---|---|
| **Vigia** (ronda) | todo dia 07:00 | eventos 24 h, cron, pagamentos, IA, feedbacks | `operacao/ronda/`, incidentes | ronda amarela ou vermelha |
| **Zelador** (atendimento) | todo dia 08:00 | `op_feedbacks` pendentes | classificação, incidente ou backlog, rascunho de resposta | sempre que há resposta a enviar (ele nunca envia) |
| **Guardião** (dependências) | segunda 09:00 | package.json, Expo, Play, fornecedores | `operacao/dependencias/`, PR de baixo risco | descontinuação ou prazo |
| **Auditor** | sexta 09:00 | políticas RLS × snapshot, grants, funções públicas, segredos no repo, deploy | `operacao/auditoria/`, incidentes | diferença crítica |
| **Tesoureiro** | dia 1, 09:00 | Mercado Pago, custo de IA, câmbio, preços | fechamento do mês, PR só de constantes | proposta de preço/margem |
| **Diagnosticador** | sob demanda (`/diagnostico N`) | um incidente | reprodução, causa raiz, correção + teste, **PR** | sempre: o PR é dele para aprovar |
| **Arquivista** (importação) | sob demanda (`/importacao`) | Google Drive "Clínica" | proposta no Drive; `importar_analisante` só depois do "aprovo" | toda proposta |
| **pré-voo** (lista, não agente) | antes de OTA/build | fingerprint, testes, lint, migrations, deploy, páginas, partida das funções | `operacao/pre-voo/` | veredito "voa"/"não voa" |

Modelos: Vigia, Zelador, Guardião, Auditor, Tesoureiro em Sonnet;
Diagnosticador e Arquivista em Opus.

## 4. O ciclo de um problema

```
 erro 5xx ──servir()──▶ op_eventos ──Vigia(07:00)──▶ op_incidentes (aberto)
                                                      │
                            e-mail ao dono ◀── amarelo/vermelho
                                                      │
              dono: "/diagnostico N" ──▶ Diagnosticador ──▶ PR + teste
                                                      │
              dono: "aprovo o PR" ──▶ merge ──▶ Claude: deploy ──▶ incidente fechado
```

O que **não** entra nesse ciclo hoje: falha que a usuária vê e o servidor
não (página que mostra "link expirou" por engano, app que não avisa),
função que não sobe (503 na partida; só entrou na lista em 17/09), e
qualquer coisa que dependa de o dono ler o e-mail.

## 5. O que só o dono faz

Aprovar PR e migration; `eas update`/`eas build` (dinheiro e loja);
senhas, tokens e PINs; Play Console e App Store Connect; contas de
terceiros (Meta, Google, Apple, UOL); responder usuárias em nome da
Dr.Sig; qualquer decisão de preço.

## 6. Limites externos que moldam o desenho

- Supabase: cron mínimo de 1 min; Edge Function sem estado; logs só no
  painel (o CLI não lê).
- Rotinas na nuvem: intervalo mínimo de 1 h; sem acesso à máquina do dono;
  conectores só os do claude.ai; cada rotina nasce com conectores
  padrão que precisam ser limpos.
- Sessão local: só ela faz deploy, migration e OTA; o modo automático
  bloqueia algumas escritas externas (apagar posts, por exemplo).
- Play: instalações só agregadas, com atraso de um dia; relatório em
  massa por conta de serviço (acesso ainda em propagação).

## 7. Fragilidades conhecidas (17/09/2026)

1. O laço de volta ao dono é por e-mail, que ele não lê.
2. Só 5xx de servidor vira evento; erro de página/app não.
3. Push do Android nunca funcionou (sem Firebase); v25 resolve.
4. Um erro esperado (publicação recusada) vira 502 e duplica incidente.
5. Contas de teste entram no funil.
6. As respostas das usuárias vão para a caixa do UOL, fora de
   `op_feedbacks`, até o recebimento pela Resend ser ligado.

## 8. Mapa mental

```mermaid
mindmap
  root((Manutenção técnica))
    Sensores
      servir() em toda Edge Function → op_eventos
      cron do Postgres → op_cron_falhas
      Resend webhook → bounce, spam, recebido
      Mercado Pago webhook → pagamentos
    Memória
      op_eventos
      op_incidentes
      op_rodadas
      op_feedbacks
      op_backlog
      op_funil
    Porta única
      op-agente
        x-op-secret
        21 ações
    Agentes
      Vigia · ronda diária
      Zelador · atendimento diário
      Guardião · dependências semanal
      Auditor · segurança semanal
      Tesoureiro · fechamento mensal
      Diagnosticador · sob demanda → PR
      Arquivista · importação do Drive
    Onde rodam
      Rotinas na nuvem (cron, Sonnet/Opus)
      Sessão local (skills /ronda, /diagnostico…)
    Registro
      operacao/<agente>/AAAA-MM-DD.md
      PRs no GitHub
    Dono
      e-mail avisar_dono (hoje)
      chat com o Claude (decisões)
      só ele: PR, deploy, build, senhas, lojas
```

Arquivo irmão: `drsig-site/marketing/ARQUITETURA.md` (divulgação).
