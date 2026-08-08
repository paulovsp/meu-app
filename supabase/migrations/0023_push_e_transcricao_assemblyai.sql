-- Push notifications (Expo) e status assíncrono de transcrição (AssemblyAI).
-- profiles/sessions já são cobertas pelas policies de RLS existentes —
-- colunas novas herdam automaticamente, sem GRANT/policy adicional.

alter table public.profiles add column if not exists expo_push_token text;

alter table public.sessions add column if not exists transcricao_status text
  check (transcricao_status is null or transcricao_status in ('processando', 'concluida', 'erro'));
alter table public.sessions add column if not exists assemblyai_transcript_id text;
