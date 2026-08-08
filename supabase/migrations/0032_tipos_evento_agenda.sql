-- J.23: tipos de evento na Agenda (sessão/supervisão individual/grupo,
-- outros) + participantes múltiplos pros tipos "em grupo".
--
-- `tipo` fica em availability_slots (template semanal) E em appointments
-- (ocorrência materializada por data) — mesmo padrão já usado por
-- `modality` nessas duas tabelas. `patient_id` continua valendo só pros
-- tipos individuais; "em grupo" usa as tabelas de participantes novas;
-- "outros" não usa nem um nem outro, só `titulo`.
alter table public.availability_slots add column if not exists tipo text not null default 'sessao_individual';
do $$ begin
  alter table public.availability_slots add constraint availability_slots_tipo_check
    check (tipo in ('sessao_individual', 'sessao_grupo', 'supervisao_individual', 'supervisao_grupo', 'outros'));
exception when duplicate_object then null;
end $$;
alter table public.availability_slots add column if not exists titulo text;

alter table public.appointments add column if not exists tipo text not null default 'sessao_individual';
do $$ begin
  alter table public.appointments add constraint appointments_tipo_check
    check (tipo in ('sessao_individual', 'sessao_grupo', 'supervisao_individual', 'supervisao_grupo', 'outros'));
exception when duplicate_object then null;
end $$;
alter table public.appointments add column if not exists titulo text;

-- ─── slot_participantes (participantes do template "em grupo") ────────
create table if not exists public.slot_participantes (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.availability_slots(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unique(slot_id, patient_id)
);
create index if not exists slot_participantes_slot_id_idx on public.slot_participantes(slot_id);
alter table public.slot_participantes enable row level security;

drop policy if exists "slot_participantes_select_own" on public.slot_participantes;
create policy "slot_participantes_select_own" on public.slot_participantes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "slot_participantes_insert_own" on public.slot_participantes;
create policy "slot_participantes_insert_own" on public.slot_participantes
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

drop policy if exists "slot_participantes_delete_own" on public.slot_participantes;
create policy "slot_participantes_delete_own" on public.slot_participantes
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

-- ─── appointment_participantes (participantes da ocorrência "em grupo") ─
create table if not exists public.appointment_participantes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unique(appointment_id, patient_id)
);
create index if not exists appointment_participantes_appointment_id_idx on public.appointment_participantes(appointment_id);
alter table public.appointment_participantes enable row level security;

drop policy if exists "appointment_participantes_select_own" on public.appointment_participantes;
create policy "appointment_participantes_select_own" on public.appointment_participantes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "appointment_participantes_insert_own" on public.appointment_participantes;
create policy "appointment_participantes_insert_own" on public.appointment_participantes
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

drop policy if exists "appointment_participantes_delete_own" on public.appointment_participantes;
create policy "appointment_participantes_delete_own" on public.appointment_participantes
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));
