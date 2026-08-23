-- "Sessões sem relato" (Perfil/SessoesStatusScreen) só reconhecia relato
-- feito por gravação de áudio (`sessions.transcript`) — um registro escrito
-- manualmente em Novo Registro (tipo "Sessão") nunca contava como relato de
-- um compromisso específico, porque `records` não tinha como se vincular a
-- um `appointment_id`. Nullable e `on delete set null`: registros antigos e
-- registros de estudo/outros (sem compromisso associado) continuam
-- funcionando sem esse campo.
alter table public.records add column if not exists appointment_id uuid references public.appointments(id) on delete set null;
create index if not exists records_appointment_id_idx on public.records(appointment_id);
