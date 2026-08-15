-- Item 5 da leva de correções pós-teste (15/08/2026): separa "Analisantes"
-- de "Supervisionandos" — um paciente pode ser um, o outro, ou os dois ao
-- mesmo tempo. Vínculo não é exclusivo, por isso dois booleans em vez de um
-- enum único. Default mantém todo cadastro existente como só-analisante
-- (comportamento atual preservado sem precisar de backfill manual).
alter table public.patients add column if not exists eh_analisante boolean not null default true;
alter table public.patients add column if not exists eh_supervisionando boolean not null default false;
