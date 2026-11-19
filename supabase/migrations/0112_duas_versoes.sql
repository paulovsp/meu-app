-- Duas versões do Dr.Sig (remodelagem de 19/11/2026):
--
--   'agenda'   → Agenda inteligente: agenda, ficha administrativa,
--                financeiro, relatórios de frequência e pagamento.
--   'completa' → Agenda + Arquivo inteligente: tudo isso mais os registros
--                clínicos, a Busca Dr.Sig e os relatórios com IA.
--
-- Quem já assina fica na completa, pelo mesmo preço — por isso o default.
-- A conta de demonstração também mostra a completa.
--
-- A coluna é fechada para o app: o 0094 só concede UPDATE em colunas
-- listadas, e esta não entra na lista. Quem escreve é o webhook do Mercado
-- Pago (service role), a partir do external_reference da assinatura.

alter table public.profiles
  add column if not exists assinatura_versao text not null default 'completa';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_assinatura_versao_check'
  ) then
    alter table public.profiles
      add constraint profiles_assinatura_versao_check
      check (assinatura_versao in ('agenda', 'completa'));
  end if;
end $$;

comment on column public.profiles.assinatura_versao is
  'Versão contratada: agenda (sem registros clínicos) ou completa. Ver migration 0112.';


-- `stable`: avaliada uma vez por consulta, não por linha.
create or replace function public.arquivo_liberado(uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select assinatura_versao = 'completa' from public.profiles where id = uid),
    true
  );
$$;

revoke execute on function public.arquivo_liberado(uuid) from public, anon;
grant execute on function public.arquivo_liberado(uuid) to authenticated;

-- Na versão Agenda não se escreve registro clínico. Esconder o botão no
-- app não basta (a chave publishable está dentro do app), então a trava
-- fica no banco, no mesmo padrão do 0097: restritiva, só INSERT e UPDATE.
-- A leitura continua livre — quem passou da completa para a agenda não
-- perde o acesso ao que já escreveu, e o DELETE também fica livre, para a
-- pessoa poder apagar o que é dela.
drop policy if exists versao_agenda_sem_insert_records on public.records;
drop policy if exists versao_agenda_sem_update_records on public.records;

create policy versao_agenda_sem_insert_records on public.records
  as restrictive for insert to authenticated
  with check (public.arquivo_liberado(auth.uid()));

create policy versao_agenda_sem_update_records on public.records
  as restrictive for update to authenticated
  using (public.arquivo_liberado(auth.uid()))
  with check (public.arquivo_liberado(auth.uid()));

notify pgrst, 'reload schema';
