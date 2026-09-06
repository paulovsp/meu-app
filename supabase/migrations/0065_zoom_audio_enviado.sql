-- Marca de que o áudio da gravação do Zoom já foi mandado pra transcrição.
--
-- A transcrição do próprio Zoom não serve pra sessão em português: ele decide
-- o idioma por reunião, sai em inglês, e não há API nem configuração de conta
-- que mude isso (testado em 06/09/2026 — o "idioma de fala" vale só pra
-- legenda ao vivo). Então o Zoom passa a ser só a CAPTAÇÃO: o app baixa o
-- áudio da gravação em nuvem e transcreve pela AssemblyAI, que já roda em
-- português e separa falantes.
--
-- Sem esta marca o cron reenviaria o mesmo áudio a cada 2 minutos enquanto a
-- AssemblyAI processa — cobrando crédito repetido pela mesma sessão. A
-- conclusão continua vindo pelo webhook `ia-transcrever-webhook`, igual ao
-- caminho da gravação pelo celular.
alter table public.sessions
  add column if not exists zoom_audio_enviado_em timestamptz;

comment on column public.sessions.zoom_audio_enviado_em is
  'Quando o áudio da gravação do Zoom foi enviado à AssemblyAI. Impede reenvio pelo cron.';
