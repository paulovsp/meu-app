# Como fazer deploy de cada função

Existe porque errar aqui **não dá erro na hora**: a função sobe normalmente
e só falha depois — quando o cron roda de madrugada e leva 401, ou quando um
webhook externo é recusado em silêncio. Aconteceu duas vezes neste projeto,
a segunda enquanto se escrevia este arquivo.

A regra: **quem não é chamado pelo app com o JWT da usuária precisa de
`--no-verify-jwt`.** São os webhooks (Meta, Mercado Pago e o próprio Supabase
não têm JWT de usuária) e os jobs de cron (o pg_cron manda um segredo no
cabeçalho, não um JWT).

Em nenhum desses casos a autenticação some — ela muda de lugar, e o lugar
está na terceira coluna. Uma função `--no-verify-jwt` sem nada na terceira
coluna seria um endpoint aberto, e não existe nenhuma assim.

| função | deploy | como prova quem é |
|---|---|---|
| `assinatura-cancelar` | padrão | JWT da usuária, vindo do app |
| `assinatura-processar-ciclo` | `--no-verify-jwt` | segredo de cron (`x-cron-secret`) |
| `auth-send-email` | `--no-verify-jwt` | assinatura do hook do Supabase (Standard Webhooks) |
| `cotacao-atualizar` | padrão | JWT da usuária, vindo do app — o app só diz a moeda; o valor vem do PTAX/BCB |
| `enviar-alerta-atraso` | padrão | JWT da usuária, vindo do app |
| `enviar-convite-testador` | `--no-verify-jwt` | segredo próprio em `x-convite-secret` (CONVITE_TESTADOR_SECRET) — chamada pelo dono, pela linha de comando |
| `enviar-digest-diario` | `--no-verify-jwt` | segredo de cron (`x-cron-secret`) |
| `enviar-recibo` | padrão | JWT da usuária, vindo do app |
| `excluir-conta` | padrão | JWT da usuária, vindo do app |
| `ia-busca` | padrão | JWT da usuária, vindo do app |
| `mercadopago-criar-checkout-assinatura` | padrão | JWT da usuária, vindo do app |
| `mercadopago-criar-recarga` | padrão | JWT da usuária — vindo da página de recarga (docs/recarregar-creditos.html), com o token no header |
| `mercadopago-webhook` | `--no-verify-jwt` | assinatura do Mercado Pago |
| `op-agente` | `--no-verify-jwt` | segredo de operação em `x-op-secret` (OP_SECRET) — chamada pelos agentes. As instalações do Play usam GOOGLE_SERVICE_ACCOUNT_B64 (a chave da conta de serviço, em base64); a publicação no Instagram/Facebook usa META_PAGE_TOKEN, META_PAGE_ID e META_IG_USER_ID |
| `reenviar-instrucoes-plano` | padrão | JWT da usuária, vindo do app |
| `renovar-creditos` | padrão | JWT da usuária, vindo do app |
| `resend-webhook` | `--no-verify-jwt` | assinatura Svix da Resend (RESEND_WEBHOOK_SECRET) |
| `whatsapp-webhook` | `--no-verify-jwt` | assinatura da Meta (`X-Hub-Signature-256`) + verify token no handshake |

## Antes de cada release: o banco é o que as migrations dizem?

Uma política criada à mão no painel (`availability_slots_all`) ficou meses
em produção sem constar em migration nenhuma, abrindo a agenda de todo
mundo — só apareceu numa auditoria. `supabase db diff` pegaria isso, mas
exige Docker. O caminho que funciona com o CLI já linkado:

    npx supabase db query --linked -f supabase/checks/politicas.sql > politicas-atual.json

e comparar com `supabase/checks/politicas-esperadas.json`, o último estado
conferido. Qualquer linha a mais ou a menos é uma mudança que alguém
precisa explicar — e, se for legítima, virar migration e atualizar o
snapshot. Nunca atualizar o snapshot sem saber de onde veio a diferença.
