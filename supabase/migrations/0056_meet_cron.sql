-- Busca periódica das transcrições do Google Meet.
--
-- Diferente da AssemblyAI, o Google Meet não chama webhook nenhum quando a
-- transcrição fica pronta: ela aparece alguns minutos depois de a chamada
-- terminar, quando o app pode estar fechado. Então quem vai buscar somos
-- nós, de tempos em tempos. Mesmo padrão do enviar-digest-diario (0044).
--
-- IMPORTANTE — passo manual único, fora desta migration:
--   select vault.create_secret('<um-valor-aleatorio-qualquer>', 'meet_cron_secret');
-- E o MESMO valor como secret da Edge Function:
--   npx supabase secrets set MEET_CRON_SECRET=<o-mesmo-valor-aleatorio>
--
-- A cada 5 minutos: a transcrição costuma ficar pronta poucos minutos depois
-- da chamada, e a função só faz trabalho quando existe sessão pendente (a
-- consulta usa o índice parcial criado na 0055, então ciclo vazio é barato).
select cron.schedule(
  'meet-buscar-transcricao',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://iahtyvqjgukdgrftpyxm.supabase.co/functions/v1/meet-buscar-transcricao',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meet_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
