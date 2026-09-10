-- Recarga de créditos por Pix do BTG, creditada sozinha.
--
-- Os três links fixos do BTG cobram, mas não dizem QUEM pagou: o link é o
-- mesmo pra todo mundo e o banco não avisa o app. O saldo ficava parado
-- depois do pagamento, e a saída era comprovante e conferência à mão.
--
-- A API de Pix Cobrança resolve: cada recarga vira uma cobrança dinâmica
-- própria, com seu QR code, e o BTG chama nosso webhook quando ela é paga.
-- O que liga o pagamento à pessoa é o `tx_id` que o BTG devolve na criação
-- e repete no webhook — guardado aqui, porque o `txId` é gerado por eles,
-- não escolhido por nós.

-- ── Conexão da conta da Dr.Sig com o BTG ──────────────────────────────
-- Uma linha só: é a conta da empresa que recebe, não a de cada usuária.
-- O OAuth é Authorization Code (o BTG não oferece client_credentials pra
-- este escopo), então alguém autoriza uma vez no navegador e o refresh
-- token fica aqui — mesmo desenho já usado com Google e Zoom.
create table if not exists public.btg_conexao (
  id              int primary key default 1 check (id = 1),
  refresh_token   text not null,
  access_token    text,
  expira_em       timestamptz,
  company_id      text,
  ambiente        text not null default 'sandbox',
  conectado_em    timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- Ninguém acessa isto pelo app: só as Edge Functions, com service role.
-- Sem policy nenhuma + RLS ligado = negado pra qualquer cliente.
alter table public.btg_conexao enable row level security;
revoke all on public.btg_conexao from anon, authenticated;

-- ── Recargas ──────────────────────────────────────────────────────────
create table if not exists public.recargas_credito (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  tx_id          text unique,
  location_id    text,
  valor_brl      numeric(10,2) not null,
  -- O que entra no saldo: sempre maior que `valor_brl` (o bônus do Pix sem
  -- taxa). Gravado na criação, e não calculado no webhook, pra que mudar a
  -- tabela de pacotes amanhã não altere o combinado de uma recarga que já
  -- estava em aberto.
  credito_brl    numeric(10,2) not null,
  status         text not null default 'aguardando'
                 check (status in ('aguardando', 'paga', 'expirada', 'erro')),
  emv            text,
  qr_code_url    text,
  criado_em      timestamptz not null default now(),
  pago_em        timestamptz,
  valor_pago_brl numeric(10,2)
);

create index if not exists recargas_credito_user_idx
  on public.recargas_credito (user_id, criado_em desc);
create index if not exists recargas_credito_tx_idx
  on public.recargas_credito (tx_id);

alter table public.recargas_credito enable row level security;

-- Cada uma vê as suas, e só lê: quem cria e quem muda o status são as
-- Edge Functions. Um UPDATE pelo cliente aqui seria crédito de graça.
drop policy if exists "recargas proprias" on public.recargas_credito;
create policy "recargas proprias" on public.recargas_credito
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.recargas_credito from anon, authenticated;

comment on column public.recargas_credito.tx_id is
  'Id da cobrança no BTG. Gerado por eles na criação e repetido no webhook instant-collection.paid — é o que liga o pagamento à pessoa.';
