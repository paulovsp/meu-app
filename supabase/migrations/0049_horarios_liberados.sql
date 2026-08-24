-- "Apagar só este horário" (item 1, v16): antes, apagar um compromisso de
-- uma data específica não impedia a Agenda de recriar o mesmo compromisso
-- (mesmo paciente) na próxima vez que a tela carregasse — ensureAppointmentsForDate
-- / inserirAppointmentSeNaoExiste usam o patient_id do horário recorrente
-- (availability_slots) pra preencher automaticamente cada data, sem saber
-- que aquela data específica foi esvaziada de propósito. Resultado: o
-- ícone nunca saía da Agenda, e não dava pra marcar outra coisa ali.
--
-- Esta tabela só marca "essa data + esse horário de início foram liberados
-- de propósito" — não mexe no horário recorrente, que continua valendo
-- normalmente pras outras semanas. Consultada em dois pontos: antes de
-- recriar automaticamente um compromisso (pra não recriar o que foi
-- liberado) e na Agenda, pra mostrar o horário como livre.
create table if not exists public.horarios_liberados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_time text not null,
  criado_em timestamptz not null default now(),
  unique (user_id, date, start_time)
);
create index if not exists horarios_liberados_user_id_idx on public.horarios_liberados(user_id);
alter table public.horarios_liberados enable row level security;
drop policy if exists "horarios_liberados_all_own" on public.horarios_liberados;
create policy "horarios_liberados_all_own" on public.horarios_liberados
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.horarios_liberados to authenticated;
