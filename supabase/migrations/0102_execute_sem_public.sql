-- A 0099 revogou o EXECUTE do anon — e não adiantou.
--
-- Conferido em produção logo depois: `has_function_privilege('anon',
-- 'assinatura_ativa(uuid)', 'execute')` continuava `true`. O motivo é o
-- padrão do Postgres: toda função nasce com EXECUTE concedido a PUBLIC, e
-- o anon herda de PUBLIC. Revogar do anon não tira o que ele recebe por
-- PUBLIC. O jeito certo é revogar de PUBLIC e conceder de volta só a quem
-- precisa — o mesmo que a 0100 já fez com `ajustar_credito_ia`.
--
-- `authenticated` continua podendo: as políticas de RLS chamam
-- `assinatura_ativa(auth.uid())` e `eh_conta_demonstracao()` como esse
-- papel. `service_role` é o servidor. O trigger de criação de conta chama
-- `gerar_codigo_indicacao()` como dono da função (postgres), que não
-- depende de grant.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.assinatura_ativa(uuid)',
    'public.indicados_ativos(uuid)',
    'public.desconto_por_indicacoes(uuid)',
    'public.eh_conta_demonstracao()',
    'public.gerar_codigo_indicacao()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

grant execute on function public.assinatura_ativa(uuid) to authenticated;
grant execute on function public.indicados_ativos(uuid) to authenticated;
grant execute on function public.desconto_por_indicacoes(uuid) to authenticated;
grant execute on function public.eh_conta_demonstracao() to authenticated;
revoke execute on function public.gerar_codigo_indicacao() from authenticated;

notify pgrst, 'reload schema';
