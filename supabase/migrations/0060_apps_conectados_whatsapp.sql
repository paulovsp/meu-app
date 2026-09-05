-- Apps conectados: WhatsApp sai de `profiles` para uma tabela própria, no
-- mesmo padrão de `integracoes_videochamada` (Meet/Zoom, migration 0055).
--
-- MOTIVO 1 — o token vazava pro aparelho. `profiles.whatsapp_access_token`
-- guardava um token PERMANENTE da Meta em texto puro, e `authenticated` tem
-- SELECT em todas as 48 colunas de `profiles`; como as telas carregam o
-- perfil com `select('*')`, esse token viajava até o celular a cada
-- abertura. Um token desses dá acesso de envio e leitura na conta comercial
-- inteira. Aqui ele fica numa coluna SEM grant de leitura: nem a sessão
-- legítima da dona consegue lê-lo — só a Edge Function, com service_role.
--
-- MOTIVO 2 — faltava de onde tirar o segredo para conferir a assinatura da
-- Meta (ver `whatsapp_app_secret` abaixo).
--
-- Ninguém tinha WhatsApp configurado ainda (conferido: 0 linhas), então não
-- há dado a migrar e as colunas antigas saem sem perda.
create table if not exists public.integracoes_whatsapp (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Identifica de quem é a mensagem que chega no webhook compartilhado.
  -- Não é segredo: aparece no payload de toda mensagem.
  phone_number_id text not null,
  -- Segredos. Sem grant de leitura pro app (ver grants abaixo).
  access_token text not null,
  -- App Secret do app da Meta, usado para conferir o X-Hub-Signature-256 de
  -- cada webhook. Cada profissional tem o SEU app na Meta, então o segredo
  -- é por profissional — não dá para ter um só compartilhado.
  app_secret text,
  conectado_em timestamptz not null default now(),
  invalidado_em timestamptz,
  invalidado_motivo text
);

-- O webhook chega sabendo só o phone_number_id.
create unique index if not exists integracoes_whatsapp_phone_idx
  on public.integracoes_whatsapp(phone_number_id);

alter table public.integracoes_whatsapp enable row level security;

drop policy if exists "integracoes_whatsapp_select_own" on public.integracoes_whatsapp;
create policy "integracoes_whatsapp_select_own" on public.integracoes_whatsapp
  for select to authenticated using (user_id = auth.uid());

-- Conectar e desconectar são da profissional; ela escreve o token (insert /
-- update), mas não consegue LER de volta — escrever um segredo e não poder
-- relê-lo é exatamente o comportamento desejado.
drop policy if exists "integracoes_whatsapp_insert_own" on public.integracoes_whatsapp;
create policy "integracoes_whatsapp_insert_own" on public.integracoes_whatsapp
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "integracoes_whatsapp_update_own" on public.integracoes_whatsapp;
create policy "integracoes_whatsapp_update_own" on public.integracoes_whatsapp
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "integracoes_whatsapp_delete_own" on public.integracoes_whatsapp;
create policy "integracoes_whatsapp_delete_own" on public.integracoes_whatsapp
  for delete to authenticated using (user_id = auth.uid());

-- GRANT por COLUNA na leitura: `access_token` e `app_secret` ficam de fora.
grant select (user_id, phone_number_id, conectado_em, invalidado_em, invalidado_motivo)
  on public.integracoes_whatsapp to authenticated;
grant insert (user_id, phone_number_id, access_token, app_secret)
  on public.integracoes_whatsapp to authenticated;
grant update (phone_number_id, access_token, app_secret)
  on public.integracoes_whatsapp to authenticated;
grant delete on public.integracoes_whatsapp to authenticated;

grant select, insert, update, delete on public.integracoes_whatsapp to service_role;

-- Colunas antigas saem: manter um token permanente em coluna legível pelo
-- app seria deixar o furo aberto ao lado da correção.
alter table public.profiles
  drop column if exists whatsapp_access_token,
  drop column if exists whatsapp_phone_number_id;
