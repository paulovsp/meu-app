-- Nenhum pagamento é atribuído por adivinhação.
--
-- Até aqui existia um caminho em que o sistema recebia um pagamento sem
-- saber de quem era e tentava descobrir pelo e-mail do pagador: se achasse
-- um perfil com aquele e-mail, liberava; se não achasse, guardava em
-- `pagamentos_pendentes` esperando alguém se cadastrar com ele.
--
-- Os dois lados são falhos pela mesma razão: o e-mail da conta do Mercado
-- Pago quase nunca é o e-mail do cadastro. No teste real do app, o
-- pagamento saiu de uma conta pessoal com outro endereço e ficou solto —
-- nem liberou a conta certa, nem avisou ninguém. E o caso oposto é pior:
-- se o e-mail coincidisse com o de outra pessoa, o acesso ia pra conta
-- errada.
--
-- Isso deixou de ser necessário quando o checkout passou a ser gerado
-- sempre a partir de uma sessão autenticada: todo pagamento nasce com
-- `external_reference = assinatura:<plano>:<userId>`. Não existe mais
-- "pagamento antes da conta" — o site não vende, ele manda pra loja do
-- app, e o pagamento só acontece depois do cadastro confirmado.
--
-- O que sobra é o pagamento que chega por fora (um link avulso criado à
-- mão no painel do Mercado Pago, por exemplo). Esse não é adivinhado nem
-- descartado: fica registrado abaixo, esperando conferência humana.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. O trigger de cadastro para de consultar pagamentos pendentes
-- ═══════════════════════════════════════════════════════════════════════
-- Tem que vir antes do drop: a função referencia a tabela.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, nome, crp, email, cpf, telefone, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'telefone',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'cep',
    new.raw_user_meta_data->>'logradouro',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'complemento',
    new.raw_user_meta_data->>'bairro',
    new.raw_user_meta_data->>'cidade',
    new.raw_user_meta_data->>'uf'
  );
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Onde vai parar o dinheiro que não diz de quem é
-- ═══════════════════════════════════════════════════════════════════════
-- Existe pra ser um alarme, não um mecanismo: em operação normal fica
-- vazia. Uma linha aqui significa que alguém pagou e o acesso NÃO foi
-- liberado — e que uma pessoa precisa olhar.
create table if not exists public.pagamentos_nao_identificados (
  id uuid primary key default gen_random_uuid(),
  mp_id text not null,
  tipo text not null,
  valor numeric,
  status text,
  -- Guardado pra ajudar a conferência a ter por onde começar. Nunca é
  -- usado pra decidir de quem é o pagamento: foi exatamente essa decisão
  -- automática que esta migration existe pra eliminar.
  email_pagador text,
  motivo text not null,
  resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists pagamentos_nao_identificados_abertos
  on public.pagamentos_nao_identificados (criado_em desc)
  where resolvido_em is null;

alter table public.pagamentos_nao_identificados enable row level security;
-- Sem policy nenhuma, de propósito: quem escreve é o webhook (service
-- role, que passa por cima da RLS) e quem lê é a dona do app, pelo painel
-- do Supabase. Nenhum usuário do app tem o que fazer aqui.

-- ═══════════════════════════════════════════════════════════════════════
-- 3. A tabela da adivinhação sai
-- ═══════════════════════════════════════════════════════════════════════
-- Está vazia (conferido antes da migration). Não fica "guardada pra
-- depois": esquema morto é pior que esquema ausente — alguém lê, acha que
-- vale, e escreve em cima.
drop table if exists public.pagamentos_pendentes;

notify pgrst, 'reload schema';
