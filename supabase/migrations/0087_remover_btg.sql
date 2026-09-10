-- Desfaz a integração com o BTG (migrations 0084, 0085 e 0086).
--
-- Por que sair: o acesso à API do BTG exige o Plano Avançado da conta PJ,
-- R$ 200 por mês. Com a base pequena, esse custo fixo pesa mais do que a
-- taxa de cartão que ele economizaria — a conta só vira a favor perto de
-- 40 a 50 assinantes. O pagamento volta pro Mercado Pago até lá.
--
-- As tabelas saem junto com o código, e não ficam "guardadas pra depois":
-- esquema morto é pior que ausência de esquema — alguém lê, acha que vale,
-- e escreve em cima. Quando a migração fizer sentido, se refaz.
--
-- As migrations 0084/0085/0086 continuam no repositório de propósito: são
-- registro do que já rodou neste banco. Reescrever histórico de migration
-- é como um dia dois ambientes divergem em silêncio.

drop table if exists public.pagamentos_assinatura;
drop table if exists public.assinaturas_btg;
drop table if exists public.recargas_credito;
drop table if exists public.btg_conexao;

-- Existia só pra decidir quem podia conectar a conta do BTG. Sem isso,
-- nada lê essa coluna.
alter table public.profiles drop column if exists is_admin;
