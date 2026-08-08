-- Sistema de créditos de IA: as 4 chamadas de IA paga (transcrição, OCR,
-- análise de núcleos/objetivo, busca) passam a rodar em Edge Functions, que
-- checam e deduzem este saldo antes/depois de chamar o provedor. Unidade:
-- dólar americano (US$) — mesma moeda dos preços dos provedores, sem
-- depender de cotação em tempo real dentro da Edge Function.
alter table public.profiles add column if not exists creditos_ia numeric not null default 0;

create table public.uso_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('transcricao', 'ocr', 'analise_texto', 'busca')),
  provedor text not null,
  modelo text not null,
  unidades numeric,
  custo_estimado numeric not null default 0,
  criado_em timestamptz not null default now()
);

create index uso_ia_user_id_idx on public.uso_ia(user_id);

alter table public.uso_ia enable row level security;

-- A psicanalista só lê o próprio histórico de uso — quem grava é sempre a
-- Edge Function (service_role), nunca o app diretamente.
create policy "uso_ia_select_own" on public.uso_ia
  for select to authenticated using (user_id = auth.uid());

grant select on public.uso_ia to authenticated;

-- Lição já registrada no projeto (ver migration 0011): RLS não basta, e
-- service_role também precisa de GRANT explícito pra tabelas novas.
grant select, insert on public.uso_ia to service_role;
grant select, update on public.profiles to service_role;
