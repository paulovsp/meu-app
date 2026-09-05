-- Nome da conta conectada no provedor de videochamada.
--
-- Não é enfeite: no Zoom, a transcrição vem como legenda com o NOME de quem
-- falou em cada fala ("Fulano: texto"). É comparando com o nome do
-- anfitrião que dá pra separar analista ("A:") de analisante ("P:") — sem
-- isso, toda fala viraria "P:" e a profissional teria que corrigir a sessão
-- inteira à mão.
alter table public.integracoes_videochamada
  add column if not exists conta_nome text;

-- Mesma regra de sempre: a coluna é legível pelo app (não é segredo), mas
-- o GRANT precisa ser explícito por coluna, porque `refresh_token` continua
-- de fora de propósito (ver migration 0055).
grant select (conta_nome) on public.integracoes_videochamada to authenticated;
