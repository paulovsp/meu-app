-- Exceção à trava de CPF único (migration 0009): só o CPF do próprio
-- desenvolvedor/dono da conta pode ter mais de uma conta cadastrada — útil
-- pra testar múltiplas contas sem precisar de CPFs fictícios. Todos os
-- outros CPFs continuam com a trava de unicidade normal.
alter table public.profiles drop constraint if exists profiles_cpf_unique;

create unique index if not exists profiles_cpf_unique_idx
  on public.profiles(cpf)
  where cpf is distinct from '338.702.668-48';

create or replace function public.cpf_disponivel(p_cpf text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_cpf = '338.702.668-48' or not exists (select 1 from public.profiles where cpf = p_cpf);
$$;
