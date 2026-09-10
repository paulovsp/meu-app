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
| `btg-criar-cobranca` | padrão | JWT da usuária, vindo do app |
| `btg-oauth-callback` | `--no-verify-jwt` | `state` assinado por HMAC |
| `btg-oauth-iniciar` | padrão | JWT da usuária + `profiles.is_admin` — a conta do BTG é da empresa, não de cada usuária |
| `btg-webhook` | `--no-verify-jwt` | o `txId` só credita se existir em `recargas_credito`, gravado quando NÓS criamos a cobrança |
| `confirmar-autorizacao` | `--no-verify-jwt` | token de uso único na URL — a página do analisante chama sem cabeçalho nenhum |
| `curso-transcrever-webhook` | `--no-verify-jwt` | segredo em `x-webhook-secret` (AssemblyAI) |
| `curso-transcrever` | padrão | JWT da usuária, vindo do app |
| `enviar-alerta-atraso` | padrão | JWT da usuária, vindo do app |
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
| `mercadopago-criar-checkout-creditos` | padrão | JWT da usuária, vindo do app |
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
