-- Fase 1 — correção: RLS habilitada não é suficiente sozinha. O Postgres
-- exige GRANT explícito sobre a tabela para o role antes de a policy ter
-- qualquer efeito — sem isso, toda consulta dá "permission denied", mesmo
-- com a policy certa (foi exatamente o erro visto em produção: "permission
-- denied for table profiles"). Faltou esse passo nas migrations 0001-0005.

grant usage on schema public to authenticated;

-- profiles: só select/update pelo app (insert é só via trigger, delete é
-- decisão de produto fora de escopo).
grant select, update on public.profiles to authenticated;

-- patients e as 10 tabelas filhas: RLS já restringe tudo por dono, então
-- liberar select/insert/update/delete na base é seguro — RLS continua
-- sendo o filtro real de quais linhas aparecem/podem ser alteradas.
grant select, insert, update, delete on public.patients to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select, insert, update, delete on public.transcript_turns to authenticated;
grant select, insert, update, delete on public.availability_slots to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.pagamentos to authenticated;
grant select, insert, update, delete on public.nucleos_evidencias to authenticated;
grant select, insert, update, delete on public.nucleos_transicoes to authenticated;
grant select, insert, update, delete on public.nucleos_snapshots to authenticated;
grant select, insert, update, delete on public.nucleos_perguntas to authenticated;
grant select, insert, update, delete on public.objetivo_evidencias to authenticated;

-- cotacoes_cache: cache compartilhado de câmbio, legítimo o cliente gravar
-- (currency.js salva a cotação buscada de uma API externa) — diferente de
-- rubricas_config abaixo, que é config clínica administrada, não pelo app.
grant select, insert, update on public.cotacoes_cache to authenticated;

-- rubricas_config: só leitura pelo app (escrita é via migration ou Edge
-- Function com service_role, nunca client-side — ver 0005).
grant select on public.rubricas_config to authenticated;
