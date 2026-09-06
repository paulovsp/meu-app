-- Reproduz o upsert da tela de WhatsApp como a role `authenticated`, com as
-- claims de JWT da própria usuária, e devolve o erro cru.
--
-- Por que: quatro migrations de grant não mudaram o erro, a leitura dos
-- privilégios mostrou INSERT e UPDATE liberados em todas as colunas, sessão
-- nova também falhou, e a biblioteca usa return=minimal (então não é SELECT
-- implícito). Adivinhar de novo seria custear mais um ciclo de teste do
-- usuário. Aqui a operação é executada de verdade e o erro capturado.
--
-- Não altera dado: a escrita acontece numa subtransação que é sempre
-- desfeita por uma exceção proposital.
--
-- APAGAR junto com a 0071 quando terminar.
create or replace function public.diag_upsert_whatsapp()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_res  text;
begin
  select user_id into v_user from public.integracoes_whatsapp limit 1;
  if v_user is null then
    return 'nenhuma linha em integracoes_whatsapp - rode a tela uma vez antes';
  end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    set local role authenticated;

    insert into public.integracoes_whatsapp
      (user_id, phone_number_id, access_token, app_secret, invalidado_em, invalidado_motivo)
    values (v_user, 'diag', 'diag', 'diag', null, null)
    on conflict (user_id) do update set
      phone_number_id   = excluded.phone_number_id,
      access_token      = excluded.access_token,
      app_secret        = excluded.app_secret,
      invalidado_em     = excluded.invalidado_em,
      invalidado_motivo = excluded.invalidado_motivo;

    -- Desfaz: só interessava saber se passa, não gravar.
    raise exception using errcode = 'P0001', message = 'DIAG_OK';
  exception
    when sqlstate 'P0001' then v_res := 'PASSOU (sem erro de permissao)';
    when others then v_res := sqlstate || ' :: ' || sqlerrm;
  end;

  reset role;
  return v_res;
end;
$$;

grant execute on function public.diag_upsert_whatsapp() to anon, authenticated;
notify pgrst, 'reload schema';
