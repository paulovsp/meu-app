-- Impede duas contas com o mesmo CPF. A constraint UNIQUE do Postgres
-- permite múltiplos NULL (não afeta contas antigas sem CPF), só bloqueia
-- valores repetidos de verdade.
alter table public.profiles
  add constraint profiles_cpf_unique unique (cpf);

-- Checagem prévia usável ANTES do cadastro (o app ainda não tem sessão
-- nesse momento, então roda como "anon"). Só devolve true/false — nunca
-- expõe nenhum dado da conta existente, então é seguro liberar pra anon.
create or replace function public.cpf_disponivel(p_cpf text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from public.profiles where cpf = p_cpf);
$$;
grant execute on function public.cpf_disponivel(text) to anon, authenticated;
