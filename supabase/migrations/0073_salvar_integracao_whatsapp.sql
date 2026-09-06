-- Grava as credenciais do WhatsApp por função, não por upsert.
--
-- A tela vinha falhando com "permission denied for table
-- integracoes_whatsapp" de forma que resistiu a tudo que foi medido:
-- `has_table_privilege` confirma INSERT e UPDATE para `authenticated` em
-- todas as colunas, a sessão é válida (a mesma sessão edita outras tabelas
-- sem problema), o cache do PostgREST foi recarregado, e a própria tela
-- consegue INSERIR nesta tabela — é o `garantirTokenDeVerificacao` que cria
-- a linha do verify_token. Só o `upsert` falha.
--
-- Em vez de um sétimo palpite, tira-se o upsert da jogada. Uma função
-- SECURITY DEFINER grava com privilégio próprio, e a garantia de que ninguém
-- escreve na linha alheia sai do `auth.uid()` aqui dentro — a mesma regra
-- que a RLS aplicava, agora explícita e num lugar só.
--
-- Continua sem devolver segredo: a função não retorna nada além de sucesso.
create or replace function public.salvar_integracao_whatsapp(
  p_phone_number_id text,
  p_access_token    text,
  p_app_secret      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if coalesce(trim(p_phone_number_id), '') = ''
     or coalesce(trim(p_access_token), '') = ''
     or coalesce(trim(p_app_secret), '') = '' then
    raise exception 'Informe Phone Number ID, token de acesso e App Secret.'
      using errcode = '22023';
  end if;

  insert into public.integracoes_whatsapp
    (user_id, phone_number_id, access_token, app_secret, invalidado_em, invalidado_motivo)
  values
    (v_user, trim(p_phone_number_id), trim(p_access_token), trim(p_app_secret), null, null)
  on conflict (user_id) do update set
    phone_number_id   = excluded.phone_number_id,
    access_token      = excluded.access_token,
    app_secret        = excluded.app_secret,
    invalidado_em     = null,
    invalidado_motivo = null;
end;
$$;

revoke all on function public.salvar_integracao_whatsapp(text, text, text) from public, anon;
grant execute on function public.salvar_integracao_whatsapp(text, text, text) to authenticated;
notify pgrst, 'reload schema';
