-- `profiles.email` passa a ser, por construção, um ESPELHO de
-- `auth.users.email` — nunca um valor editável por conta própria.
--
-- Contexto: uma versão antiga da tela de Perfil gravava o campo de e-mail
-- direto no update em lote de `profiles`, sem tocar no Auth. Resultado: o
-- cadastro passou a mostrar um e-mail e o login continuou sendo outro (o
-- Auth nunca mudou). Isso já foi corrigido no app (item A.1/A.3 — a tela
-- não manda mais `email` no update e a troca passa por
-- `auth.updateUser` + link de confirmação, com a sincronia de volta feita
-- pela migration 0033), mas até aqui a garantia era só "o código não
-- escreve nesse campo" — frágil contra uma regressão futura ou uma edição
-- manual pelo painel do Supabase.
--
-- O trigger abaixo fecha isso no banco: qualquer tentativa de gravar em
-- profiles.email um valor diferente do e-mail de login é silenciosamente
-- trocada pelo valor correto, venha de onde vier.
--
-- Por que não quebra a troca legítima de e-mail: o trigger de 0033 roda
-- DEPOIS do update em auth.users, então quando ele faz
-- `update profiles set email = new.email`, o `auth.users.email` já é o
-- valor novo — a leitura aqui devolve esse mesmo valor e a escrita passa.
create or replace function public.forcar_email_perfil_do_login()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  email_login text;
begin
  select email into email_login from auth.users where id = new.id;
  -- Conta sem linha correspondente no Auth não deveria existir; nesse caso
  -- não inventa nada, deixa passar como está.
  if email_login is not null then
    new.email := email_login;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_email_forcar_login on public.profiles;
create trigger on_profile_email_forcar_login
  before update of email on public.profiles
  for each row
  execute function public.forcar_email_perfil_do_login();

-- Reparo do dado já divergente: alinha todo profiles.email ao e-mail de
-- login real. Na prática hoje isso atinge uma única conta (a que sofreu o
-- bug antigo) — as demais já batem, então a linha é idempotente.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;
