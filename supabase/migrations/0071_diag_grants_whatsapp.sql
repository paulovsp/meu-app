-- Diagnóstico TEMPORÁRIO dos privilégios de `integracoes_whatsapp`.
--
-- Quatro migrations de grant e o erro "permission denied" não mudou uma
-- vírgula. Isso é sinal de que a hipótese está errada, não de que falta mais
-- um grant — então em vez de um quinto palpite, aqui se lê o estado real.
--
-- Existe porque o SQL Editor do painel está sequestrando as teclas e o
-- `db dump` exige Docker, que não está disponível na máquina.
--
-- APAGAR quando o diagnóstico terminar.
create or replace function public.diag_grants_whatsapp()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'authenticated_insert', has_table_privilege('authenticated', 'public.integracoes_whatsapp', 'INSERT'),
    'authenticated_update', has_table_privilege('authenticated', 'public.integracoes_whatsapp', 'UPDATE'),
    'authenticated_select', has_table_privilege('authenticated', 'public.integracoes_whatsapp', 'SELECT'),
    'anon_insert',          has_table_privilege('anon', 'public.integracoes_whatsapp', 'INSERT'),
    'anon_select',          has_table_privilege('anon', 'public.integracoes_whatsapp', 'SELECT'),
    'col_update',           (select string_agg(column_name, ', ' order by column_name)
                               from information_schema.column_privileges
                              where table_name = 'integracoes_whatsapp'
                                and grantee = 'authenticated'
                                and privilege_type = 'UPDATE'),
    'col_insert',           (select string_agg(column_name, ', ' order by column_name)
                               from information_schema.column_privileges
                              where table_name = 'integracoes_whatsapp'
                                and grantee = 'authenticated'
                                and privilege_type = 'INSERT')
  );
$$;

grant execute on function public.diag_grants_whatsapp() to anon, authenticated;
notify pgrst, 'reload schema';
