-- A importação do consultório (op-agente, ação `importar_analisante`) grava
-- com a service_role — e a service_role só tinha SELECT em `patients` e
-- `records` (0053) e nada em `patient_paralizacoes`. Os ensaios passavam
-- (só leem); a primeira gravação de verdade parou em "permission denied for
-- table patients". Mesma lição das 0011/0013/0026/0037/0053: RLS habilitada
-- não basta, a service_role precisa de GRANT explícito.
--
-- Só o que a importação usa: criar e completar a ficha do analisante, criar
-- os registros vindos do Drive e o histórico de paralisações.
grant insert, update on public.patients to service_role;
grant insert on public.records to service_role;
grant select, insert on public.patient_paralizacoes to service_role;
