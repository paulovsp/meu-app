-- Sessão/supervisão em grupo não tinha NENHUM fluxo de presença nem
-- pagamento por integrante — `perguntarPagamentoSessao` só olhava
-- `patient_tipo_cobranca` do paciente único, sempre null pra grupo.
--
-- `presente`: por ocorrência (não no template `slot_participantes`) —
-- null = ainda não confirmado, true = esteve, false = faltou.
alter table public.appointment_participantes add column if not exists presente boolean;

-- `pagamentos_sessao_unique` era só em `appointment_id` (1 pagamento por
-- compromisso) — funcionava pra sessão individual (1 paciente = 1
-- pagamento), mas impedia registrar o pagamento de cada integrante
-- separadamente num compromisso em grupo (N pacientes, N pagamentos).
-- `patient_id` já é preenchido em todo pagamento por sessão desde sempre
-- (ver confirmarPagamentoSessao em database.js), então a troca pra
-- composto não muda nada pro caso individual (continua único por
-- compromisso) e libera o caso em grupo.
drop index if exists pagamentos_sessao_unique;
create unique index if not exists pagamentos_sessao_unique on public.pagamentos(appointment_id, patient_id) where appointment_id is not null;
