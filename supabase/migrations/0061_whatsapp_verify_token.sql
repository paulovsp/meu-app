-- Verify Token do webhook do WhatsApp, por profissional.
--
-- Antes era UM segredo só, igual pra todo mundo, guardado como variável de
-- ambiente — e a tela mandava "use o valor combinado com o suporte do
-- Dr.Sig". Duas coisas ruins nisso: ninguém consegue concluir a
-- configuração sozinha (a interface depende de alguém atender), e um
-- segredo compartilhado entre todas as contas não separa ninguém de
-- ninguém.
--
-- Agora o banco gera um token por profissional, a tela mostra pra copiar, e
-- o handshake da Meta identifica a conta por ele.
--
-- Ordem que isso resolve: a Meta chama o handshake ANTES de a pessoa ter as
-- credenciais em mãos (ela configura o webhook primeiro, e só depois copia
-- Phone Number ID e tokens). Por isso a linha nasce só com o verify_token e
-- as outras colunas passam a aceitar nulo até a conexão ser concluída.
alter table public.integracoes_whatsapp
  add column if not exists verify_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  alter column phone_number_id drop not null,
  alter column access_token drop not null;

create unique index if not exists integracoes_whatsapp_verify_token_idx
  on public.integracoes_whatsapp(verify_token);

-- O índice único de phone_number_id precisa tolerar nulo agora (linha
-- criada antes de a pessoa colar as credenciais).
drop index if exists integracoes_whatsapp_phone_idx;
create unique index if not exists integracoes_whatsapp_phone_idx
  on public.integracoes_whatsapp(phone_number_id) where phone_number_id is not null;

-- O verify_token É legível pelo app: a pessoa precisa copiá-lo pra colar no
-- painel da Meta. Diferente do access_token e do app_secret, que continuam
-- fora do grant de leitura.
grant select (verify_token) on public.integracoes_whatsapp to authenticated;
