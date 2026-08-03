-- Controle de assinatura: hoje o único bloqueio do app é `creditos_ia <= 0`
-- e `plano_ia` só troca um rótulo no Perfil — qualquer conta criada usa
-- agenda, analisantes, sessões, registros, recibos e financeiro de graça,
-- pra sempre. Esta migration adiciona o estado real da assinatura e passa
-- a exigi-la pra ESCRITA (nunca leitura — ver comentário nas policies
-- abaixo, e AGENTS/CLAUDE.md: Termos publicados garantem acesso de leitura
-- até o fim do período pago, e a Resolução CFP 001/2009 obriga a guarda do
-- prontuário por 5 anos; sequestrar dados por inadimplência é problema
-- jurídico pra psicanalista e de reputação pro produto).

alter table public.profiles
  add column if not exists assinatura_status text not null default 'sem_assinatura'
    check (assinatura_status in ('sem_assinatura', 'ativa', 'inadimplente', 'cancelada', 'cortesia')),
  add column if not exists assinatura_expira_em timestamptz,
  add column if not exists mp_preapproval_id text;

-- Única fonte de verdade sobre "a conta pode escrever" — todo o resto do
-- sistema (RLS de todas as tabelas + Edge Functions de IA) chama esta
-- função, nunca replica a regra. 'cortesia' conta como ativa (contas de
-- apoio/revisão, ver migration 0024) desde que ainda dentro da validade.
create or replace function public.assinatura_ativa(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and assinatura_status in ('ativa', 'cortesia')
      and assinatura_expira_em > now()
  );
$$;
grant execute on function public.assinatura_ativa(uuid) to authenticated;

-- Conta de revisor do Google Play (já ativada como plano/créditos na sessão
-- anterior) e conta do desenvolvedor — cortesia, validade longa, não afeta
-- métrica de conversão real (ver origem = 'apoio' na migration 0024).
update public.profiles
set assinatura_status = 'cortesia', assinatura_expira_em = '2030-01-01'
where email in ('oseusig@gmail.com', 'paulovsp@gmail.com');

-- ═══════════════════════════════════════════════════════════════════════
-- RLS: SELECT permanece sempre liberado pro dono (leitura nunca é
-- bloqueada — exportar/consultar dado clínico é direito garantido nos
-- Termos, independente do status da assinatura). INSERT/UPDATE/DELETE
-- passam a exigir também public.assinatura_ativa(auth.uid()), além da
-- checagem de posse que já existia. Cada tabela que tinha uma policy
-- única "for all" agora tem 4 policies (select/insert/update/delete) —
-- Postgres não permite combinar comandos diferentes numa policy só, e
-- UPDATE/DELETE precisam do gate tanto em `using` (pra nem aparecer como
-- alvo possível) quanto em `with check` (update) quando aplicável.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── patients (posse direta por user_id) ──────────────────────────────
drop policy if exists "patients_all_own" on public.patients;

create policy "patients_select_own" on public.patients
  for select to authenticated
  using (user_id = auth.uid());

create policy "patients_insert_own" on public.patients
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "patients_update_own" on public.patients
  for update to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()))
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "patients_delete_own" on public.patients
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

-- ─── sessions (posse via owns_patient) ────────────────────────────────
drop policy if exists "sessions_all_own" on public.sessions;

create policy "sessions_select_own" on public.sessions
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "sessions_insert_own" on public.sessions
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "sessions_update_own" on public.sessions
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "sessions_delete_own" on public.sessions
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── records (posse via owns_patient) ─────────────────────────────────
drop policy if exists "records_all_own" on public.records;

create policy "records_select_own" on public.records
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "records_insert_own" on public.records
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "records_update_own" on public.records
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "records_delete_own" on public.records
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── transcript_turns (posse via owns_session) ────────────────────────
drop policy if exists "transcript_turns_all_own" on public.transcript_turns;

create policy "transcript_turns_select_own" on public.transcript_turns
  for select to authenticated
  using (public.owns_session(session_id));

create policy "transcript_turns_insert_own" on public.transcript_turns
  for insert to authenticated
  with check (public.owns_session(session_id) and public.assinatura_ativa(auth.uid()));

create policy "transcript_turns_update_own" on public.transcript_turns
  for update to authenticated
  using (public.owns_session(session_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_session(session_id) and public.assinatura_ativa(auth.uid()));

create policy "transcript_turns_delete_own" on public.transcript_turns
  for delete to authenticated
  using (public.owns_session(session_id) and public.assinatura_ativa(auth.uid()));

-- ─── availability_slots (posse direta por user_id) ────────────────────
drop policy if exists "availability_slots_all_own" on public.availability_slots;

create policy "availability_slots_select_own" on public.availability_slots
  for select to authenticated
  using (user_id = auth.uid());

create policy "availability_slots_insert_own" on public.availability_slots
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "availability_slots_update_own" on public.availability_slots
  for update to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()))
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "availability_slots_delete_own" on public.availability_slots
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

