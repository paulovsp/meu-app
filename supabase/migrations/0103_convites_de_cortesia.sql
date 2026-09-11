-- Convite de cortesia: a conta já nasce liberada.
--
-- Os primeiros testadores são psicoterapeutas convidados pelo dono, com
-- acesso completo até uma data (31/12/2026 para a primeira leva). Até
-- aqui, dar cortesia exigia esperar a pessoa se cadastrar e então mexer no
-- perfil à mão — e, entre o cadastro e a mão, a pessoa via a conta
-- bloqueada e o aviso "escolha um plano". Primeira impressão errada, no
-- exato momento em que ela mais importa.
--
-- Aqui o convite é registrado ANTES, pelo e-mail. Quando esse e-mail cria
-- a conta, o trigger de criação encontra o convite e a conta já nasce em
-- `cortesia`, com validade e crédito de IA. Quem chega, entra.
--
-- Só o servidor lê e escreve nesta tabela: um convite é uma promessa de
-- dinheiro (meses de acesso), e não há motivo para o app enxergá-la.
create table if not exists public.convites_cortesia (
  email text primary key,
  valido_ate timestamptz not null,
  -- Crédito de IA de entrada, em reais (convertido pela taxa de referência
  -- de _shared/creditoDoPlano.ts). Depois disso o crédito mensal vem de
  -- renovar-creditos, pelo plano gravado na conta.
  creditos_brl numeric not null default 10,
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  usado_por uuid references auth.users(id) on delete set null
);

comment on table public.convites_cortesia is
  'Cortesia prometida a um e-mail antes do cadastro; aplicada pelo trigger handle_new_user. Ver migration 0103.';

alter table public.convites_cortesia enable row level security;
-- Sem política nenhuma: anon e authenticated não leem nem escrevem.
revoke all on public.convites_cortesia from anon, authenticated;

-- O trigger de criação, com o convite no fim. O corpo anterior (0091)
-- continua igual; só se acrescenta a leitura do convite depois de o perfil
-- existir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  codigo_informado text;
  quem_indicou uuid;
  contas_existentes int;
  convite public.convites_cortesia%rowtype;
begin
  -- Normaliza o que a pessoa digitou: código vem por telefone, por
  -- WhatsApp, copiado de print — com espaço, minúscula e hífen no meio.
  codigo_informado := upper(regexp_replace(
    coalesce(new.raw_user_meta_data->>'codigo_indicacao', ''), '[^A-Za-z0-9]', '', 'g'));

  if codigo_informado <> '' then
    select id into quem_indicou
    from public.profiles
    where codigo_indicacao = codigo_informado
    limit 1;
    -- Código inexistente não impede o cadastro: perder a conta de alguém
    -- por causa de um dígito errado seria muito pior do que perder a
    -- indicação. Fica sem vínculo, e a tela avisa.
  end if;

  select count(*) into contas_existentes from public.profiles;

  insert into public.profiles (
    id, nome, crp, email, cpf, telefone, data_nascimento,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    codigo_indicacao, indicado_por, elegivel_indicacao
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
    new.raw_user_meta_data->>'uf',
    public.gerar_codigo_indicacao(),
    quem_indicou,
    contas_existentes < 100
  );

  -- Convite de cortesia registrado para este e-mail? A conta já nasce
  -- liberada. `anual` como plano é o que decide o crédito mensal de IA
  -- (R$ 10, o maior) em renovar-creditos; o valor mensal equivalente fica
  -- zero porque nada é cobrado.
  select * into convite
  from public.convites_cortesia
  where lower(email) = lower(new.email)
    and usado_em is null
    and valido_ate > now()
  limit 1;

  if found then
    update public.profiles
    set assinatura_status = 'cortesia',
        assinatura_expira_em = convite.valido_ate,
        assinatura_plano = 'anual',
        assinatura_ciclo_inicio = now(),
        assinatura_valor_mensal_equivalente = 0,
        creditos_ia = coalesce(creditos_ia, 0) + convite.creditos_brl / 5.08,
        proxima_renovacao_credito = (current_date + interval '1 month')::date
    where id = new.id;

    update public.convites_cortesia
    set usado_em = now(), usado_por = new.id
    where email = convite.email;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
