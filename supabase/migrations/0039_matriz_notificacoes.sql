-- Completa a matriz tipo x canal de notificações (item D.10) que a
-- migration 0029 tinha deixado só com um canal por tipo (por falta da
-- infra do canal que faltava em cada um). Agora "Transcrição pronta" pode
-- ir também por e-mail, e "Recebimento em atraso" também por notificação
-- do app — cada uma independente da outra.
--
-- Canal novo de cada tipo nasce DESLIGADO por padrão (opt-in) — ninguém
-- passa a receber um e-mail/push a mais sem escolher; o canal que já
-- existia mantém o comportamento de hoje (default true, ver 0029).
alter table public.profiles add column if not exists notif_transcricao_email boolean not null default false;
alter table public.profiles add column if not exists notif_atraso_push boolean not null default false;
