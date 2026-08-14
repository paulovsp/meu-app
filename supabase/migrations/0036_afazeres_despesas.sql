-- Duas tabelas novas e independentes, ambas simples CRUD do próprio usuário
-- (sem tabela pai, diferente de patients/sessions/etc — não são dados
-- clínicos de analisante, são organização pessoal da profissional):
--
-- `afazeres`: lista de tarefas da nova tela Início (widget + tela cheia).
-- `despesas_consultorio`: gasto do consultório (aluguel, assinaturas,
-- cursos etc) que alimenta a nova tela Pagamentos (Administrativo). Nome
-- da tabela evita colidir com a `pagamentos` já existente (essa é
-- recebimento de analisante, a base do Recebíveis — conceito diferente).

create table if not exists public.afazeres (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  texto text not null,
  concluido boolean not null default false,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create index if not exists afazeres_user_id_idx on public.afazeres(user_id);

alter table public.afazeres enable row level security;

drop policy if exists "afazeres_all_own" on public.afazeres;
create policy "afazeres_all_own" on public.afazeres
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.afazeres to authenticated;

create table if not exists public.despesas_consultorio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  categoria text not null check (categoria in (
    'aluguel', 'contas', 'assinaturas', 'analise_pessoal', 'supervisao', 'cursos', 'outros'
  )),
  descricao text not null,
  valor numeric not null,
  data date not null,
  recorrente boolean not null default false,
  curso_id uuid,
  criado_em timestamptz not null default now()
);

create index if not exists despesas_consultorio_user_id_idx on public.despesas_consultorio(user_id);
create index if not exists despesas_consultorio_data_idx on public.despesas_consultorio(data);

alter table public.despesas_consultorio enable row level security;

drop policy if exists "despesas_consultorio_all_own" on public.despesas_consultorio;
create policy "despesas_consultorio_all_own" on public.despesas_consultorio
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.despesas_consultorio to authenticated;
