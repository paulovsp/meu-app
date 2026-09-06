-- Terceira tentativa de destravar "permission denied for table
-- integracoes_whatsapp" — e desta vez atacando a causa, não o sintoma.
--
-- As 0067 e 0068 foram adivinhando qual coluna faltava, uma de cada vez. O
-- método estava errado: o Postgres não diz QUAL coluna negou, e o `upsert` do
-- PostgREST monta a lista de colunas por baixo, então o código do app não
-- mostra o conjunto real. Cada palpite custava um ciclo de teste do usuário.
--
-- A restrição por coluna nesta tabela existe por UM motivo: `access_token` e
-- `app_secret` não podem ser LIDOS de volta, nem pela própria sessão que os
-- gravou. Essa proteção mora inteira no grant de SELECT, que continua
-- intacto e é o que a 0060 foi escrita pra garantir.
--
-- Restringir também a ESCRITA por coluna não acrescentava segurança: quem
-- pode escrever na linha já é só a dona dela (RLS com user_id = auth.uid(),
-- no USING e no WITH CHECK). O que essa restrição produzia era exatamente o
-- que aconteceu hoje — falha opaca a cada coluna nova que a tela passasse a
-- gravar.
grant insert, update on public.integracoes_whatsapp to authenticated;

-- Reafirma o que importa: leitura segue sem os segredos.
revoke select on public.integracoes_whatsapp from authenticated;
grant select (user_id, phone_number_id, verify_token, conectado_em, invalidado_em, invalidado_motivo)
  on public.integracoes_whatsapp to authenticated;
