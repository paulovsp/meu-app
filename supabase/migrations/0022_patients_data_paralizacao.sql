-- Data de paralização do acompanhamento — análoga a data_inicio, mas pra
-- quando o processo está parado no momento (preenchida só nesses casos).
alter table public.patients add column if not exists data_paralizacao date;
