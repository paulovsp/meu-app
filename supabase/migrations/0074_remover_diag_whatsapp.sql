-- Remove o diagnóstico temporário de privilégios da 0071/0072.
--
-- Ele cumpriu o papel: provou que `authenticated` já tinha INSERT e UPDATE
-- em todas as colunas de `integracoes_whatsapp`, e que a causa do
-- "permission denied" não era grant nenhum — era o upsert do PostgREST.
-- A conexão passou a acontecer pela RPC `salvar_integracao_whatsapp`
-- (0073), então estas duas funções não têm mais nada a fazer no ar.
--
-- Eram `security definer` com execute liberado pra `anon`: deixá-las
-- publicadas depois do diagnóstico é superfície exposta à toa.
drop function if exists public.diag_upsert_whatsapp();
drop function if exists public.diag_grants_whatsapp();

notify pgrst, 'reload schema';
