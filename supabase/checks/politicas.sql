-- O que o banco de produção realmente aplica: políticas de RLS e quem
-- pode executar cada função pública.
--
-- Existe porque uma política criada à mão no painel (availability_slots_all,
-- removida na 0098) ficou meses em produção sem constar em migration
-- nenhuma — e abria a agenda de todo mundo. `supabase db diff` pegaria,
-- mas exige Docker; isto aqui roda com o CLI que já está linkado:
--
--     npx supabase db query --linked -f supabase/checks/politicas.sql > /tmp/politicas.json
--
-- e o resultado se compara com o último snapshot conferido,
-- supabase/checks/politicas-esperadas.json (ver DEPLOY.md). Linha a mais
-- ou a menos é uma mudança que alguém precisa explicar.
select 'policy' as tipo,
       schemaname || '.' || tablename as objeto,
       policyname as nome,
       cmd || ' ' || permissive || ' ' || roles::text as detalhe,
       coalesce(qual, '') || ' | ' || coalesce(with_check, '') as regra
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
