# Dr.Sig — status do projeto

Este arquivo existe pra uma coisa só: colar no início de qualquer conversa nova
com uma IA (Claude Code, chat, o que for) e ela entender rápido o que é este
projeto, onde as coisas estão, e como este trabalho tem sido feito até aqui.
Atualizado em 22/08/2026.

## O que é

Dr.Sig é um app de prontuário, agenda e gestão financeira/fiscal pra
profissionais de **psicanálise** (não terapia genérica — o vocabulário do
app inteiro usa "analisante", "análise", "paralização da análise", etc.).
Quem cadastra é a psicanalista/psicanalista; quem ela cadastra é o
analisante (paciente). O projeto nasceu como uma ferramenta pessoal do Paulo
(o dono/desenvolvedor, ele mesmo psicanalista) pra uso próprio, e no meio do
caminho virou produto — hoje está na Play Store.

## Estado atual (22/08/2026)

- **Versão 13** já foi buildada e subida manualmente pro Play Console (AAB,
  versionCode 13). Só o Paulo está testando por enquanto.
- Meta: deixar o app "redondo" antes de abrir um teste fechado de 14 dias
  com pelo menos 12 pessoas.
- Uma leva de ~13 pontos de correção foi levantada após o uso da v13 e — por
  avaliação do próprio Paulo — só uma parte pequena foi corrigida direito na
  primeira passada (a maioria ficou incompleta ou mal resolvida). Por isso a
  forma de trabalhar mudou (ver seção "Como este projeto é trabalhado" abaixo).
- O editor de texto rico novo (`@10play/tentap-editor`, usado em Novo
  Registro) **ainda não foi testado de verdade num aparelho** — é um risco
  conhecido, em aberto.

## Arquitetura técnica

- **App**: React Native + Expo (SDK 54), navegação com React Navigation.
- **Backend**: Supabase (Postgres + Auth + Edge Functions em Deno + Storage).
- **IA**: DeepSeek (chat/relatórios/análises), AssemblyAI (transcrição de
  áudio), OCR.space (leitura de documento/comprovante), tudo via Edge
  Functions — o app nunca tem as chaves de API direto.
- **Pagamentos**: Mercado Pago (assinatura mensal = cartão recorrente;
  semestral/anual = Pix, pagamento único — arquiteturas diferentes, ver
  memória `project_pagamento_pix_vs_cartao`).
- **E-mail**: Resend.
- **WhatsApp** (opcional, por profissional): cada uma cola a própria
  credencial da API oficial da Meta Business no perfil dela — o Dr.Sig só
  hospeda o webhook compartilhado que roteia por `phone_number_id`.

### Uma pegadinha estrutural importante

Existem **dois diretórios** do mesmo app:
- `C:\Users\USER\Documents\meu-app` — onde o trabalho de verdade acontece
  (edições, git com histórico real).
- `C:\Users\USER\Documents\meu-app-standalone` — de onde os builds EAS
  realmente saem. Os arquivos são copiados manualmente (`cp`) de um pro
  outro a cada sessão. O git desse segundo diretório está **congelado desde
  o primeiro commit** (20/06/2026) — ou seja, ele não serve como histórico,
  só o disco (working directory) importa pra build. Isso é uma dívida
  técnica conhecida, não um bug de hoje.

### Migrations do Supabase — risco recorrente

As migrations SQL (`supabase/migrations/*.sql`) são coladas manualmente no
SQL Editor do Supabase, **sem nenhum mecanismo de tracking** (não é
`supabase db push`). Isso já causou gaps sérios e silenciosos: em 21-22/08
uma auditoria encontrou **5 migrations nunca aplicadas** em produção,
incluindo duas que deixavam cron jobs inteiros (`pg_cron`) nunca
rodando desde que foram criados — sem nenhum erro visível pro usuário, só
"a automação simplesmente nunca disparava". Sempre que mexer no banco,
vale reconferir contra `information_schema` antes de assumir que uma
migration antiga já foi aplicada.

## Funcionalidades principais

Agenda (com exceções por horário, zoom por pinça, cores por tipo de
evento) · Analisantes/Supervisionandos (cadastro, histórico, autorização de
gravação com verificação de documento) · Sessões (gravação, transcrição
assíncrona, turnos por falante) · Registros/Estudos (editor rico) ·
Financeiro/Pagamentos/Recebíveis · Fiscal (recibo/nota, emissão automática) ·
Cursos (transcrição e controle de gastos) · Busca Dr.Sig (chat com IA sobre
o histórico de um analisante) · Relatórios (2 tipos via IA com prompt
psicanalítico elaborado — resumo de sessões recentes e resumo geral do
caso — e 2 tipos determinísticos sem IA — frequência e pagamento) ·
Assinatura (3 planos, Mercado Pago) · WhatsApp Business (opcional, leitura
de comprovante de pagamento por OCR) · Exportação de dados (LGPD) ·
Notificações (push + e-mail, digest diário agregado).

## Como este projeto é trabalhado

- Todo o código/comentário é em português.
- Testes com Jest (`src/services/__tests__/`) — rodar antes de considerar
  algo pronto.
- Todo arquivo alterado em `meu-app` é copiado manualmente pra
  `meu-app-standalone` antes de um build.
- Commits em português, heredoc, terminando com
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Mudança recente de dinâmica (21/08/2026):** o Paulo decidiu não mais
  passar listas grandes de itens pra execução autônoma de uma vez — a
  experiência da v13 mostrou que isso produz resultado raso/incompleto em
  itens complexos. Agora o trabalho é **item por item**, com ele definindo
  a estratégia de cada um antes de pedir a execução.
- Nunca trocar o provedor de IA (DeepSeek/Groq/etc) sem um pedido explícito
  naquela mesma conversa.
- Nenhum build EAS ou submit ao Play Console deve ser feito sem confirmação
  explícita — builds custam dinheiro/tempo, e o Paulo já foi pego de
  surpresa por isso uma vez.

## Empresa (dados legais)

Razão social **Paulo Von Schwerin Pimentel LTDA**, CNPJ 68.542.896/0001-74,
nome comercial **Dr.Sig Soluções Digitais**. Usado em política de
privacidade, termos, rodapé do site. Site institucional
(drsig.com.br) é um **repositório separado**: github.com/paulovsp/drsig-site
— não confundir com `meu-app/docs/` (que serve `app.drsig.com.br`, páginas
de apoio como confirmação de cadastro e exclusão de conta).

## Pontos em aberto conhecidos

- Editor de texto rico (tentap) sem teste real em aparelho.
- Integração WhatsApp Business: código pronto e deployado, nunca testada
  ponta a ponta com uma conta Meta real.
- Aviso do Play Console sobre tamanho de app crescendo (causa provável:
  `expo-dev-client` ficou instalado à toa após um teste abortado) e sobre
  falta de arquivo de desofuscação R8/ProGuard (nunca configurado, não é
  novo).
- Vale reauditar migrations/secrets do Supabase periodicamente (ver seção
  acima) — não é garantido que algo "deveria estar aplicado" de fato esteja.

## Sobre memória entre conversas

Esta mesma pasta de projeto (`meu-app`) tem um sistema de memória
persistente ligado a ela (arquivos em
`C:\Users\USER\.claude\projects\...\memory\`), que qualquer sessão do
Claude Code aberta nesta pasta já enxerga automaticamente — não precisa
colar contexto pra isso. Esse arquivo aqui (`PROJETO_STATUS.md`) é o
complemento pra levar contexto pra **fora** do Claude Code: outra conversa
de chat, outro dispositivo, ou uma sessão em outra pasta.
