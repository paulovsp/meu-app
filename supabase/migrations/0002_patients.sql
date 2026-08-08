-- Fase 1: tabela `patients` (analisantes), raiz de todo o dado clínico.
-- Chave primária UUID gerada no cliente (não autoincrement do Postgres) —
-- a Fase 5 (fila de escrita offline) precisa criar registros no celular
-- sem internet, e um ID gerado no app nasce igual local e remoto, sem
-- precisar mapear "ID local -> ID do servidor" depois de sincronizar.
--
-- `user_id` é o único ponto de "dono da conta" — as tabelas filhas (Fase 2+)
-- nunca duplicam essa coluna, elas verificam posse via join com esta tabela
-- (ver 0003_ownership_helpers.sql). Um único lugar de verdade sobre quem é
-- dono de um paciente evita a tabela filha e esta discordarem entre si.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  nascimento date,
  data_inicio date,
  telefone text,
  email text,
  horario text,
  preco_sessao numeric,
  preco_moeda text not null default 'BRL',
  modalidade text,
  endereco text,
  contato_emergencia text,
  como_chegou text,
  info_relevantes text,
  dia_pagamento integer,
  consentimento_perfil boolean not null default false,
  consentimento_perfil_em timestamptz,
  cpf text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patients_user_id_idx on public.patients(user_id);

alter table public.patients enable row level security;

drop policy if exists "patients_all_own" on public.patients;
create policy "patients_all_own" on public.patients
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
