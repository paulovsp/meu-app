-- Endereço deixa de ser um texto único e vira campos separados: os que
-- vêm da busca por CEP (logradouro/bairro/cidade/uf) ficam travados pro
-- usuário depois de preenchidos automaticamente; número é obrigatório
-- (o CEP não sabe o número da casa); complemento é opcional. Ter cada
-- pedaço em sua própria coluna também é o que permite recarregar o
-- formulário de edição com os valores certos depois — um texto único
-- composto não dava pra "desmontar" de volta com segurança.
alter table public.profiles
  drop column if exists endereco,
  add column if not exists cep text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cidade text,
  add column if not exists uf text;

-- O gatilho de criação de perfil precisa gravar essas colunas novas a
-- partir do metadata do signUp, no lugar do antigo campo "endereco" único.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
  return new;
end;
$$;
