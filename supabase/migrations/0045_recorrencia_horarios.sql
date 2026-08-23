-- Recorrência de horários (avulso / semanal / quinzenal / personalizada).
-- Até aqui `availability_slots` só entendia "toda semana, nesse dia, nesse
-- horário" — sem suporte a horário avulso (uma única data, sem repetir) nem
-- a intervalos diferentes de semanal (quinzenal, ou um padrão livre dentro
-- de um ciclo de 4 semanas).
--
-- `recorrencia_tipo`:
--   'semanal'      — comportamento de sempre, repete toda semana nesse
--                    day_of_week. Default, pra não quebrar nenhum horário
--                    já cadastrado.
--   'avulso'       — não repete: vale só na data em `data_avulsa`. Não
--                    participa do ciclo de 4 semanas.
--   'quinzenal'    — repete a cada 2 semanas a partir de
--                    `recorrencia_data_referencia` (data da 1ª sessão).
--                    Equivalente, no ciclo de 4 semanas, a
--                    recorrencia_semanas_ativas = {1,3}.
--   'personalizada'— a psicanalista escolhe livremente quais semanas do
--                    ciclo de 4 (relativas a `recorrencia_data_referencia`)
--                    ficam ativas, em `recorrencia_semanas_ativas` (ex:
--                    {1,2,4} — toda semana, menos a 3ª do ciclo).
alter table public.availability_slots add column if not exists recorrencia_tipo text not null default 'semanal';
do $$ begin
  alter table public.availability_slots add constraint availability_slots_recorrencia_tipo_check
    check (recorrencia_tipo in ('avulso', 'semanal', 'quinzenal', 'personalizada'));
exception when duplicate_object then null;
end $$;
alter table public.availability_slots add column if not exists data_avulsa date;
alter table public.availability_slots add column if not exists recorrencia_data_referencia date;
alter table public.availability_slots add column if not exists recorrencia_semanas_ativas smallint[];
