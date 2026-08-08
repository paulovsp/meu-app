-- G.20: alternância Paralisação ⇄ Retorno à análise, com histórico.
-- Cada período parado vira uma linha (data_inicio + data_fim, data_fim
-- nula = ainda parado agora). `patients.data_paralizacao` continua sendo
-- a data do período em aberto (ou null se ativo) — já é lido em vários
-- lugares do app (DetalheAnalisanteScreen, tempo parado); o histórico
-- novo só ADICIONA os períodos passados, não substitui essa coluna.
create table if not exists public.patient_paralizacoes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  data_inicio date not null,
  data_fim date,
  created_at timestamptz not null default now()
);
create index if not exists patient_paralizacoes_patient_id_idx on public.patient_paralizacoes(patient_id);
alter table public.patient_paralizacoes enable row level security;

drop policy if exists "patient_paralizacoes_select_own" on public.patient_paralizacoes;
create policy "patient_paralizacoes_select_own" on public.patient_paralizacoes
  for select to authenticated
  using (public.owns_patient(patient_id));

drop policy if exists "patient_paralizacoes_insert_own" on public.patient_paralizacoes;
create policy "patient_paralizacoes_insert_own" on public.patient_paralizacoes
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

drop policy if exists "patient_paralizacoes_update_own" on public.patient_paralizacoes;
create policy "patient_paralizacoes_update_own" on public.patient_paralizacoes
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

drop policy if exists "patient_paralizacoes_delete_own" on public.patient_paralizacoes;
create policy "patient_paralizacoes_delete_own" on public.patient_paralizacoes
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));
