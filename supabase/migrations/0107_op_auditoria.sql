-- O que o Auditor lê: as políticas e grants como estão (o mesmo que
-- supabase/checks/politicas.sql, agora chamável pelo servidor) e uma lista
-- de anomalias que não deveriam existir. Os agentes rodam fora daqui, sem
-- o CLI linkado — a única porta deles é o op-agente, e o op-agente só
-- fala com o banco por funções como estas.

create or replace function public.op_politicas()
returns table (tipo text, objeto text, nome text, detalhe text, regra text)
language sql security definer set search_path = public
as $$
  select 'policy'::text,
         (schemaname || '.' || tablename)::text,
         policyname::text,
         (cmd || ' ' || permissive || ' ' || roles::text)::text,
         (coalesce(qual, '') || ' | ' || coalesce(with_check, ''))::text
  from pg_policies
  where schemaname in ('public', 'storage')
  union all
  select 'execute',
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         r.rolname,
         case when p.prosecdef then 'security definer' else 'invoker' end,
         ''
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  where n.nspname = 'public'
    and has_function_privilege(r.rolname, p.oid, 'execute')
  order by 1, 2, 3;
$$;

-- Cada item é algo que, se existir, alguém precisa explicar.
create or replace function public.op_auditoria()
returns jsonb
language sql security definer set search_path = public
as $$
  select jsonb_build_object(
    'tabelas_sem_rls', (
      select coalesce(jsonb_agg(c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ),
    'funcoes_definer_para_anon', (
      select coalesce(jsonb_agg(p.proname), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'execute')
    ),
    'contas_cortesia_longa', (
      select count(*) from public.profiles
      where assinatura_status = 'cortesia' and assinatura_expira_em > now() + interval '400 days'
        and not conta_demonstracao
    ),
    'contas_gratuita_indicacao', (
      select count(*) from public.profiles where assinatura_status = 'gratuita_indicacao'
    ),
    'contas_credito_muito_negativo', (
      select count(*) from public.profiles where creditos_ia < -2
    ),
    'contas_ativas_sem_preapproval', (
      select count(*) from public.profiles
      where assinatura_status = 'ativa' and mp_preapproval_id is null and not conta_demonstracao
    ),
    'contas_demonstracao', (
      select count(*) from public.profiles where conta_demonstracao
    ),
    'convites_pendentes', (
      select count(*) from public.convites_cortesia where usado_em is null
    ),
    'eventos_nao_tratados_7d', (
      select count(*) from public.op_eventos where tratado_em is null and criado_em < now() - interval '7 days'
    ),
    'incidentes_abertos_mais_de_7d', (
      select count(*) from public.op_incidentes where status <> 'fechado' and criado_em < now() - interval '7 days'
    )
  );
$$;

revoke execute on function public.op_politicas() from public, anon, authenticated;
revoke execute on function public.op_auditoria() from public, anon, authenticated;
grant execute on function public.op_politicas() to service_role;
grant execute on function public.op_auditoria() to service_role;

notify pgrst, 'reload schema';

