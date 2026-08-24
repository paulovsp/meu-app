-- Cursos: horário da aula + carga horária derivada de aulas × duração.
--
-- `carga_horaria` continua existindo e continua sendo o total em HORAS (é o
-- que o currículo/certificado usa), mas deixa de ser digitada à mão: agora
-- sai de `quantidade_aulas * duracao_aula_min / 60`, calculado no app ao
-- salvar. Cursos já cadastrados mantêm a carga horária que têm, só ficam
-- sem o detalhamento (as duas colunas novas ficam nulas).
alter table public.cursos add column if not exists horario_inicio text;
alter table public.cursos add column if not exists horario_fim text;
alter table public.cursos add column if not exists quantidade_aulas integer;
alter table public.cursos add column if not exists duracao_aula_min integer;

-- Vínculo curso -> compromisso da Agenda. Mesmo padrão de
-- `despesas_consultorio.curso_id` (migration 0036/0037): a linha da Agenda
-- é derivada do curso, então é achada/atualizada/removida por este id em vez
-- de duplicar a cada edição. `on delete cascade` porque um compromisso de
-- curso não tem sentido sozinho — se o curso sai do currículo, o horário
-- dele sai da agenda junto.
alter table public.appointments add column if not exists curso_id uuid references public.cursos(id) on delete cascade;
create index if not exists appointments_curso_id_idx on public.appointments(curso_id);
