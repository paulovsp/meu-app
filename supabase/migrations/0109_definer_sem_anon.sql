-- A primeira auditoria automática (op_auditoria) listou seis funções
-- SECURITY DEFINER executáveis pela chave anônima. Nenhuma expõe dado por
-- si (owns_* só respondem sobre linhas que o chamador já enxerga; as três
-- de trigger rodam como dono da função, disparadas pelo próprio banco),
-- mas "executável por quem não está logado" não é um estado que uma
-- função com privilégio total deva ter. Fecha, e a auditoria passa a
-- acusar qualquer volta disso.
do $$
declare f text;
begin
  foreach f in array array[
    'public.owns_patient(uuid)',
    'public.owns_session(uuid)',
    'public.gravacao_autorizada(uuid)',
    'public.forcar_email_perfil_do_login()',
    'public.impedir_autocadastro_analisante()',
    'public.handle_new_user()'
  ] loop
    begin
      execute format('revoke execute on function %s from public, anon', f);
    exception when undefined_function then
      -- assinatura diferente da suposta: o auditor vai apontar, e a
      -- migration não pode falhar por causa disso
      raise notice 'não encontrei %', f;
    end;
  end loop;
end $$;

-- As de trigger não precisam nem de `authenticated`: quem as executa é o
-- banco, como dono da função.
revoke execute on function public.forcar_email_perfil_do_login() from authenticated;
revoke execute on function public.impedir_autocadastro_analisante() from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

notify pgrst, 'reload schema';
