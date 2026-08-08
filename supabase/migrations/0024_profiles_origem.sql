-- Distingue contas de apoio (revisão de loja, cortesia, teste) de contas de
-- mercado (assinantes reais) — sem isso, métricas de assinatura ativa
-- ficam contaminadas por contas que nunca foram clientes de verdade.
alter table public.profiles add column if not exists origem text
  not null default 'mercado'
  check (origem in ('apoio', 'mercado'));

-- Conta de revisor do Google Play (ativada nesta sessão com plano/créditos
-- só pra passar na revisão da loja) — não é cliente.
update public.profiles set origem = 'apoio' where email = 'oseusig@gmail.com';
