-- Fecha de verdade a escrita no cache de cotação.
--
-- A 0095 removeu as políticas de RLS, e isso já bloqueou o usuário (sem
-- política, a RLS nega). Mas duas coisas ficaram tortas:
--
--   • `authenticated` continuava com INSERT e UPDATE no nível da TABELA.
--     Hoje a RLS segura, e é só o que segura: bastaria alguém criar uma
--     política permissiva no futuro, por qualquer motivo, pra porta abrir
--     de novo sem ninguém notar. Tirar o privilégio faz a proteção não
--     depender de uma única linha continuar ausente;
--
--   • `service_role` nunca teve privilégio nenhum ali — quem escrevia era
--     exclusivamente o app. Por isso a Edge Function `cotacao-atualizar`
--     respondeu "permission denied for table cotacoes_cache" no primeiro
--     teste: eu tinha mudado quem escreve sem dar a chave a quem passou a
--     escrever.

revoke insert, update, delete on public.cotacoes_cache from authenticated;
revoke insert, update, delete on public.cotacoes_cache from anon;

-- Leitura continua livre pra quem está logado: a cotação é a mesma pra
-- todo mundo e não revela nada de ninguém.
grant select on public.cotacoes_cache to authenticated;

-- Quem passa a escrever, e o único.
grant select, insert, update on public.cotacoes_cache to service_role;
