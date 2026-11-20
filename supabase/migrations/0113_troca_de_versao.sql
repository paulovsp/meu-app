-- Troca de versão sem assinatura nova (20/11/2026).
--
-- Regra do Paulo: sem cobrança proporcional, e nunca cobrar um período
-- cheio mais caro que a pessoa não vai usar inteiro. A troca só muda o
-- valor da próxima cobrança no Mercado Pago:
--   • subida (agenda → completa) vale na hora; o resto do período pago sai
--     de cortesia;
--   • descida (completa → agenda) fica agendada para o fim do período já
--     pago. Até lá a conta segue na completa.
--
-- Estas duas colunas guardam a descida agendada. Quem aplica é
-- sincronizarPreapproval (webhook e conferência diária), quando
-- `assinatura_versao_muda_em` passa. Fechadas para o app pelo 0094, como
-- `assinatura_versao`: só o servidor escreve.

alter table public.profiles
  add column if not exists assinatura_versao_proxima text,
  add column if not exists assinatura_versao_muda_em timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_assinatura_versao_proxima_check'
  ) then
    alter table public.profiles
      add constraint profiles_assinatura_versao_proxima_check
      check (assinatura_versao_proxima is null or assinatura_versao_proxima in ('agenda', 'completa'));
  end if;
end $$;

comment on column public.profiles.assinatura_versao_proxima is
  'Versão que entra em assinatura_versao_muda_em (descida agendada). Ver migration 0113.';
comment on column public.profiles.assinatura_versao_muda_em is
  'Quando assinatura_versao_proxima passa a valer: o fim do período já pago.';

notify pgrst, 'reload schema';
