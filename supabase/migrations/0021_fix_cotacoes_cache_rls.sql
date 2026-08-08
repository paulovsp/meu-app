-- src/services/currency.js chama salvarCotacaoCache diretamente do
-- cliente (não por Edge Function) — a tabela cotacoes_cache tinha GRANT
-- de insert/update pra authenticated (migration 0006), mas nenhuma
-- RLS POLICY correspondente (a 0005 dizia explicitamente "sem policy de
-- insert/update/delete"). RLS bloqueia a gravação mesmo com GRANT, se não
-- houver uma policy liberando — por isso a cotação nunca era salva de
-- verdade (a busca no Banco Central funcionava, só o cache falhava
-- silenciosamente). É um cache compartilhado de cotação PÚBLICA
-- (PTAX/BCB), sem dado sensível nenhum, então é seguro qualquer conta
-- autenticada gravar.
drop policy if exists "cotacoes_insert_auth" on public.cotacoes_cache;
create policy "cotacoes_insert_auth" on public.cotacoes_cache
  for insert to authenticated with check (true);

drop policy if exists "cotacoes_update_auth" on public.cotacoes_cache;
create policy "cotacoes_update_auth" on public.cotacoes_cache
  for update to authenticated using (true) with check (true);
