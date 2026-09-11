-- ═══════════════════════════════════════════════════════════════════════
-- Consultório de demonstração — compromissos na agenda
-- ═══════════════════════════════════════════════════════════════════════
--
-- Gera os compromissos a partir dos horários fixos: quatro semanas para
-- trás e duas para a frente. Sem isso, a Agenda — que é a primeira tela
-- que o visitante abre — aparece vazia ou com compromissos que não
-- correspondem a ficha nenhuma.
--
-- O passado não é todo "realizado". Uma agenda em que nada falhou em
-- quatro semanas não é um consultório, é uma planilha: há faltas, um
-- cancelamento e a interrupção da Dora, que é o que dá sentido aos avisos
-- de sessão a confirmar e às telas de cobrança.
--
-- Reexecutável.

do $$
declare
  freud uuid;
  hoje date := current_date;
begin
  select id into freud from public.profiles where email = 'oseusig@gmail.com';
  if freud is null then raise exception 'Conta de demonstração não encontrada.'; end if;

  delete from public.appointment_participantes where user_id = freud;
  delete from public.appointments where user_id = freud;

  -- Um compromisso para cada ocorrência do horário fixo, de -28 a +14
  -- dias. `date_trunc('week')` no Postgres começa na segunda, que é o
  -- mesmo day_of_week = 1 usado nos slots.
  insert into public.appointments
    (user_id, patient_id, date, start_time, end_time, modality, tipo, titulo, status)
  select
    freud,
    s.patient_id,
    dia,
    s.start_time,
    s.end_time,
    s.modality,
    s.tipo,
    s.titulo,
    case
      when dia > hoje then 'agendado'
      -- Dora interrompeu em 08/09: dali em diante o horário fica
      -- reservado, mas não há compromisso realizado.
      when p.nome = 'Dora' and dia > date '2026-09-08' then 'cancelado'
      -- Faltas espalhadas, com motivo plausível na clínica: Katharina
      -- faltou na semana da sessão mais difícil, Hans no início do
      -- tratamento, Jung numa supervisão online.
      when p.nome = 'Katharina' and dia between date '2026-08-26' and date '2026-08-28' then 'nao_realizado'
      when p.nome = 'Pequeno Hans' and dia = date '2026-08-18' then 'nao_realizado'
      when p.nome = 'Carl Jung' and dia = hoje - 14 then 'cancelado'
      else 'realizado'
    end
  from public.availability_slots s
  left join public.patients p on p.id = s.patient_id
  cross join lateral (
    select d::date as dia
    from generate_series(hoje - 28, hoje + 14, interval '1 day') as d
    where extract(isodow from d) = s.day_of_week
  ) datas
  where s.user_id = freud
    and s.recorrencia_tipo = 'semanal'
    -- Ninguém começa antes de entrar em análise.
    and (p.data_inicio is null or dia >= p.data_inicio);

  -- A Sociedade das Quartas-Feiras tem participantes, como todo
  -- atendimento de grupo.
  insert into public.appointment_participantes
    (appointment_id, patient_id, user_id, presente, valor_sessao, tipo_cobranca)
  select a.id, sp.patient_id, freud,
         case when a.status = 'realizado' then true else false end,
         sp.valor_sessao, sp.tipo_cobranca
  from public.appointments a
  join public.availability_slots s
    on s.user_id = freud and s.tipo = 'supervisao_grupo'
  join public.slot_participantes sp on sp.slot_id = s.id
  where a.user_id = freud and a.tipo = 'supervisao_grupo';
end $$;
