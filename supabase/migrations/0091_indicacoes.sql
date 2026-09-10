-- Programa de indicações: cada indicado ativo dá 10% de desconto, e dez
-- deles zeram a mensalidade.
--
-- ── Por que cupom, e não CPF/e-mail de quem indicou ───────────────────
--
-- A ideia original era pedir no cadastro algum dado de quem indicou (nome,
-- telefone, e-mail, CPF) e casar com a nossa base. Dois problemas sérios:
--
--   • privacidade: um campo que aceita CPF e responde "encontrado" é um
--     verificador de quem usa o Dr.Sig. Bastaria digitar CPFs pra
--     descobrir quem faz análise — num app de psicanálise, isso é grave;
--   • casar por nome não funciona. Homônimo existe, e "Ana Paula Silva"
--     digitada de três jeitos são três pessoas diferentes pro banco.
--
-- O cupom resolve os dois: é gerado por nós, não é dado pessoal de
-- ninguém, e o vínculo é exato. Quem indica passa o próprio código.
--
-- ── O que conta como "indicado ativo" ─────────────────────────────────
--
-- Assinatura `ativa` e dentro da validade — quer dizer, alguém que está
-- pagando agora. Não conta cortesia (ninguém paga), não conta quem
-- cancelou (parou de pagar, mesmo que ainda use até o fim do mês), e não
-- conta quem está de graça por indicação — senão uma corrente de dez
-- pessoas se sustentaria sem ninguém pagar nada.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Colunas
-- ═══════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists codigo_indicacao text,
  add column if not exists indicado_por uuid references public.profiles(id) on delete set null,
  -- Guardado, e não recalculado a cada leitura, porque é o número que
  -- precisa bater com o valor que o Mercado Pago está cobrando de fato.
  -- Divergência aqui é dinheiro errado na fatura de alguém.
  add column if not exists indicacao_desconto_percentual smallint not null default 0,
  -- Congelado na criação da conta: a elegibilidade não pode mudar debaixo
  -- de quem já entrou. Quem é o centésimo-primeiro não vira elegível
  -- porque alguém apagou a conta depois.
  add column if not exists elegivel_indicacao boolean not null default false;

create unique index if not exists profiles_codigo_indicacao_unico
  on public.profiles (codigo_indicacao) where codigo_indicacao is not null;

create index if not exists profiles_indicado_por
  on public.profiles (indicado_por) where indicado_por is not null;

comment on column public.profiles.indicacao_desconto_percentual is
  'Desconto vigente por indicações (0-100). Espelha o valor cobrado no Mercado Pago.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. O código
-- ═══════════════════════════════════════════════════════════════════════
-- Seis caracteres de um alfabeto sem 0/O, 1/I/L e 5/S: o código vai ser
-- ditado por telefone e copiado de print. Ambiguidade aqui não é detalhe
-- estético — é indicação que se perde e desconto que não entra.
create or replace function public.gerar_codigo_indicacao()
returns text
language plpgsql
as $$
declare
  alfabeto constant text := '23456789ABCDEFGHJKMNPQRTUVWXYZ';
  candidato text;
  tentativa int := 0;
begin
  loop
    candidato := '';
    for _ in 1..6 loop
      candidato := candidato || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where codigo_indicacao = candidato);
    tentativa := tentativa + 1;
    -- 30^6 = 729 milhões de combinações. Vinte colisões seguidas não é
    -- azar, é bug — falhar alto é melhor do que girar pra sempre.
    if tentativa > 20 then
      raise exception 'Não foi possível gerar um código de indicação único.';
    end if;
  end loop;
  return candidato;
end;
$$;

-- Contas que já existem também entram no programa.
update public.profiles
set codigo_indicacao = public.gerar_codigo_indicacao()
where codigo_indicacao is null;

update public.profiles
set elegivel_indicacao = true
where id in (select id from public.profiles order by created_at limit 100);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Quantos indicados ativos alguém tem
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.indicados_ativos(uid uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int
  from public.profiles
  where indicado_por = uid
    and assinatura_status = 'ativa'
    and assinatura_expira_em > now();
$$;

/**
 * O desconto a que a conta tem direito AGORA, de 0 a 100.
 *
 * É a única fonte da regra: dez por cento por indicado ativo, teto de dez
 * indicados. Quem não é elegível (entrou depois das 100 primeiras contas)
 * recebe zero, mesmo tendo indicados — o programa vale para quem entrou
 * enquanto ele existia.
 */
create or replace function public.desconto_por_indicacoes(uid uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select case
    when not coalesce((select elegivel_indicacao from public.profiles where id = uid), false) then 0
    else least(public.indicados_ativos(uid) * 10, 100)
  end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. O acesso gratuito dos dez indicados
-- ═══════════════════════════════════════════════════════════════════════
-- O Mercado Pago não aceita assinatura de R$ 0 ("must be a positive
-- number") nem abaixo de R$ 0,50 — testado contra a API. Então 100% de
-- desconto não é uma assinatura barata: é assinatura nenhuma. A conta
-- passa para este status, a assinatura é cancelada no Mercado Pago, e o
-- acesso vale enquanto os dez indicados continuarem ativos.
--
-- Diferente de 'cortesia', que é concedida na mão e tem validade própria:
-- aqui não há data, há uma condição — por isso este status não olha
-- `assinatura_expira_em`.
create or replace function public.assinatura_ativa(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and (
        (assinatura_status in ('ativa', 'cortesia', 'cancelada', 'inadimplente')
          and assinatura_expira_em > now())
        or assinatura_status = 'gratuita_indicacao'
      )
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Cadastro: código próprio, e o vínculo com quem indicou
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  codigo_informado text;
  quem_indicou uuid;
  contas_existentes int;
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

  return new;
end;
$$;

notify pgrst, 'reload schema';
