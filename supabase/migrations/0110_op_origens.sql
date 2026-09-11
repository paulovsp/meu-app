-- Para o Analista de funil: de onde vieram as contas, acumulado, com quantas
-- viraram assinatura. É a única leitura que cruza origem com conversão.
create or replace function public.op_origens_de_cadastro()
returns table (origem text, contas bigint, assinantes bigint, cortesias bigint)
language sql security definer set search_path = public
as $$
  select coalesce(origem_cadastro, 'desconhecida')::text,
         count(*),
         count(*) filter (where assinatura_status = 'ativa'),
         count(*) filter (where assinatura_status = 'cortesia')
  from public.profiles
  where not conta_demonstracao
  group by 1
  order by 2 desc;
$$;
revoke execute on function public.op_origens_de_cadastro() from public, anon, authenticated;
grant execute on function public.op_origens_de_cadastro() to service_role;

notify pgrst, 'reload schema';
