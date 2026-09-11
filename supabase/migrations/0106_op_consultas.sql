-- Duas consultas prontas para o op-agente (0105), que precisam de SQL:
-- a leitura do pg_cron (schema `cron`, que a API não expõe) e o funil do
-- dia por origem.

-- Rodadas de cron com falha desde uma data. `cron.job_run_details` guarda
-- o status de cada execução; "succeeded" com resposta HTTP ≠ 200 do
-- net.http_post não é falha do cron, mas a função chamada respondeu — por
-- isso o Vigia cruza com op_eventos.
create or replace function public.op_cron_falhas(desde timestamptz)
returns table (jobname text, status text, return_message text, start_time timestamptz)
language sql security definer set search_path = public
as $$
  select j.jobname, d.status, left(d.return_message, 300), d.start_time
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where d.start_time >= desde
    and d.status <> 'succeeded'
  order by d.start_time desc
  limit 100;
$$;

-- Cadastros, assinaturas iniciadas e cancelamentos do dia, por origem.
create or replace function public.op_funil_do_dia(dia date)
returns table (origem text, cadastros integer, assinaturas integer, cancelamentos integer)
language sql security definer set search_path = public
as $$
  with base as (
    select coalesce(origem_cadastro, 'desconhecida') as origem,
           (created_at::date = dia)::int as cadastro,
           (assinatura_status = 'ativa' and assinatura_ciclo_inicio::date = dia)::int as assinatura,
           (assinatura_status = 'cancelada' and assinatura_renovacao_notificada_em::date = dia)::int as cancelamento
    from public.profiles
    where conta_demonstracao = false
  )
  select origem, sum(cadastro)::int, sum(assinatura)::int, sum(cancelamento)::int
  from base
  group by origem
  having sum(cadastro) + sum(assinatura) + sum(cancelamento) > 0;
$$;

revoke execute on function public.op_cron_falhas(timestamptz) from public, anon, authenticated;
revoke execute on function public.op_funil_do_dia(date) from public, anon, authenticated;
grant execute on function public.op_cron_falhas(timestamptz) to service_role;
grant execute on function public.op_funil_do_dia(date) to service_role;

notify pgrst, 'reload schema';
