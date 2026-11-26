-- Férias (26/11/2026, pedido do Paulo).
--
-- Dois jeitos de sair de férias:
--   • do analista (tipo 'analista', patient_id nulo): o consultório inteiro
--     para no período. Quem paga e quem não paga fica em `ferias_pacientes`,
--     uma linha por cliente; quem não tiver linha (cadastrado depois, por
--     exemplo) segue `ferias.paga`.
--   • de um cliente (tipo 'cliente'): só os horários daquela pessoa param;
--     `ferias.paga` diz se a férias é paga ou não.
--
-- Na agenda, cada compromisso que cai nas férias passa a ter
-- status = 'ferias' (a coluna `appointments.status` é texto livre, sem
-- check). Regras de cobrança em src/services/ferias.js: férias paga cobra
-- como sessão feita; não paga sai da conta, como cancelamento; mensalidade
-- fixa com férias não pagas tem desconto proporcional.

create table if not exists public.ferias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('analista', 'cliente')),
  patient_id uuid references public.patients(id) on delete cascade,
  data_inicio date not null,
  data_fim date not null,
  paga boolean not null default false,
  observacao text,
  created_at timestamptz not null default now(),
  constraint ferias_periodo_valido check (data_fim >= data_inicio and data_fim - data_inicio <= 366),
  constraint ferias_cliente_tem_pessoa check ((tipo = 'cliente') = (patient_id is not null))
);
create index if not exists ferias_user_id_idx on public.ferias(user_id);
create index if not exists ferias_patient_id_idx on public.ferias(patient_id);

create table if not exists public.ferias_pacientes (
  ferias_id uuid not null references public.ferias(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paga boolean not null,
  primary key (ferias_id, patient_id)
);
create index if not exists ferias_pacientes_user_id_idx on public.ferias_pacientes(user_id);
create index if not exists ferias_pacientes_patient_id_idx on public.ferias_pacientes(patient_id);

alter table public.ferias enable row level security;
alter table public.ferias_pacientes enable row level security;

-- Mesmo padrão de appointments (0025): lê sempre o que é seu; escreve só
-- com assinatura ativa. Cliente das férias tem que ser seu também.
drop policy if exists "ferias_select_own" on public.ferias;
create policy "ferias_select_own" on public.ferias
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "ferias_insert_own" on public.ferias;
create policy "ferias_insert_own" on public.ferias
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.assinatura_ativa(auth.uid())
    and (patient_id is null or public.owns_patient(patient_id))
  );

drop policy if exists "ferias_update_own" on public.ferias;
create policy "ferias_update_own" on public.ferias
  for update to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()))
  with check (
    user_id = auth.uid() and public.assinatura_ativa(auth.uid())
    and (patient_id is null or public.owns_patient(patient_id))
  );

drop policy if exists "ferias_delete_own" on public.ferias;
create policy "ferias_delete_own" on public.ferias
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

drop policy if exists "ferias_pacientes_select_own" on public.ferias_pacientes;
create policy "ferias_pacientes_select_own" on public.ferias_pacientes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "ferias_pacientes_insert_own" on public.ferias_pacientes;
create policy "ferias_pacientes_insert_own" on public.ferias_pacientes
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.assinatura_ativa(auth.uid())
    and public.owns_patient(patient_id)
    and exists (select 1 from public.ferias f where f.id = ferias_id and f.user_id = auth.uid())
  );

drop policy if exists "ferias_pacientes_update_own" on public.ferias_pacientes;
create policy "ferias_pacientes_update_own" on public.ferias_pacientes
  for update to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()))
  with check (
    user_id = auth.uid() and public.assinatura_ativa(auth.uid())
    and public.owns_patient(patient_id)
    and exists (select 1 from public.ferias f where f.id = ferias_id and f.user_id = auth.uid())
  );

drop policy if exists "ferias_pacientes_delete_own" on public.ferias_pacientes;
create policy "ferias_pacientes_delete_own" on public.ferias_pacientes
  for delete to authenticated
  using (user_id = auth.uid() and public.assinatura_ativa(auth.uid()));

grant select, insert, update, delete on public.ferias to authenticated;
grant select, insert, update, delete on public.ferias_pacientes to authenticated;
grant all on table public.ferias to service_role;
grant all on table public.ferias_pacientes to service_role;

-- Conta de demonstração continua só leitura (mesmo bloqueio de 0097).
do $$
declare
  t text;
begin
  foreach t in array array['ferias', 'ferias_pacientes'] loop
    execute format('drop policy if exists %I on public.%I', 'demo_sem_insert_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'demo_sem_update_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'demo_sem_delete_' || t, t);
    execute format($f$
      create policy %I on public.%I as restrictive for insert to authenticated
        with check (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_insert_' || t, t);
    execute format($f$
      create policy %I on public.%I as restrictive for update to authenticated
        using (not public.eh_conta_demonstracao())
        with check (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_update_' || t, t);
    execute format($f$
      create policy %I on public.%I as restrictive for delete to authenticated
        using (not public.eh_conta_demonstracao())
    $f$, 'demo_sem_delete_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
