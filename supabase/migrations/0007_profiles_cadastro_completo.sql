-- O Cadastro agora coleta CPF, data de nascimento e endereço como
-- obrigatórios (antes só passava nome/crp no metadata do signUp) — o
-- trigger de criação de perfil precisa ler esses campos também, senão a
-- linha nasce sem eles e a psicanalista teria que preenchê-los de novo na
-- primeira edição (era exatamente o bug reportado).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, crp, email, cpf, data_nascimento, endereco)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email,
    new.raw_user_meta_data->>'cpf',
    nullif(new.raw_user_meta_data->>'data_nascimento', '')::date,
    new.raw_user_meta_data->>'endereco'
  );
  return new;
end;
$$;
