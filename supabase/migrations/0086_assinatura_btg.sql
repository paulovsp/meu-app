-- Assinatura pelo BTG: Pix recorrente e cartão.
--
-- O que existia antes: nada que funcionasse. Os botões do site eram
-- `mailto:`, e o `escolher-plano.html` chamava o Mercado Pago com um
-- segredo que nunca foi configurado no servidor. Ninguém conseguia assinar.
--
-- O desenho novo tem duas formas de pagar, e a diferença entre elas é o que
-- esta tabela precisa guardar:
--
--   pix_automatico — recorrência de verdade (Pix Automático, jornada 3): a
--     pessoa autoriza uma vez no app do banco dela, o primeiro pagamento sai
--     na hora por QR code, e os seguintes saem sozinhos no intervalo
--     definido. O BTG avisa cada um com `automatic-pix.scheduling-paid`.
--     `authorization_id` é o fio que liga tudo isso.
--
--   cartao — link de pagamento do BTG. Não é recorrente: vale por ciclo, e
--     `assinatura-processar-ciclo` cuida da renovação, como já faz hoje.
--
-- Por que não Pix de cobrança única no mensal: obrigaria a pessoa a pagar
-- ativamente todo mês, e isso derruba retenção. O Pix Automático existe
-- exatamente pra isso, com política de retentativa própria do BTG
-- (ACCEPT_3R_7D — três tentativas em sete dias quando falta saldo).

create table if not exists public.assinaturas_btg (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  plano             text not null check (plano in ('mensal', 'semestral', 'anual')),
  forma             text not null check (forma in ('pix_automatico', 'cartao')),

  -- Nosso identificador, mandado ao BTG na criação e devolvido em todo
  -- evento. É o que liga o pagamento à pessoa sem depender de casar e-mail
  -- — que era a parte frágil do desenho com Mercado Pago.
  external_id       uuid not null unique default gen_random_uuid(),

  -- Pix Automático: a autorização e o agendamento.
  authorization_id  text unique,
  -- Cartão: o link de pagamento.
  payment_link_id   text unique,
  link_url          text,

  -- O primeiro pagamento da jornada 3 é um Pix comum, e chega pelo evento
  -- `instant-collections.paid`, não pelo de recorrência. Guardar o txId
  -- separado evita confundir os dois.
  tx_id_primeiro    text,
  emv               text,
  qr_code_url       text,

  -- Valor do plano e o que foi de fato cobrado. No cartão os dois diferem:
  -- a taxa de 5% é somada e informada antes de a pessoa escolher.
  valor_plano_brl   numeric(10,2) not null,
  valor_cobrado_brl numeric(10,2) not null,
  taxa_percentual   numeric(5,2) not null default 0,

  status            text not null default 'aguardando'
                    check (status in ('aguardando', 'ativa', 'recusada',
                                      'cancelada', 'inadimplente', 'encerrada')),
  criado_em         timestamptz not null default now(),
  ativada_em        timestamptz,
  cancelada_em      timestamptz,
  proximo_ciclo_em  date,
  ultimo_evento     jsonb
);

create index if not exists assinaturas_btg_user_idx
  on public.assinaturas_btg (user_id, criado_em desc);
create index if not exists assinaturas_btg_auth_idx
  on public.assinaturas_btg (authorization_id);
create index if not exists assinaturas_btg_link_idx
  on public.assinaturas_btg (payment_link_id);

alter table public.assinaturas_btg enable row level security;

-- Cada uma vê a sua, e só lê. Quem cria e muda status são as Edge
-- Functions: um UPDATE pelo cliente aqui seria assinatura de graça.
drop policy if exists "assinatura propria" on public.assinaturas_btg;
create policy "assinatura propria" on public.assinaturas_btg
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.assinaturas_btg from anon, authenticated;

-- ── Pagamentos de cada ciclo ──────────────────────────────────────────
-- Um registro por cobrança paga. Serve pra não creditar duas vezes quando
-- o BTG reenvia o evento, e pra a pessoa ver o histórico do que pagou.
create table if not exists public.pagamentos_assinatura (
  id             uuid primary key default gen_random_uuid(),
  assinatura_id  uuid not null references public.assinaturas_btg(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  referencia     text not null,
  valor_brl      numeric(10,2) not null,
  pago_em        timestamptz not null,
  parcela        int,
  criado_em      timestamptz not null default now(),
  unique (assinatura_id, referencia)
);

create index if not exists pagamentos_assinatura_user_idx
  on public.pagamentos_assinatura (user_id, pago_em desc);

alter table public.pagamentos_assinatura enable row level security;
drop policy if exists "pagamentos proprios" on public.pagamentos_assinatura;
create policy "pagamentos proprios" on public.pagamentos_assinatura
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pagamentos_assinatura from anon, authenticated;

comment on column public.assinaturas_btg.taxa_percentual is
  'Acréscimo cobrado sobre o valor do plano. 0 no Pix, 5 no cartão — informado na tela antes da escolha.';
comment on column public.pagamentos_assinatura.referencia is
  'Id do evento no BTG (schedulingId, txId ou id do link). Com o unique, um reenvio do webhook não vira cobrança dobrada.';
