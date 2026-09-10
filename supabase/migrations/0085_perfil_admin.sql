-- Quem administra a Dr.Sig.
--
-- A conexão da conta do BTG é da empresa, não de cada usuária: uma linha
-- só, e é dela que sai o recebimento de todas as recargas. Sem esta marca,
-- qualquer conta poderia refazer o OAuth e apontar o dinheiro pra outro
-- lugar. Só quem tem `is_admin` chama `btg-oauth-iniciar`.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Não é editável pelo app: a coluna existe pra ser mudada aqui, por quem
-- tem acesso ao banco. Deixar no UPDATE do próprio perfil seria o mesmo
-- que não ter checagem nenhuma.
revoke update (is_admin) on public.profiles from anon, authenticated;

update public.profiles
   set is_admin = true
 where id = (select id from auth.users where email = 'paulovsp@gmail.com');

comment on column public.profiles.is_admin is
  'Administração da Dr.Sig. Hoje só controla quem pode conectar a conta do BTG (migration 0085).';
