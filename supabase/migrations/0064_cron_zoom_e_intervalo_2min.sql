-- Busca periódica das transcrições do Zoom + intervalo dos dois crons pra 2min.
--
-- O Zoom TEM webhook, e ele continua no ar — mas em 06/09/2026 ele
-- simplesmente parou de entregar, sem erro em lugar nenhum: app instalado,
-- assinatura de eventos ativa com os dois eventos e a URL certa, endpoint
-- respondendo ao desafio de validação, reuniões criadas com 201 no log do
-- próprio Zoom, e ainda assim zero requisições chegando (a tabela de
-- diagnóstico da 0063 ficou vazia depois de quatro sessões de teste).
--
-- Buscar em vez de esperar tira essa dependência: passa a bastar que a API
-- responda, e essa está provada funcionando. Se o webhook voltar a entregar,
-- ele conclui primeiro e o cron encontra a sessão pronta e não faz nada.
--
-- Usa o MESMO `meet_cron_secret` do cron do Meet — mesmo banco, mesmo
-- pg_cron, mesmo nível de confiança. Nada novo pra criar no vault.
select cron.schedule(
  'zoom-buscar-transcricao',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://iahtyvqjgukdgrftpyxm.supabase.co/functions/v1/zoom-buscar-transcricao',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meet_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- De 5 para 2 minutos nos dois. Ciclo vazio é barato: a consulta usa o
-- índice parcial da 0055 e nem chega a chamar a API quando não há sessão
-- pendente. O que a mudança compra é a transcrição aparecer mais perto de
-- quando fica pronta.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'meet-buscar-transcricao'),
  schedule := '*/2 * * * *'
);
