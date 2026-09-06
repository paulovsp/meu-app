-- Conectar o WhatsApp falhava com "permission denied for table
-- integracoes_whatsapp".
--
-- A causa: os grants desta tabela são POR COLUNA, de propósito — é assim que
-- `access_token` e `app_secret` podem ser gravados pelo app e nunca lidos de
-- volta (ver 0060). Mas a lista de escrita cobria só user_id,
-- phone_number_id, access_token e app_secret, e a tela grava também
-- `invalidado_em` e `invalidado_motivo`, limpando-os ao reconectar. Escrever
-- fora da lista é negado pelo Postgres, e o erro sai como permissão negada na
-- tabela inteira — o que esconde qual coluna foi o problema.
--
-- Ampliar a escrita nessas duas não afeta a proteção que interessa: os
-- segredos seguem fora do grant de LEITURA. O pior que a usuária consegue
-- fazer aqui é marcar a própria integração como inválida.
grant insert (invalidado_em, invalidado_motivo)
  on public.integracoes_whatsapp to authenticated;
grant update (invalidado_em, invalidado_motivo)
  on public.integracoes_whatsapp to authenticated;
