-- Simplificação do cadastro do profissional: os campos de endereço
-- detalhado (cep/logradouro/numero/complemento/bairro) nunca são lidos em
-- nenhum lugar do app além do próprio formulário de cadastro/perfil — só
-- cidade/uf são usados de fato, no rodapé "local e data" do recibo
-- (src/services/fiscalEmissao.js). Mantém cidade/uf, derruba o resto.
--
-- Reemite o gatilho de criação de perfil (0008/0026) sem esses campos.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pendente record;
begin
  insert into public.profiles (
    id, nome, crp, email, cpf, data_nascimento, cidade, uf
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
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
      creditos_ia = creditos_ia + coalesce(pendente.valor, 0) / 5.08
    where id = new.id;

    update public.pagamentos_pendentes
    set processado = true
    where email = new.email and not processado;
  end if;

  return new;
end;
$$;

alter table public.profiles
  drop column if exists cep,
  drop column if exists logradouro,
  drop column if exists numero,
  drop column if exists complemento,
  drop column if exists bairro;
