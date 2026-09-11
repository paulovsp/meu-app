# Como fazer deploy de cada função

Existe porque errar aqui **não dá erro na hora**: a função sobe normalmente
e só falha depois — quando o cron roda de madrugada e leva 401, ou quando um
webhook externo é recusado em silêncio. Aconteceu duas vezes neste projeto,
a segunda enquanto se escrevia este arquivo.

A regra: **quem não é chamado pelo app com o JWT da usuária precisa de
`--no-verify-jwt`.** São os webhooks (Meta, Zoom, Mercado Pago, AssemblyAI e
o próprio Supabase não têm JWT de usuária), os jobs de cron (o pg_cron manda
um segredo no cabeçalho, não um JWT), os retornos de OAuth (a prova é o
`state` assinado) e a página de autorização do analisante (a prova é o token
de uso único na URL).

Em nenhum desses casos a autenticação some — ela muda de lugar, e o lugar
está na terceira coluna. Uma função `--no-verify-jwt` sem nada na terceira
coluna seria um endpoint aberto, e não existe nenhuma assim.

| função | deploy | como prova quem é |
|---|---|---|
| `assinatura-processar-ciclo` | `--no-verify-jwt` | segredo de cron (`x-cron-secret`) |
| `auth-send-email` | `--no-verify-jwt` | assinatura do hook do Supabase (Standard Webhooks) |
| `confirmar-autorizacao` | `--no-verify-jwt` | token de uso único na URL — a página do analisante chama sem cabeçalho nenhum |
| `curso-transcrever-webhook` | `--no-verify-jwt` | segredo em `x-webhook-secret` (AssemblyAI) |
| `curso-transcrever` | padrão | JWT da usuária, vindo do app |
| `enviar-alerta-atraso` | padrão | JWT da usuária, vindo do app |
| `enviar-convite-testador` | `--no-verify-jwt` | segredo próprio em `x-convite-secret` (CONVITE_TESTADOR_SECRET) — chamada pelo dono, pela linha de comando |
| `enviar-digest-diario` | `--no-verify-jwt` | segredo de cron (`x-cron-secret`) |
| `enviar-recibo` | padrão | JWT da usuária, vindo do app |
| `excluir-conta` | padrão | JWT da usuária, vindo do app |
| `google-oauth-callback` | `--no-verify-jwt` | `state` assinado por HMAC |
| `google-oauth-iniciar` | padrão | JWT da usuária, vindo do app |
| `ia-busca` | padrão | JWT da usuária, vindo do app |
| `ia-transcrever-webhook` | `--no-verify-jwt` | segredo em `x-webhook-secret` (AssemblyAI) |
| `ia-transcrever` | padrão | JWT da usuária, vindo do app |
| `meet-buscar-transcricao` | `--no-verify-jwt` | segredo de cron — e também aceita JWT do app, pro botão "buscar agora" |
| `meet-criar-sala` | padrão | JWT da usuária, vindo do app |
| `mercadopago-criar-checkout-assinatura` | padrão | JWT da usuária, vindo do app |
| `mercadopago-criar-recarga` | padrão | JWT da usuária — vindo da página de recarga (docs/recarregar-creditos.html), com o token no header |
| `mercadopago-webhook` | `--no-verify-jwt` | assinatura do Mercado Pago |
| `reenviar-instrucoes-plano` | padrão | JWT da usuária, vindo do app |
| `renovar-creditos` | padrão | JWT da usuária, vindo do app |
| `solicitar-autorizacao` | padrão | JWT da usuária, vindo do app |
| `whatsapp-webhook` | `--no-verify-jwt` | assinatura da Meta (`X-Hub-Signature-256`) + verify token no handshake |
| `zoom-buscar-transcricao` | `--no-verify-jwt` | segredo de cron — e também aceita JWT do app, pro botão "buscar agora" |
| `zoom-criar-reuniao` | padrão | JWT da usuária, vindo do app |
| `zoom-desconectar` | padrão | JWT da usuária, vindo do app |
| `zoom-oauth-callback` | `--no-verify-jwt` | `state` assinado por HMAC |
| `zoom-oauth-iniciar` | padrão | JWT da usuária, vindo do app |
| `zoom-webhook` | `--no-verify-jwt` | assinatura do Zoom (HMAC) |

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
