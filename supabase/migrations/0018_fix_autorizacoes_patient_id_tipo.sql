-- autorizacoes_transcricao.patient_local_id foi criada como integer, de
-- quando `patients` ainda era só SQLite local (era um id numérico de
-- referência, sem relação com o Supabase). Desde a migração completa pro
-- Supabase, patients.id é uuid — qualquer solicitação de autorização
-- (Edge Function solicitar-autorizacao) tentando gravar um uuid nessa
-- coluna integer falha com "invalid input syntax for type integer".
--
-- Linhas antigas (se houver) referenciam um id local que não existe mais
-- em lugar nenhum, então não há como preservá-las de forma útil — a
-- coluna é recriada do zero como uuid, com FK de verdade pra patients(id).
-- Pedidos de autorização são efêmeros (a psicanalista só precisa solicitar
-- de novo), então não há perda real aqui.
drop index if exists autorizacoes_patient_local_id_idx;
alter table public.autorizacoes_transcricao drop column if exists patient_local_id;
alter table public.autorizacoes_transcricao add column if not exists patient_local_id uuid references public.patients(id) on delete cascade;
delete from public.autorizacoes_transcricao where patient_local_id is null;
alter table public.autorizacoes_transcricao alter column patient_local_id set not null;
create index if not exists autorizacoes_patient_local_id_idx on public.autorizacoes_transcricao(patient_local_id);
