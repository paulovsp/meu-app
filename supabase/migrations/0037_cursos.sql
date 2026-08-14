-- Currículo de cursos da profissional (Perfil → Cursos) — histórico de
-- formação continuada, com gravação/transcrição opcional da aula via
-- AssemblyAI (mesma tecnologia de ia-transcrever, mas pipeline PRÓPRIO —
-- ver curso-transcrever/curso-transcrever-webhook — porque aqui não há
-- diarização A:/P: nem verificação de identidade de analisante, é uma aula
-- com 1+ locutores desconhecidos, só precisa do consentimento do professor
-- registrado antes de gravar).
create table if not exists public.cursos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null,
  professor text,
  instituicao text,
  carga_horaria numeric,
  custo numeric,
  formato text,
  local text,
  data date,
  anotacoes text,
  consentimento_professor boolean not null default false,
  consentimento_em timestamptz,
  transcript text,
  transcricao_status text check (transcricao_status is null or transcricao_status in ('processando', 'concluida', 'erro')),
  assemblyai_transcript_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists cursos_user_id_idx on public.cursos(user_id);

alter table public.cursos enable row level security;

drop policy if exists "cursos_all_own" on public.cursos;
create policy "cursos_all_own" on public.cursos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.cursos to authenticated;

-- curso-transcrever-webhook é chamado pela AssemblyAI, sem JWT de usuário
-- (só o segredo do webhook) — precisa achar e atualizar a linha por
-- service_role direto, sem RLS de usuário no meio. Lição já registrada no
-- projeto (ver migration 0011/0013): RLS habilitada não basta, service_role
-- também precisa de GRANT explícito em tabela nova.
grant select, update on public.cursos to service_role;

-- FK adiada pra depois de `cursos` existir (a coluna já foi criada em
-- 0036, antes de a tabela cursos existir).
alter table public.despesas_consultorio
  add constraint despesas_consultorio_curso_id_fkey
  foreign key (curso_id) references public.cursos(id) on delete set null;
