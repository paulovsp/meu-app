-- Três regras de cadastro que até agora só existiam (mal) na tela, e por
-- isso não existiam de verdade: quem chamasse a API direto passava por
-- cima de todas.
--
--   1. `telefone` passa a ser gravado no signup (a coluna existia desde a
--      0001 e o trigger nunca a preencheu — o campo simplesmente não estava
--      na tela de cadastro).
--   2. `nome` e `cpf` do perfil não mudam depois de preenchidos.
--   3. Ninguém cadastra a si mesmo como analisante.
--
-- As três são a mesma regra vista de ângulos diferentes. A autorização de
-- gravação existe pra que um terceiro confirme; cadastrar-se como o próprio
-- analisante fecha esse circuito sozinho. Travar só o autocadastro não
-- bastaria: bastaria editar o nome/CPF do perfil depois pra que o bloqueio
-- deixasse de reconhecer a coincidência. Por isso (2) e (3) andam juntas.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Telefone no signup
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pendente record;
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

  select * into pendente
  from public.pagamentos_pendentes
  where email = new.email and not processado
  order by criado_em desc
  limit 1;

  if found then
    update public.profiles
    set
      assinatura_status = pendente.assinatura_status,
      assinatura_expira_em = pendente.assinatura_expira_em,
      mp_preapproval_id = pendente.mp_preapproval_id,
      assinatura_plano = pendente.assinatura_plano,
      assinatura_ciclo_inicio = pendente.assinatura_ciclo_inicio,
      assinatura_valor_mensal_equivalente = pendente.assinatura_valor_mensal_equivalente,
      creditos_ia = creditos_ia + coalesce(pendente.valor, 0) / 5.08
    where id = new.id;

    update public.pagamentos_pendentes
    set processado = true
    where email = new.email and not processado;
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Normalizações — as mesmas dos dois lados da comparação
-- ═══════════════════════════════════════════════════════════════════════

-- CPF entra formatado numa tela e limpo na outra; comparar string crua
-- deixaria "111.222.333-44" e "11122233344" passarem como diferentes.
create or replace function public.cpf_digitos(valor text)
returns text
language sql immutable
as $$ select nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '') $$;

-- Nome: caixa e espaço sobrando não fazem duas pessoas. Acento fica de
-- fora de propósito — quem digita o próprio nome digita do mesmo jeito, e
-- depender de `unaccent` traria uma extensão só por causa disso.
create or replace function public.nome_normalizado(valor text)
returns text
language sql immutable
as $$ select nullif(lower(btrim(regexp_replace(coalesce(valor, ''), '\s+', ' ', 'g'))), '') $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Nome e CPF do perfil são definitivos
-- ═══════════════════════════════════════════════════════════════════════
-- Só travam depois de preenchidos: contas criadas antes do CPF ser
-- obrigatório precisam poder completar o cadastro uma vez. Depois disso,
-- não muda mais.
create or replace function public.profiles_nome_cpf_imutaveis()
returns trigger
language plpgsql
as $$
begin
  if public.nome_normalizado(old.nome) is not null
     and public.nome_normalizado(new.nome) is distinct from public.nome_normalizado(old.nome) then
    raise exception 'NOME_IMUTAVEL'
      using hint = 'O nome do titular da conta não pode ser alterado.';
  end if;

  if public.cpf_digitos(old.cpf) is not null
     and public.cpf_digitos(new.cpf) is distinct from public.cpf_digitos(old.cpf) then
    raise exception 'CPF_IMUTAVEL'
      using hint = 'O CPF do titular da conta não pode ser alterado.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_nome_cpf_imutaveis on public.profiles;
create trigger profiles_nome_cpf_imutaveis
  before update on public.profiles
  for each row execute function public.profiles_nome_cpf_imutaveis();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Ninguém se cadastra como o próprio analisante
-- ═══════════════════════════════════════════════════════════════════════
-- A conta de desenvolvimento precisa da brecha pra testar o fluxo de
-- autorização sem depender de um terceiro. A isenção mora numa tabela, e
-- não no código da função, pra que conceder ou revogar seja uma linha de
-- dado e não um deploy.
create table if not exists public.isencoes_autocadastro (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  cpf text,
  motivo text not null,
  criado_em timestamptz not null default now(),
  constraint isencao_precisa_de_alvo check (user_id is not null or cpf is not null)
);

alter table public.isencoes_autocadastro enable row level security;
-- Sem policy nenhuma de propósito: ninguém lê nem escreve pelo app. Quem
-- consulta é a função abaixo, que roda como `security definer`.

create or replace function public.impedir_autocadastro_analisante()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  titular record;
begin
  select nome, cpf into titular from public.profiles where id = new.user_id;
  if not found then return new; end if;

  if exists (
    select 1 from public.isencoes_autocadastro i
    where i.user_id = new.user_id
       or (i.cpf is not null and public.cpf_digitos(i.cpf) = public.cpf_digitos(titular.cpf))
  ) then
    return new;
  end if;

  -- CPF igual é a prova direta: é a mesma pessoa, não há segunda leitura.
  if public.cpf_digitos(new.cpf) is not null
     and public.cpf_digitos(new.cpf) = public.cpf_digitos(titular.cpf) then
    raise exception 'AUTOCADASTRO'
      using hint = 'Este CPF é o do titular da conta.';
  end if;

  -- Nome igual só bloqueia quando NÃO há CPF que prove o contrário. Com um
  -- CPF diferente informado, homônimo é homônimo — bloquear aí quebraria
  -- cadastro legítimo (pai e filho, nome comum). Sem CPF, o nome é tudo o
  -- que existe, e é justamente por onde a brecha voltaria.
  if public.cpf_digitos(new.cpf) is null
     and public.nome_normalizado(new.nome) is not null
     and public.nome_normalizado(new.nome) = public.nome_normalizado(titular.nome) then
    raise exception 'AUTOCADASTRO'
      using hint = 'Este nome é o do titular da conta. Informe o CPF do analisante se for outra pessoa.';
  end if;

  return new;
end;
$$;

drop trigger if exists impedir_autocadastro_analisante on public.patients;
create trigger impedir_autocadastro_analisante
  before insert or update on public.patients
  for each row execute function public.impedir_autocadastro_analisante();

-- ═══════════════════════════════════════════════════════════════════════
-- Isenção da conta de desenvolvimento
-- ═══════════════════════════════════════════════════════════════════════
-- Falha de propósito se a conta não for encontrada: ficar em silêncio aqui
-- significaria publicar um bloqueio que tranca o próprio teste do app.
do $$
declare
  dev_id uuid;
  dev_cpf text;
begin
  select id, cpf into dev_id, dev_cpf
  from public.profiles
  where email = 'paulovsp@gmail.com'
  limit 1;

  if dev_id is null then
    raise exception 'Conta de desenvolvimento (paulovsp@gmail.com) não encontrada em profiles — a isenção de autocadastro não pôde ser criada.';
  end if;

  insert into public.isencoes_autocadastro (user_id, cpf, motivo)
  values (dev_id, dev_cpf, 'Conta de desenvolvimento: testa o fluxo de autorização sem depender de um terceiro.');

  if dev_cpf is null then
    raise warning 'Conta de desenvolvimento sem CPF no perfil — a isenção vale pelo user_id, mas não seguirá o CPF se outra conta for criada com ele.';
  end if;
end $$;

notify pgrst, 'reload schema';
