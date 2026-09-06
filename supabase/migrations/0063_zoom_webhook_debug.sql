-- Diagnóstico TEMPORÁRIO da entrega de webhooks do Zoom (06/09/2026).
--
-- Contexto: a Zoom gera gravação e transcrição (o e-mail dela chega), o app
-- cria as reuniões com sucesso (201 no log de chamadas dela), mas a sessão
-- fica em "aguardando transcrição". Os painéis não ajudam: os logs de
-- webhook da Zoom só cobrem apps do tipo "Webhook Only", e a página de logs
-- do Supabase não abre.
--
-- Esta tabela registra TODA requisição que chega em `zoom-webhook`, inclusive
-- as recusadas por assinatura — que é justamente o caso que não deixa rastro
-- em lugar nenhum. Com uma sessão de teste dá pra separar as três hipóteses:
-- a Zoom não chama, chama e a assinatura falha, ou chama e a reunião não
-- casa com nenhuma sessão.
--
-- Não guarda o corpo do evento de propósito: ele traz um `download_token`
-- válido por 24h, e não há motivo pra isso ficar em tabela.
--
-- APAGAR quando o diagnóstico terminar (ver 0064, se existir).
create table if not exists public.zoom_webhook_debug (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  evento text,
  meeting_id text,
  assinatura_ok boolean,
  tem_legenda boolean
);

-- Sem policy nenhuma: só o service_role (que ignora RLS) escreve e lê.
alter table public.zoom_webhook_debug enable row level security;
