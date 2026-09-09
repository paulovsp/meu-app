-- Três canais de notificação em vez de dois embaralhados.
--
-- A matriz do Perfil tinha duas colunas, "App" e "E-mail", e a primeira
-- fazia coisa diferente em cada linha: push de verdade na transcrição,
-- push E aviso dentro do app no atraso (um interruptor só pros dois), e
-- em "Incluir registro" nada de push — só o popup interno. O rótulo
-- mentia em metade das linhas, e não havia como querer o aviso do celular
-- sem o de dentro do app, ou o contrário.
--
-- Agora cada canal tem a sua coluna:
--   notif_<tipo>_app    -- aviso ao abrir o aplicativo
--   notif_<tipo>_push   -- notificação do Android (depende da permissão)
--   notif_<tipo>_email  -- e-mail

alter table public.profiles
  add column if not exists notif_transcricao_app boolean not null default true,
  add column if not exists notif_atraso_app      boolean not null default true,
  add column if not exists notif_registro_app    boolean not null default true,
  -- Faltava no banco: a linha "Sessão feita / paga" nunca teve push.
  -- Entra desligada — ninguém pediu por ela, e notificação nova que chega
  -- sozinha é a que faz a pessoa desligar todas.
  add column if not exists notif_sessao_push     boolean not null default false;

-- `notif_registro_push` nunca foi push: desde sempre controlou o popup
-- "Adicionar relato?" dentro do app. Levar o valor pra coluna certa é o
-- que evita a pessoa perder a preferência que já tinha escolhido.
update public.profiles
   set notif_registro_app = notif_registro_push
 where notif_registro_push is distinct from null;

-- A coluna antiga fica: as versões 21 e 22 ainda em campo leem ela, e
-- derrubar agora quebraria o app de quem ainda não recebeu a atualização.
-- Removível quando essas versões saírem de circulação.
comment on column public.profiles.notif_registro_push is
  'OBSOLETA — substituída por notif_registro_app (migration 0083). Mantida só para as versões 21/22 em campo.';

comment on column public.profiles.notif_atraso_app is
  'Aviso dentro do app. Antes o popup de atraso aparecia sempre, sem consultar preferência nenhuma.';
