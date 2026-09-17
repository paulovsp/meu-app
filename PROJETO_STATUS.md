# Dr.Sig — status do projeto

Este arquivo existe pra uma coisa só: colar no início de qualquer conversa nova
com uma IA (Claude Code, chat, o que for) e ela entender rápido o que é este
projeto, onde as coisas estão, e como este trabalho tem sido feito até aqui.
Atualizado em 17/09/2026.

## O que é

Dr.Sig é um app de prontuário, agenda e gestão financeira/fiscal pra
profissionais de **psicanálise** (não terapia genérica — o vocabulário do
app inteiro usa "analisante", "análise", "paralização da análise", etc.).
Quem cadastra é a psicanalista; quem ela cadastra é o analisante
(paciente). O projeto nasceu como uma ferramenta pessoal do Paulo (o dono,
ele mesmo psicanalista, que não programa) pra uso próprio, e virou produto.

## Estado atual (17/09/2026)

- **Lançado oficialmente na Play Store.** Produção = build 24 (1.0.0),
  pacote `br.com.drsig.app`, aprovada e publicada a 100 % em 17/09/2026.
  Runtime (fingerprint) `d80c4d17344acc54822cf2e1d1e9fcb355556ce9`.
- **Primeira atualização OTA** publicada no mesmo dia, no canal
  `production`, para esse runtime (avisos da Início, cancelamento de
  compromisso futuro, ordenação da agenda, origem no cadastro, recarga em
  cartão).
- **Faixas de teste vazias.** O teste fechado (versão 23) foi esvaziado em
  17/09; o Paulo usa o app oficial da loja como qualquer usuária. Para
  testar uma versão futura antes de publicar, usa-se o *compartilhamento
  interno de apps* (link que instala uma build específica sem inscrever
  ninguém em faixa nenhuma) — nunca uma faixa de teste, que põe "(Beta)" na
  ficha e impede a pessoa de avaliar o app.
- **Próximo build** (`PROXIMO_BUILD.md`): notificações push no Android —
  falta o `google-services.json` do Firebase; hoje os avisos só chegam por
  e-mail.
- Conta do Play Console é de organização (D-U-N-S verificado em 08/2026,
  exigência da categoria saúde).

## Arquitetura técnica

- **App**: React Native + Expo (SDK 54, *managed*, sem pasta nativa),
  navegação com React Navigation. `runtimeVersion` por fingerprint — por
  isso o `scripts` do `package.json` não pode mudar (ver `AGENTS.md`).
- **Backend**: Supabase (Postgres + Auth + 34 Edge Functions em Deno +
  Storage). Migrations em `supabase/migrations/`, aplicadas com
  `supabase db push` (CLI linkado; 0001–0110 aplicadas). `verify_jwt` de
  cada função declarado em `supabase/config.toml` e explicado em
  `supabase/functions/DEPLOY.md`.
- **IA**: DeepSeek (chat/relatórios/análises), AssemblyAI (transcrição de
  áudio), OCR.space (leitura de documento/comprovante), tudo via Edge
  Functions — o app nunca tem as chaves de API direto.
- **Pagamentos**: Mercado Pago (assinatura mensal = cartão recorrente;
  semestral/anual = Pix, pagamento único). Recarga de créditos de IA só
  em cartão.
- **E-mail**: Resend. **Videochamada**: Google Meet e Zoom (OAuth por
  usuária). **WhatsApp** (opcional): cada profissional cola a própria
  credencial da Meta; o Dr.Sig só hospeda o webhook.
- **Build/publicação**: `eas build` (só com "sim" explícito do Paulo —
  custa dinheiro) e `eas update` (OTA, depois do `/pre-voo ota`). Tudo sai
  deste repositório (`meu-app`); o antigo `meu-app-standalone` foi
  aposentado em 08/2026.

## Operação por agentes

