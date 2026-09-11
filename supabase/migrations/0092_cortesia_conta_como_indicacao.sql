-- Cortesia passa a contar como indicação ativa.
--
-- A regra anterior contava só quem paga (`ativa`). A intenção era impedir
-- uma corrente: dez contas sem custo sustentando o acesso gratuito de
-- alguém, sem ninguém pagando nada.
--
-- Cortesia não abre essa porta, porque ninguém se dá cortesia: ela é
-- concedida à mão, pela dona do app, uma conta de cada vez. É uma decisão
-- de negócio deliberada — dar acesso a um testador, a um parceiro, a quem
-- está experimentando — e faz sentido que quem trouxe essa pessoa seja
-- creditado por isso. Quem indicou fez o trabalho de trazer alguém que o
-- app quis ter dentro.
--
-- O que continua de fora, e é o que realmente fecharia a corrente:
--
--   • `sem_assinatura` — quem só criou conta e nunca assinou. Cadastrar-se
--     não move o ponteiro de ninguém;
--   • `gratuita_indicacao` — quem já está de graça POR indicação. Se essas
--     contassem, dez pessoas grátis sustentariam a décima primeira, e a
--     corrente se fecharia sobre si mesma sem um único pagamento;
--   • `inadimplente` — cartão recusado. Adimplente é quem está em dia;
--   • `cancelada` — parou de pagar, mesmo que ainda use o período pago.

create or replace function public.indicados_ativos(uid uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int
  from public.profiles
  where indicado_por = uid
    and assinatura_status in ('ativa', 'cortesia')
    and assinatura_expira_em > now();
$$;

notify pgrst, 'reload schema';
