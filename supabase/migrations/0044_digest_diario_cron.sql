-- Digest diário por e-mail (item 1, leva pós-v13) — substitui o e-mail de
-- atraso que disparava toda vez que a Início ganhava foco no app (horário
-- imprevisível) por UM e-mail agregado, sempre no mesmo horário, juntando
-- pagamentos em atraso + sessões sem relato.
--
-- IMPORTANTE — passo manual único, fora desta migration, igual ao cron de
-- assinatura-processar-ciclo (migration 0035):
--   select vault.create_secret('<um-valor-aleatorio-qualquer>', 'digest_cron_secret');
-- E configurar o MESMO valor como secret da Edge Function:
--   npx supabase secrets set DIGEST_CRON_SECRET=<o-mesmo-valor-aleatorio>
select cron.schedule(
  'enviar-digest-diario',
  '0 11 * * *', -- todo dia às 11h UTC (8h em Brasília)
  $$
  select net.http_post(
    url := 'https://iahtyvqjgukdgrftpyxm.supabase.co/functions/v1/enviar-digest-diario',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
