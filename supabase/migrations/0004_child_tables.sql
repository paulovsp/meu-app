-- Fase 1: schema completo (com RLS) das 10 tabelas com patient_id + a
-- tabela transcript_turns (que referencia session_id direto). O código de
-- acesso (database.js) só passa a usar estas tabelas nas Fases 2-4 — esta
-- migração só garante que, quando chegar a hora, o schema já está pronto e
-- seguro (nenhuma tabela existe no Postgres sem RLS habilitada).
--
-- `nucleos_eventos_linha_tempo` fica de fora — confirmado código morto no
-- app atual (nenhuma função lê/escreve nela).

-- ─── sessions ──────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text,
  online_platform text,
  date timestamptz,
  transcript text,
  audio_uri text,
  category text,
  duration_seconds integer,
  created_at timestamptz not null default now()
);
create index if not exists sessions_patient_id_idx on public.sessions(patient_id);
alter table public.sessions enable row level security;
drop policy if exists "sessions_all_own" on public.sessions;
create policy "sessions_all_own" on public.sessions
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- `transcript_turns` não tem patient_id, só session_id — este helper sobe
-- mais um nível (session -> patient -> dono). Fica aqui, e não em
-- 0003_ownership_helpers.sql, porque só pode ser criada depois que
-- `sessions` existe (funções `language sql` são validadas contra o
-- catálogo já na criação).
create or replace function public.owns_session(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    join public.patients p on p.id = s.patient_id
    where s.id = p_session_id and p.user_id = auth.uid()
  );
$$;
grant execute on function public.owns_session(uuid) to authenticated;

-- ─── records ───────────────────────────────────────────────────────────
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  type text,
  title text,
  content text,
  file_uri text,
  date timestamptz,
  category text,
  author text check (author in ('analyst', 'analysand', 'alternado')),
  created_at timestamptz not null default now()
);
create index if not exists records_patient_id_idx on public.records(patient_id);
create index if not exists records_session_id_idx on public.records(session_id);
alter table public.records enable row level security;
drop policy if exists "records_all_own" on public.records;
create policy "records_all_own" on public.records
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── transcript_turns ──────────────────────────────────────────────────
create table if not exists public.transcript_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  turn_index integer not null,
  speaker text not null check (speaker in ('analyst', 'analysand')),
  text text not null,
  start_time_seconds numeric,
  end_time_seconds numeric
);
create index if not exists transcript_turns_session_id_idx on public.transcript_turns(session_id);
alter table public.transcript_turns enable row level security;
drop policy if exists "transcript_turns_all_own" on public.transcript_turns;
create policy "transcript_turns_all_own" on public.transcript_turns
  for all to authenticated
  using (public.owns_session(session_id))
  with check (public.owns_session(session_id));

-- ─── availability_slots ────────────────────────────────────────────────
-- Slots sem patient_id (horário livre) não têm dono a checar via
-- owns_patient — por isso a tabela leva user_id próprio (dono do calendário),
-- e a RLS checa user_id = auth.uid() direto, sem depender de patient_id.
create table if not exists public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null,
  start_time text not null,
  end_time text not null,
  modality text not null,
  patient_id uuid references public.patients(id) on delete set null
);
-- ALTER defensivo: cobre o caso da tabela já existir (de uma tentativa
-- anterior desta migration) sem a coluna user_id, que foi adicionada depois.
alter table public.availability_slots add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists availability_slots_user_id_idx on public.availability_slots(user_id);
create index if not exists availability_slots_patient_id_idx on public.availability_slots(patient_id);
alter table public.availability_slots enable row level security;
drop policy if exists "availability_slots_all_own" on public.availability_slots;
create policy "availability_slots_all_own" on public.availability_slots
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── appointments ──────────────────────────────────────────────────────
-- user_id próprio (dono do calendário) pelos mesmos motivos de
-- availability_slots acima, e porque a unicidade de (date, start_time) só
-- faz sentido por terapeuta — duas terapeutas diferentes podem ter
-- compromisso no mesmo horário, cada uma no seu próprio calendário.
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  date date not null,
  start_time text not null,
  end_time text not null,
  modality text not null,
  status text not null default 'agendado'
);
-- ALTER defensivo: mesmo motivo do availability_slots acima.
alter table public.appointments add column if not exists user_id uuid references auth.users(id) on delete cascade;
do $$ begin
  alter table public.appointments add constraint appointments_user_id_date_start_time_key unique (user_id, date, start_time);
