-- A.1/A.3: quando o e-mail de LOGIN (auth.users) muda — via o fluxo de
-- confirmação do Supabase Auth, disparado por supabase.auth.updateUser({
-- email }) em src/services/conta.js — reflete em profiles.email
-- automaticamente. Sem isso, os dois campos ficam dessincronizados: o
-- profissional passa a entrar com o e-mail novo mas o cadastro (usado em
-- e-mails automáticos, recibos etc.) continua mostrando o antigo.
create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_updated();
