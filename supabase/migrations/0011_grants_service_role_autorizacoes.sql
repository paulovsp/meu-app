-- As Edge Functions `solicitar-autorizacao` e `confirmar-autorizacao` usam
-- o service_role pra inserir/atualizar `autorizacoes_transcricao` (a
-- psicanalista nunca escreve status diretamente — só o servidor, depois de
-- validar). A 0010 só concedeu GRANT pra `authenticated` (leitura/criação
-- pelo app); faltou o GRANT pro `service_role`, e sem ele o Postgres nega o
-- acesso mesmo o service_role ignorando RLS (GRANT e RLS são checagens
-- independentes).
grant select, insert, update on public.autorizacoes_transcricao to service_role;
