-- Tabela pra relatórios arquivados por analisante, mesmo padrão
-- owns_patient das outras tabelas-filha de patients (0004).

create table if not exists public.relatorios (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  tipo text not null,
  parametros text,
  conteudo text not null,
  custo_estimado numeric not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists relatorios_patient_id_idx on public.relatorios(patient_id);
alter table public.relatorios enable row level security;
drop policy if exists "relatorios_all_own" on public.relatorios;
create policy "relatorios_all_own" on public.relatorios
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));
grant select, insert, update, delete on public.relatorios to authenticated;
