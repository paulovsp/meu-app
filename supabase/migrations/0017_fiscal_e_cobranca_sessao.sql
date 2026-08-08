-- Fase Fiscal: Nota/Recibo individualizado por analisante, envio fiscal
-- automático (a cada sessão / semanal / mensal), e um novo modelo de
-- cobrança "por sessão" (além do já existente "mensal").

-- ─── patients: modelo de cobrança + config fiscal ─────────────────────
alter table public.patients add column if not exists tipo_cobranca text not null default 'mensal';
do $$ begin
  alter table public.patients add constraint patients_tipo_cobranca_check
    check (tipo_cobranca in ('mensal', 'por_sessao'));
exception when duplicate_object then null;
end $$;

alter table public.patients add column if not exists tipo_emissao_fiscal text not null default 'recibo';
do $$ begin
  alter table public.patients add constraint patients_tipo_emissao_fiscal_check
    check (tipo_emissao_fiscal in ('recibo', 'nota'));
exception when duplicate_object then null;
end $$;

alter table public.patients add column if not exists fiscal_frequencia_automatica text;
do $$ begin
  alter table public.patients add constraint patients_fiscal_frequencia_check
    check (fiscal_frequencia_automatica is null or fiscal_frequencia_automatica in ('sessao', 'semanal', 'mensal'));
exception when duplicate_object then null;
end $$;

alter table public.patients add column if not exists fiscal_dia_semana smallint;
do $$ begin
  alter table public.patients add constraint patients_fiscal_dia_semana_check
    check (fiscal_dia_semana is null or fiscal_dia_semana between 0 and 6);
exception when duplicate_object then null;
end $$;

alter table public.patients add column if not exists fiscal_dia_mes smallint;
do $$ begin
  alter table public.patients add constraint patients_fiscal_dia_mes_check
    check (fiscal_dia_mes is null or fiscal_dia_mes between 1 and 30);
exception when duplicate_object then null;
end $$;

-- Duas colunas de "último envio" (não uma): trocar de cadência não pode
-- deixar uma data velha bloquear/liberar a cadência nova incorretamente.
alter table public.patients add column if not exists fiscal_ultimo_envio_semanal date;
alter table public.patients add column if not exists fiscal_ultimo_envio_mensal date;

-- ─── pagamentos: cada sessão paga vira sua própria linha ──────────────
-- appointment_id preenchido = pagamento por sessão; nulo = fluxo mensal
-- atual (inalterado). A unicidade antiga (1 linha por patient/ano/mes)
-- só continua valendo pra linhas mensais; sessões têm sua própria.
alter table public.pagamentos add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

alter table public.pagamentos drop constraint if exists pagamentos_patient_id_ano_mes_key;
create unique index if not exists pagamentos_mensal_unique on public.pagamentos(patient_id, ano, mes) where appointment_id is null;
create unique index if not exists pagamentos_sessao_unique on public.pagamentos(appointment_id) where appointment_id is not null;
create index if not exists pagamentos_patient_ano_mes_idx on public.pagamentos(patient_id, ano, mes);
