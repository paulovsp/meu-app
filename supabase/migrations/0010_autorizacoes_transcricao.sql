-- Autorização de gravação/transcrição pelo próprio analisante. Tabela nova
-- e independente — `patients` ainda só existe no SQLite local do app (a
-- migração completa dela é uma fase futura, ainda não decidida), então
-- guardamos aqui uma cópia dos dados de identidade no momento do pedido
-- (nome/cpf/nascimento/e-mail), sem depender de `patients` estar no Supabase.
-- `patient_local_id` é só o id local (SQLite) do paciente no app, pra a
-- tela saber a qual analisante local essa solicitação corresponde.
create table public.autorizacoes_transcricao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_local_id integer not null,
  patient_nome text not null,
  patient_cpf text not null,
  patient_nascimento date not null,
  patient_email text not null,
  status text not null default 'pendente' check (status in ('pendente', 'autorizada', 'negada')),
  token text not null unique,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  respondido_em timestamptz
);

create index autorizacoes_user_id_idx on public.autorizacoes_transcricao(user_id);
create index autorizacoes_patient_local_id_idx on public.autorizacoes_transcricao(patient_local_id);
create index autorizacoes_token_idx on public.autorizacoes_transcricao(token);

alter table public.autorizacoes_transcricao enable row level security;

-- A psicanalista só lê/cria suas próprias solicitações pelo app (com a
-- sessão normal, chave anon). Ela NUNCA atualiza o status diretamente —
-- só as Edge Functions (com service_role, que ignora RLS) fazem isso,
-- depois de validar a resposta do analisante.
create policy "autorizacoes_select_own" on public.autorizacoes_transcricao
  for select to authenticated using (user_id = auth.uid());

create policy "autorizacoes_insert_own" on public.autorizacoes_transcricao
  for insert to authenticated with check (user_id = auth.uid());

-- Lição da Fase 1: RLS sozinha não basta, precisa do GRANT explícito.
grant select, insert on public.autorizacoes_transcricao to authenticated;
