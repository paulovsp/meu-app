-- Separada da 0107 porque a 0107 ja tinha sido aplicada quando esta
-- consulta foi escrita: migration aplicada nao se edita.
-- Contas por status de assinatura, para o Tesoureiro.
create or replace function public.op_status_assinaturas()
returns table (status text, contas bigint, valor_mensal_equivalente numeric)
language sql security definer set search_path = public
as $$
  select assinatura_status::text, count(*), coalesce(sum(assinatura_valor_mensal_equivalente), 0)
  from public.profiles
  where not conta_demonstracao
  group by assinatura_status
  order by 1;
$$;
revoke execute on function public.op_status_assinaturas() from public, anon, authenticated;
grant execute on function public.op_status_assinaturas() to service_role;

notify pgrst, 'reload schema';
