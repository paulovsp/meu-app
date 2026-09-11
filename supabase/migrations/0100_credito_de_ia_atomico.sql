-- O saldo de IA era lido, somado em JavaScript e gravado de volta.
--
-- Quatro lugares faziam isso (busca, transcrição de sessão, transcrição
-- de aula, recarga): `select creditos_ia` → conta → `update creditos_ia =
-- <novo valor>`. Duas chamadas ao mesmo tempo — dois blocos de áudio da
-- mesma gravação terminando juntos, que é o caso comum — liam o mesmo
-- saldo e a segunda gravação apagava o débito da primeira. Cobrava menos
-- sem ninguém perceber.
--
-- Uma função que faz `creditos_ia = creditos_ia + delta` numa instrução
-- só resolve: o Postgres tranca a linha, e o segundo débito espera o
-- primeiro. Só o servidor pode chamar — pelo app seria uma torneira de
-- crédito.
create or replace function public.ajustar_credito_ia(uid uuid, delta numeric)
returns numeric
language sql volatile security definer set search_path = public
as $$
  update public.profiles
  set creditos_ia = coalesce(creditos_ia, 0) + delta
  where id = uid
  returning creditos_ia;
$$;

revoke execute on function public.ajustar_credito_ia(uuid, numeric) from public, anon, authenticated;
grant execute on function public.ajustar_credito_ia(uuid, numeric) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- Recarga: um pagamento, um crédito
-- ═══════════════════════════════════════════════════════════════════════
-- O webhook do Mercado Pago deduplicava pela NOTIFICAÇÃO, e um pagamento
-- aprovado gera mais de uma (`payment.created`, `payment.updated`), cada
-- uma com o próprio id. E agora a própria página de recarga credita na
-- hora, sem esperar o webhook — que chega segundos depois com o mesmo
-- pagamento. Sem uma chave pelo PAGAMENTO, cada caminho creditaria de
-- novo.
--
-- Esta tabela é a chave: a inserção aqui vem ANTES do crédito, e quem
-- perde a corrida do `insert` não credita.
create table if not exists public.recargas_creditos (
  mp_payment_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  valor_brl numeric not null,
  credito_usd numeric not null,
  meio text not null,
  criado_em timestamptz not null default now()
);

comment on table public.recargas_creditos is
  'Pagamentos avulsos de crédito de IA já creditados. Chave pelo id do pagamento no Mercado Pago: ver migration 0100.';

alter table public.recargas_creditos enable row level security;

-- A dona da conta pode ver as próprias recargas; escrever, só o servidor.
create policy recargas_creditos_select_own on public.recargas_creditos
  for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
