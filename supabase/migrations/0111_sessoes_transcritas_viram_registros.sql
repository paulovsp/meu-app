-- Remodelagem Agenda/Arquivo (19/11/2026): o app deixou de gravar e
-- transcrever sessões. O código está guardado no ramo
-- `arquivo/gravacao-transcricao-2026-11-19`.
--
-- Ninguém perde o que já transcreveu: cada sessão com transcrição vira um
-- registro comum, na pasta Sessões do Arquivo, com o rótulo "Sessão
-- Transcrita" (`type = 'transcricao'`). A tabela `sessions` e os turnos
-- (`transcript_turns`) ficam intocados no banco, por segurança — só o app
-- deixa de lê-los (a exportação de dados ainda lê `sessions`).
--
-- O registro novo NÃO aponta para a sessão por `session_id`: essa chave é
-- `on delete cascade`, e apagar a sessão antiga (por uma versão antiga do
-- app ainda instalada) levaria o registro junto. O vínculo fica em
-- `sessao_origem_id`, sem chave estrangeira, e é ele que torna esta
-- migration reexecutável sem duplicar nada.
--
-- Também desliga os dois crons que buscavam transcrição no Google Meet e
-- no Zoom: a integração com os dois existia só para isso e saiu do app.

alter table public.records add column if not exists sessao_origem_id uuid;
create unique index if not exists records_sessao_origem_id_key
  on public.records (sessao_origem_id) where sessao_origem_id is not null;
comment on column public.records.sessao_origem_id is
  'Sessão transcrita (public.sessions.id) de onde este registro foi copiado na migration 0111. Sem FK de propósito.';

insert into public.records
  (patient_id, type, title, content, date, category, author, appointment_id, sessao_origem_id, created_at)
select
  s.patient_id,
  'transcricao',
  'Sessão transcrita em ' || to_char(coalesce(s.date, s.created_at) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
  -- O Arquivo mostra o conteúdo como HTML: escapa o texto e mantém as
  -- quebras de linha da transcrição.
  replace(
    replace(replace(replace(trim(s.transcript), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    E'\n', '<br>'
  ),
  coalesce(s.date, s.created_at),
  'sessao',
  'alternado',
  s.appointment_id,
  s.id,
  s.created_at
from public.sessions s
where nullif(trim(coalesce(s.transcript, '')), '') is not null
  and not exists (select 1 from public.records r where r.sessao_origem_id = s.id);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'meet-buscar-transcricao') then
    perform cron.unschedule('meet-buscar-transcricao');
  end if;
  if exists (select 1 from cron.job where jobname = 'zoom-buscar-transcricao') then
    perform cron.unschedule('zoom-buscar-transcricao');
  end if;
end $$;
