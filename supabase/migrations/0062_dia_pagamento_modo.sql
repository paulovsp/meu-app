-- Como se define o dia de pagamento de quem paga mensal variável — e, com
-- isso, A QUAL MÊS aquela cobrança se refere.
--
-- O problema: cobrança mensal variável cobre as sessões JÁ FEITAS. Quem
-- recebe no começo do mês está cobrando o mês anterior (fechado); quem
-- recebe no último dia, ou no dia da última sessão, está cobrando o mês
-- corrente, que acabou de terminar. Até aqui o app somava sempre as sessões
-- do MESMO mês da cobrança — então, para a maioria (29 dos 38 analisantes),
-- o valor mostrado era o do mês errado.
--
-- Em vez de adivinhar por um dia de corte, a escolha passa a ser explícita
-- na ficha, com opções que cobrem os casos reais:
--   dia_fixo         -> dia 1, 5, 10 ou digitado  -> refere-se ao MÊS ANTERIOR
--   quinto_dia_util  -> quinto dia útil do mês    -> refere-se ao MÊS ANTERIOR
--   ultima_sessao    -> dia da última sessão do mês -> MÊS CORRENTE
--   ultimo_dia       -> último dia do mês          -> MÊS CORRENTE
alter table public.patients
  add column if not exists dia_pagamento_modo text not null default 'dia_fixo'
    check (dia_pagamento_modo in ('dia_fixo', 'quinto_dia_util', 'ultima_sessao', 'ultimo_dia'));

-- Quem já estava cadastrado continua exatamente como está: dia fixo, que é
-- o que o campo sempre significou. Nada de reinterpretar cadastro antigo.
comment on column public.patients.dia_pagamento_modo is
  'Como o dia de pagamento é definido. dia_fixo e quinto_dia_util cobram o mês anterior; ultima_sessao e ultimo_dia cobram o mês corrente.';
