-- O servidor não conseguia escrever nas tabelas novas.
--
-- `convites_cortesia` (0103) nasceu sem grant nenhum para `service_role`:
-- o primeiro convite falhou com "permission denied for table". A tabela
-- de recargas (0100) tem a mesma origem e o mesmo risco — o crédito de
-- uma recarga ainda não passou por ela em produção.
--
-- Grant explícito, em vez de confiar em privilégio padrão que pode ou não
-- existir conforme quem criou a tabela.
grant all on table public.convites_cortesia to service_role;
grant all on table public.recargas_creditos to service_role;
grant all on table public.pagamentos_nao_identificados to service_role;
grant all on table public.mercadopago_eventos_processados to service_role;

notify pgrst, 'reload schema';
