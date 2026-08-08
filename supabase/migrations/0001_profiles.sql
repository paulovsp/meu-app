-- Fase 1 da migração pra Supabase: perfil da psicanalista (substitui a
-- tabela local `user` do SQLite). auth.users guarda e-mail/senha (gerenciado
-- pelo Supabase Auth); profiles guarda os dados adicionais que já existiam
-- na tabela `user` local, exceto `cidade` (legado, já sendo descontinuado
-- em favor de `endereco` no app).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  crp text,
  email text,
  especialidade text,
  cpf text,
  data_nascimento date,
  endereco text,
  telefone text,
  contador_nome text,
  contador_email text,
  contador_telefone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Sem policy de insert pra authenticated: a linha nasce só pelo trigger
-- abaixo, nunca por escrita direta do app. Sem policy de delete: exclusão
-- de perfil é decisão de produto fora de escopo desta fase.

-- Cria a linha de profiles automaticamente no signup, lendo nome/crp do
-- metadata passado em supabase.auth.signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, crp, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'crp',
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