exception when duplicate_object then null;
end $$;
create index if not exists appointments_user_id_idx on public.appointments(user_id);
create index if not exists appointments_patient_id_idx on public.appointments(patient_id);
alter table public.appointments enable row level security;
drop policy if exists "appointments_all_own" on public.appointments;
create policy "appointments_all_own" on public.appointments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── pagamentos ────────────────────────────────────────────────────────
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  ano integer not null,
  mes integer not null,
  recebido boolean not null default false,
  data_recebimento timestamptz,
  valor numeric,
  unique (patient_id, ano, mes)
);
create index if not exists pagamentos_patient_id_idx on public.pagamentos(patient_id);
alter table public.pagamentos enable row level security;
drop policy if exists "pagamentos_all_own" on public.pagamentos;
create policy "pagamentos_all_own" on public.pagamentos
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── nucleos_evidencias ────────────────────────────────────────────────
create table if not exists public.nucleos_evidencias (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  registro_id uuid, -- polimórfico (session ou record, ver origem_tipo) — sem FK
  origem_tipo text not null,
  tipo_registro text,
  data_sessao date,
  trecho_literal text not null,
  posicao_inicio integer,
  posicao_fim integer,
  nucleo text not null,
  indicador text,
  via text,
  intensidade integer,
  confianca numeric,
  justificativa text,
  diferenciais_considerados text,
  fonte text not null default 'ia',
  status_validacao text not null default 'pendente',
  validado_por text,
  validado_em timestamptz,
  rubrica_versao text,
  criado_em timestamptz not null default now()
);
create index if not exists nucleos_evidencias_patient_id_idx on public.nucleos_evidencias(patient_id);
alter table public.nucleos_evidencias enable row level security;
drop policy if exists "nucleos_evidencias_all_own" on public.nucleos_evidencias;
create policy "nucleos_evidencias_all_own" on public.nucleos_evidencias
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── nucleos_transicoes ────────────────────────────────────────────────
create table if not exists public.nucleos_transicoes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  registro_id uuid, -- polimórfico — sem FK
  de_nucleo text,
  para_nucleo text,
  evidencia_origem_id uuid references public.nucleos_evidencias(id) on delete set null,
  evidencia_destino_id uuid references public.nucleos_evidencias(id) on delete set null,
  gatilho_trecho text,
  gatilho_tipo text,
  asa_mediadora text,
  diagonal_direta boolean not null default false,
  status_validacao text default 'pendente',
  criado_em timestamptz not null default now()
);
create index if not exists nucleos_transicoes_patient_id_idx on public.nucleos_transicoes(patient_id);
alter table public.nucleos_transicoes enable row level security;
drop policy if exists "nucleos_transicoes_all_own" on public.nucleos_transicoes;
create policy "nucleos_transicoes_all_own" on public.nucleos_transicoes
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── nucleos_snapshots ─────────────────────────────────────────────────
create table if not exists public.nucleos_snapshots (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  criado_em timestamptz not null default now(),
  sessoes_incluidas integer,
  metricas jsonb not null
);
create index if not exists nucleos_snapshots_patient_id_idx on public.nucleos_snapshots(patient_id);
alter table public.nucleos_snapshots enable row level security;
drop policy if exists "nucleos_snapshots_all_own" on public.nucleos_snapshots;
create policy "nucleos_snapshots_all_own" on public.nucleos_snapshots
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── nucleos_perguntas ─────────────────────────────────────────────────
create table if not exists public.nucleos_perguntas (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  pergunta text not null,
  opcoes jsonb,
  contexto_registro_id uuid, -- polimórfico — sem FK
  tipo text,
  status text default 'pendente',
  resposta text,
  evidencia_gerada_id uuid references public.nucleos_evidencias(id) on delete set null,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz
);
create index if not exists nucleos_perguntas_patient_id_idx on public.nucleos_perguntas(patient_id);
alter table public.nucleos_perguntas enable row level security;
drop policy if exists "nucleos_perguntas_all_own" on public.nucleos_perguntas;
create policy "nucleos_perguntas_all_own" on public.nucleos_perguntas
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- ─── objetivo_evidencias ───────────────────────────────────────────────
create table if not exists public.objetivo_evidencias (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  registro_id uuid, -- polimórfico — sem FK
  origem_tipo text not null,
  tipo_registro text,
  categoria text not null,
  trecho_literal text not null,
  data_registro date,
  status_validacao text not null default 'pendente',
  criado_em timestamptz not null default now()
);
create index if not exists objetivo_evidencias_patient_id_idx on public.objetivo_evidencias(patient_id);
alter table public.objetivo_evidencias enable row level security;
drop policy if exists "objetivo_evidencias_all_own" on public.objetivo_evidencias;
create policy "objetivo_evidencias_all_own" on public.objetivo_evidencias
  for all to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));
