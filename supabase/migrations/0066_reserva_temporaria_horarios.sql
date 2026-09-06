-- Reserva com prazo para horários de analisante em paralisação.
--
-- Até aqui a paralisação oferecia duas saídas: liberar o horário na hora, ou
-- mantê-lo reservado PARA SEMPRE. Na prática a segunda é a escolhida (ninguém
-- quer perder o horário de um analisante que vai voltar), e o horário ficava
-- ocupado indefinidamente na Agenda por alguém que não está vindo — sem nada
-- que lembrasse a profissional de revisar.
--
-- Agora a reserva tem prazo. Vencido, o horário vira livre sozinho,
-- mantendo a modalidade que já tinha (online ou presencial) — que é o que
-- interessa: o horário volta ao mercado do mesmo jeito que era usado.
alter table public.availability_slots
  add column if not exists reservado_ate date;

comment on column public.availability_slots.reservado_ate is
  'Até quando o horário segue reservado para o analisante em paralisação. Vencido, o horário é liberado automaticamente mantendo a modalidade.';

-- Liberação diária, em SQL puro: não precisa de Edge Function nem segredo.
-- Roda de madrugada porque o efeito é visível na Agenda do dia seguinte.
--
-- `patient_id = null` é o que torna o horário livre; a modalidade fica como
-- estava, de propósito. Os compromissos futuros daquele analisante naquele
-- horário saem junto — senão o horário apareceria livre e ocupado ao mesmo
-- tempo, cada tela lendo de um lugar.
select cron.schedule(
  'liberar-horarios-reservados',
  '10 4 * * *',
  $$
  delete from public.appointments a
   using public.availability_slots s
   where a.patient_id = s.patient_id
     and a.start_time = s.start_time
     and a.date >= current_date
     and s.reservado_ate is not null
     and s.reservado_ate < current_date;

  update public.availability_slots
     set patient_id = null, reservado_ate = null
   where reservado_ate is not null
     and reservado_ate < current_date;
  $$
);
