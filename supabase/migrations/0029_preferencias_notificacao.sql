-- Preferências de notificação (item D.10). Escopo: só os tipos que hoje
-- são disparados automaticamente pelo sistema (não os botões manuais de
-- WhatsApp/e-mail em Recebíveis, que são uma ação da profissional, não uma
-- notificação) e que já têm exatamente um canal implementado — por isso
-- cada preferência aqui é liga/desliga de UM canal, não uma matriz tipo x
-- canal completa (WhatsApp automático não existe pra nenhum desses tipos
-- hoje; a emissão fiscal automática já tem config própria em
-- ConfiguracaoFiscalAutomaticaScreen.js/0017_fiscal_e_cobranca_sessao.sql).
alter table public.profiles add column if not exists notif_transcricao_push boolean not null default true;
alter table public.profiles add column if not exists notif_atraso_email boolean not null default true;
