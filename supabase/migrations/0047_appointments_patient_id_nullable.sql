-- `appointments.patient_id` ainda era `not null` (migration 0004) mesmo
-- depois do item J.23 (tipos de evento) ter introduzido "sessão em grupo",
-- "supervisão em grupo" e "outros" — eventos que não têm um paciente único
-- (usam `appointment_participantes`/título em vez de `patient_id`). Todo
-- horário desses tipos sempre falhava ao ser aberto/materializado na
-- Agenda com "null value in column patient_id violates not null
-- constraint" — nunca foi possível nem abrir pra conferir.
alter table public.appointments alter column patient_id drop not null;
