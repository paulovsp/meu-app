-- Quem pagou o mês usa o mês, mesmo tendo cancelado.
--
-- `assinatura_ativa` é a função que autoriza TUDO: a RLS de escrita chama
-- ela, as Edge Functions de IA chamam ela, o app chama ela pra saber se
-- pode criar sessão, registro, analisante. E ela dizia:
--
--     assinatura_status in ('ativa', 'cortesia') and assinatura_expira_em > now()
--
-- Duas consequências, as duas erradas, as duas contradizendo por escrito o
-- que o produto promete:
--
--   1. CANCELAR BLOQUEAVA NA HORA. A tela de cancelamento diz "o acesso
--      continua até <data> — o período que você já pagou é seu"; o cartão
--      do perfil diz "o acesso vale até <data>"; a página de planos diz
--      "use até o fim do período já pago". Nenhuma das três era verdade:
--      no instante do cancelamento, com trinta dias pagos pela frente, a
--      pessoa perdia o direito de criar qualquer coisa. Cobrar por um mês
--      e entregar até o clique não é um bug de borda, é a cobrança de um
--      serviço não prestado.
--
--   2. A CARÊNCIA NUNCA EXISTIU. Quando uma renovação é recusada, o
--      webhook marca `inadimplente` e empurra `assinatura_expira_em` sete
--      dias pra frente — a ideia é justamente não derrubar o atendimento
--      de ninguém no meio da semana por um cartão que falhou. Só que
--      `inadimplente` também caía fora da lista, então a carência era
--      decorativa: o bloqueio vinha no mesmo segundo.
--
-- A regra correta é uma só, e já estava escrita ao lado, na segunda linha:
-- vale enquanto a validade não passou. O status diz por que o ciclo
-- terminou (cancelou, o cartão falhou, é cortesia), não se o tempo pago
-- acabou — quem responde isso é a data.
--
-- `sem_assinatura` fica de fora explicitamente em vez de depender de
-- `assinatura_expira_em` ser nulo: se um dia algum caminho gravar uma data
-- numa conta sem assinatura, o erro não vira acesso liberado. Status
-- desconhecido também fecha, pelo mesmo motivo.

create or replace function public.assinatura_ativa(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and assinatura_status in ('ativa', 'cortesia', 'cancelada', 'inadimplente')
      and assinatura_expira_em > now()
  );
$$;

notify pgrst, 'reload schema';