Desde 09/2026 a manutenção é feita por agentes do Claude Code
(`.claude/agents/` + `.claude/skills/`), todos passando pela Edge Function
`op-agente` (segredo `x-op-secret`): Vigia (ronda diária), Zelador
(feedbacks), Diagnosticador (incidentes → PR), Guardião (dependências),
Auditor (RLS/grants/segredos), Tesoureiro (fechamento mensal),
Estrategista/Redator/Designer/Publicador (divulgação, no repositório
`drsig-site`), Analista (funil), Arquivista (importação do consultório do
Google Drive). Relatórios em `operacao/` (aqui) e `marketing/` (no site).
Nenhum agente faz deploy, migration, OTA ou build.

## Funcionalidades principais

Agenda (horários fixos, faltas, cancelamentos, remarcações) ·
Analisantes/Supervisionandos (ficha, histórico, autorização de gravação
com verificação de documento) · Sessões (gravação, transcrição
assíncrona, turnos por falante) · Registros/Estudos (editor rico) ·
Financeiro/Pagamentos/Recebíveis · Fiscal (recibo/nota) · Cursos · Busca
Dr.Sig (chat com IA sobre o histórico de um analisante) · Relatórios (2
via IA, 2 determinísticos) · Assinatura (3 planos, Mercado Pago) ·
Consultório de demonstração · Exportação de dados (LGPD) · Notificações
(e-mail e digest diário; push depende do próximo build).

## Como este projeto é trabalhado

- Todo o código/comentário é em português. Commits em português.
- Testes com Jest (`npx jest`), lint com `npx eslint src App.js index.js`
  — rodar direto, nunca adicionar scripts ao `package.json`.
- O Paulo não programa: resultado em uma frase primeiro, detalhe técnico
  só quando muda uma decisão dele; o Claude faz tudo o que puder sozinho
  e deixa para o Paulo só o que exige a conta, o cartão ou o celular dele.
  Permissões da pasta liberadas em `.claude/settings.local.json`; só
  `eas build/submit/update`, `db push/reset`, `push --force` e `rm -rf`
  ainda pedem confirmação.
- Trabalho **item por item**: o Paulo define a estratégia de cada item
  antes da execução; nada de listas grandes executadas de uma vez.
- Nunca trocar o provedor de IA sem pedido explícito na mesma conversa.
- Com produção "em análise" no Play Console, nunca enviar nada para
  revisão (reinicia a fila). Fora disso, mudanças na loja seguem normais.

## Empresa (dados legais)

Razão social **Paulo Von Schwerin Pimentel LTDA**, CNPJ 68.542.896/0001-74,
nome comercial **Dr.Sig Soluções Digitais**. Usado em política de
privacidade, termos, rodapé do site. Site institucional (drsig.com.br) é um
**repositório separado**: github.com/paulovsp/drsig-site — não confundir
com `meu-app/docs/` (que serve `app.drsig.com.br`, páginas de apoio como
confirmação de cadastro e exclusão de conta).

## Pontos em aberto conhecidos

- Push no Android (build pendente, acima).
- Incidentes abertos em `op_incidentes` (ver a ronda mais recente em
  `operacao/ronda/`): mídia recusada pela Meta no Publicador,
  `enviar-digest-diario` com 500 aguardando o dono.
- Integração WhatsApp Business nunca testada ponta a ponta com uma conta
  Meta real.
- Arquivo de desofuscação R8/ProGuard nunca configurado (aviso do Play).

## Sobre memória entre conversas

Esta mesma pasta de projeto (`meu-app`) tem um sistema de memória
persistente ligado a ela (arquivos em
`C:\Users\USER\.claude\projects\...\memory\`), que qualquer sessão do
Claude Code aberta nesta pasta já enxerga automaticamente — não precisa
colar contexto pra isso. Esse arquivo aqui (`PROJETO_STATUS.md`) é o
complemento pra levar contexto pra **fora** do Claude Code: outra conversa
de chat, outro dispositivo, ou uma sessão em outra pasta.
