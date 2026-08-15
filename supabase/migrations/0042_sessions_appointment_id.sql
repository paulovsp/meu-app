-- Item 1 da leva de correções pós-teste (15/08/2026): tela "Sessões sem
-- relato" precisa cruzar `appointments` (status do compromisso) com
-- `sessions` (se já tem relato/transcrição) — hoje não existe vínculo entre
-- as duas tabelas. Nullable e `on delete set null`: sessões avulsas (sem
-- compromisso) e sessões antigas continuam funcionando sem esse campo.
alter table public.sessions add column if not exists appointment_id uuid references public.appointments(id) on delete set null;
