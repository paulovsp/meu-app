-- Sessão online pelo Zoom, mesmo desenho já validado com o Google Meet
-- (migrations 0055/0056): o app cria a reunião, o provedor transcreve, e o
-- texto chega sem gravar nada pelo aparelho — o que elimina a disputa de
-- microfone que produzia áudio mudo.
--
-- `integracoes_videochamada` já aceita provedor 'zoom' desde a 0055, então
-- a conexão da conta não precisa de tabela nova.
--
-- Diferença em relação ao Meet: o Zoom AVISA quando a gravação e a
-- transcrição ficam prontas (webhook recording.completed), então aqui não
-- existe cron de varredura — quem escreve o texto é `zoom-webhook`.
alter table public.sessions
  -- Reunião criada pelo app para esta sessão, e o link enviado ao
  -- analisante. O id vem como número na API do Zoom; guardado como texto
  -- para não depender de precisão de inteiro grande no cliente.
  add column if not exists zoom_meeting_id text,
  add column if not exists zoom_join_url text;

-- O webhook chega sabendo só o id da reunião — é por aqui que ele encontra
-- a sessão correspondente.
create index if not exists sessions_zoom_meeting_id_idx
  on public.sessions(zoom_meeting_id)
  where zoom_meeting_id is not null;
