-- Remove a tabela de diagnóstico do webhook do Zoom (migration 0063).
--
-- Ela existiu para responder uma pergunta de 06/09/2026: o Zoom estava
-- mesmo entregando os eventos? A resposta veio — não estava, com tudo
-- verificado do nosso lado — e a transcrição foi movida para a busca ativa
-- (cron a cada 2 min + AssemblyAI), que não depende de o Zoom nos alcançar.
--
-- A pergunta está respondida e a arquitetura não usa mais o webhook para
-- nada. Manter a tabela significa gravar uma linha por evento, para sempre,
-- num lugar que ninguém consulta.
--
-- O endpoint do webhook continua no ar de propósito: o Zoom exige um
-- endereço que responda à validação, e um app do Marketplace com endpoint
-- quebrado é desativado por eles.
drop table if exists public.zoom_webhook_debug;

notify pgrst, 'reload schema';
