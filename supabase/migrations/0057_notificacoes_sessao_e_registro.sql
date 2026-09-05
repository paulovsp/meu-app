-- Mais dois tipos de notificação na matriz do Perfil (App x E-mail), além
-- de "Transcrição pronta" e "Recebimento em atraso" que já existiam.
--
-- 1) SESSÃO FEITA/PAGA — o popup de check-in da tela Início
--    (perguntarCheckin: "A sessão aconteceu?" e, para cobrança por sessão,
--    "já foi paga?"). NÃO existe `notif_sessao_push` de propósito: esse
--    popup é o ÚNICO ponto do app onde um compromisso passado deixa de ser
--    'agendado'. Desligá-lo pararia de alimentar status dos compromissos,
--    cobrança por sessão, financeiro, fiscal e a contagem de sessões sem
--    relato — não é preferência, é o motor do controle. Por e-mail, sim,
--    pode ser opcional.
--
-- 2) INCLUIR REGISTRO — o segundo popup, que aparece depois de confirmar
--    que a sessão aconteceu ("Quer adicionar o relato agora?"), e a seção
--    de sessões sem relato no resumo diário. Este pode ser desligado nos
--    dois canais sem prejuízo: o app continua contando as sessões sem
--    relato no card da Início, só para de perguntar.
alter table public.profiles
  -- Resumo diário passa a poder listar sessões passadas ainda não
  -- confirmadas. É um e-mail NOVO, que hoje ninguém recebe: entra como
  -- opt-in (false) para não começar a escrever para todo mundo sem pedir.
  add column if not exists notif_sessao_email boolean not null default false,
  -- Os dois abaixo entram ligados porque preservam o comportamento atual:
  -- o popup do relato já aparece hoje, e a seção "sessões sem relato" já
  -- vai no resumo diário (até agora presa ao interruptor de atraso, o que
  -- era errado — são avisos diferentes).
  add column if not exists notif_registro_push boolean not null default true,
  add column if not exists notif_registro_email boolean not null default true;
