-- Fase 1: funções auxiliares de posse, usadas pelas policies de RLS das
-- tabelas filhas (Fase 2+). SECURITY DEFINER de propósito: a função roda
-- ignorando a RLS de `patients` internamente (ela mesma já filtra por
-- user_id = auth.uid()), evitando recursão de policies e evitando ter que
-- dar SELECT amplo em `patients` pro role `authenticated` só pra permitir
-- o join da policy da tabela filha.

create or replace function public.owns_patient(p_patient_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.patients
    where id = p_patient_id and user_id = auth.uid()
  );
$$;
grant execute on function public.owns_patient(uuid) to authenticated;

-- `owns_session()` (usada pela policy de transcript_turns) é criada em
-- 0004_child_tables.sql, logo depois da tabela `sessions` — funções
-- `language sql` são validadas contra o catálogo já na criação, então
-- não podem referenciar uma tabela que ainda não existe.