-- ─── appointments (posse direta por user_id) ──────────────────────────
drop policy if exists "appointments_all_own" on public.appointments;

create policy "appointments_select_own" on public.appointments
  for select to authenticated
  using (user_id = auth.uid());

create policy "appointments_insert_own" on public.appointments
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "appointments_update_own" on public.appointments
  for update to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()))
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

create policy "appointments_delete_own" on public.appointments
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

-- ─── pagamentos (posse via owns_patient) ───────────────────────────────
drop policy if exists "pagamentos_all_own" on public.pagamentos;

create policy "pagamentos_select_own" on public.pagamentos
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "pagamentos_insert_own" on public.pagamentos
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "pagamentos_update_own" on public.pagamentos
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "pagamentos_delete_own" on public.pagamentos
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── nucleos_evidencias (feature arquivada, mesma regra por consistência) ──
drop policy if exists "nucleos_evidencias_all_own" on public.nucleos_evidencias;

create policy "nucleos_evidencias_select_own" on public.nucleos_evidencias
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "nucleos_evidencias_insert_own" on public.nucleos_evidencias
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_evidencias_update_own" on public.nucleos_evidencias
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_evidencias_delete_own" on public.nucleos_evidencias
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── nucleos_transicoes (feature arquivada) ────────────────────────────
drop policy if exists "nucleos_transicoes_all_own" on public.nucleos_transicoes;

create policy "nucleos_transicoes_select_own" on public.nucleos_transicoes
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "nucleos_transicoes_insert_own" on public.nucleos_transicoes
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_transicoes_update_own" on public.nucleos_transicoes
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_transicoes_delete_own" on public.nucleos_transicoes
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── nucleos_snapshots (feature arquivada) ─────────────────────────────
drop policy if exists "nucleos_snapshots_all_own" on public.nucleos_snapshots;

create policy "nucleos_snapshots_select_own" on public.nucleos_snapshots
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "nucleos_snapshots_insert_own" on public.nucleos_snapshots
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_snapshots_update_own" on public.nucleos_snapshots
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_snapshots_delete_own" on public.nucleos_snapshots
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── nucleos_perguntas (feature arquivada) ─────────────────────────────
drop policy if exists "nucleos_perguntas_all_own" on public.nucleos_perguntas;

create policy "nucleos_perguntas_select_own" on public.nucleos_perguntas
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "nucleos_perguntas_insert_own" on public.nucleos_perguntas
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_perguntas_update_own" on public.nucleos_perguntas
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "nucleos_perguntas_delete_own" on public.nucleos_perguntas
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── objetivo_evidencias (feature arquivada) ───────────────────────────
drop policy if exists "objetivo_evidencias_all_own" on public.objetivo_evidencias;

create policy "objetivo_evidencias_select_own" on public.objetivo_evidencias
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "objetivo_evidencias_insert_own" on public.objetivo_evidencias
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "objetivo_evidencias_update_own" on public.objetivo_evidencias
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "objetivo_evidencias_delete_own" on public.objetivo_evidencias
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── relatorios (feature arquivada) ────────────────────────────────────
drop policy if exists "relatorios_all_own" on public.relatorios;

create policy "relatorios_select_own" on public.relatorios
  for select to authenticated
  using (public.owns_patient(patient_id));

create policy "relatorios_insert_own" on public.relatorios
  for insert to authenticated
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "relatorios_update_own" on public.relatorios
  for update to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()))
  with check (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

create policy "relatorios_delete_own" on public.relatorios
  for delete to authenticated
  using (public.owns_patient(patient_id) and public.assinatura_ativa(auth.uid()));

-- ─── autorizacoes_transcricao ──────────────────────────────────────────
-- Só tinha select/insert (nunca teve update/delete pra authenticated —
-- só a Edge Function, com service_role, altera o status). Pedir uma nova
-- autorização de gravação é parte do fluxo de "gravar", então também exige
-- assinatura ativa; select continua livre (ver o pedido já enviado).
drop policy if exists "autorizacoes_insert_own" on public.autorizacoes_transcricao;

create policy "autorizacoes_insert_own" on public.autorizacoes_transcricao
  for insert to authenticated
  with check (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));
