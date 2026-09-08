-- Onde os erros do app vão parar.
--
-- Até aqui: em lugar nenhum. Um erro de render derruba a árvore inteira do
-- React e o app fica numa tela branca — sem mensagem pra quem está usando e
-- sem rastro pra quem mantém. Num app clínico, isso pode acontecer no meio
-- de uma sessão e ninguém nunca saber por quê.
--
-- Só o suficiente pra reconstituir o que houve, e nada além disso: mensagem,
-- pilha, em que tela, qual versão. NENHUM dado clínico entra aqui — a pilha
-- de JavaScript carrega nomes de função e arquivo, não conteúdo de sessão.
create table if not exists public.erros_app (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  mensagem text not null,
  pilha text,
  tela text,
  versao text,
  plataforma text,
  criado_em timestamptz not null default now()
);

create index if not exists erros_app_criado_em_idx on public.erros_app(criado_em desc);

alter table public.erros_app enable row level security;

-- Só INSERT, e só do próprio usuário. Ninguém lê pelo app: quem consulta é
-- quem mantém, pelo painel. Sem SELECT, um erro registrado não vira mais um
-- lugar por onde dado vaza.
drop policy if exists "erros_app_insert_own" on public.erros_app;
create policy "erros_app_insert_own" on public.erros_app
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

grant insert on public.erros_app to authenticated;

notify pgrst, 'reload schema';
