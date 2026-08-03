-- Correlação entre pagamento (Mercado Pago, no site drsig.com.br) e conta
-- do app — o link de assinatura hoje é estático (igual pra todo mundo), o
-- webhook não tem garantia de achar um perfil já existente com aquele
-- e-mail (a pessoa pode pagar ANTES de criar a conta no app — caso comum,
-- já que a venda acontece fora do app). Quando isso acontece, o webhook
-- grava aqui em vez de descartar; a criação de conta consulta esta tabela
-- pelo e-mail e já ativa a assinatura na hora, sem esperar login manual.
--
-- Só a Edge Function (service_role) e o trigger (security definer) tocam
-- nesta tabela — RLS habilitada sem nenhuma policy nega tudo por padrão
-- pro role authenticated, então nem GRANT pra authenticated é dado.
create table if not exists public.pagamentos_pendentes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  mp_preapproval_id text,
  assinatura_status text not null check (assinatura_status in ('ativa', 'inadimplente', 'cancelada', 'cortesia')),
  assinatura_expira_em timestamptz,
  valor numeric,
  criado_em timestamptz not null default now(),
  processado boolean not null default false
);
create index if not exists pagamentos_pendentes_email_idx on public.pagamentos_pendentes(email);

alter table public.pagamentos_pendentes enable row level security;
grant select, insert, update on public.pagamentos_pendentes to service_role;

-- Idempotência do webhook do Mercado Pago: ele reenvia a mesma notificação
-- (mesmo `id` de notificação) quando não recebe 200 rápido o bastante, ou
-- por retry de rede — guarda o id já processado e ignora repetição.
create table if not exists public.mercadopago_eventos_processados (
  id text primary key,
  tipo text,
  processado_em timestamptz not null default now()
);
alter table public.mercadopago_eventos_processados enable row level security;
grant select, insert on public.mercadopago_eventos_processados to service_role;

-- Estende o gatilho de criação de perfil (0008_profiles_endereco_estruturado)
-- pra, logo depois de criar a linha de profiles, checar se já existe
-- pagamento pendente pra esse e-mail e, se sim, ativar a assinatura na hora.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pendente record;
begin
  insert into public.profiles (
    id, nome, crp, email, cpf, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'cep',
    new.raw_user_meta_data->>'logradouro',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'complemento',
    new.raw_user_meta_data->>'bairro',
    new.raw_user_meta_data->>'cidade',
    new.raw_user_meta_data->>'uf'
  );

  -- Solução provisória, pelo e-mail (o link de assinatura hoje é estático,
  -- igual pra todo mundo, sem jeito de carimbar o id do usuário nele). A
  -- solução definitiva é gerar o checkout por API do Mercado Pago com
  -- `external_reference` = id do usuário — isso elimina a ambiguidade do
  -- e-mail, mas exige que a conta já exista ANTES de a assinatura ser
  -- criada, ou seja, um checkout dinâmico gerado depois do login/cadastro,
  -- não um link estático publicado no site.
  select * into pendente
  from public.pagamentos_pendentes
  where email = new.email and not processado
  order by criado_em desc
  limit 1;

  if found then
    -- Mesma taxa de referência de creditosIA.js/renovar-creditos/
    -- mercadopago-webhook — converte o valor pago (BRL) pro saldo interno
    -- (US$). Sem isso, quem paga ANTES de criar a conta ganharia o status
    -- ativo mas ficaria com creditos_ia = 0, diferente de quem já tinha
    -- conta na hora do pagamento.
    update public.profiles
    set
      assinatura_status = pendente.assinatura_status,
      assinatura_expira_em = pendente.assinatura_expira_em,
      mp_preapproval_id = pendente.mp_preapproval_id,
      creditos_ia = creditos_ia + coalesce(pendente.valor, 0) / 5.08
    where id = new.id;

    update public.pagamentos_pendentes
    set processado = true
    where email = new.email and not processado;
  end if;

  return new;
end;
$$;
