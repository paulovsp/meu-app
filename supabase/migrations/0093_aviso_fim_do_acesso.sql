-- Marca até onde o aviso de fim de acesso já foi dado.
--
-- O acesso de uma conta sem cobrança recorrente — cortesia, período
-- concedido à mão, acesso gratuito por indicação que acabou — simplesmente
-- termina na data. Até agora o único lugar que dizia isso era o cartão
-- dentro do app, que a pessoa precisa abrir para ver. Quem não abrisse
-- descobria tentando usar, no dia seguinte, com a porta fechada.
--
-- O aviso sai a 7 dias e de novo a 1 dia do fim. Esta coluna guarda qual
-- desses marcos já foi enviado (7 ou 1), e existe por um motivo só: a
-- conferência acorda todo dia, e sem isto o mesmo aviso sairia sete vezes
-- seguidas. Aviso repetido vira ruído, e ruído é o que faz alguém ignorar
-- o aviso que importava.
--
-- Volta a ficar nula quando o acesso é renovado ou a pessoa assina: o
-- ciclo seguinte tem direito aos próprios avisos.
alter table public.profiles
  add column if not exists aviso_fim_acesso_dias smallint;

comment on column public.profiles.aviso_fim_acesso_dias is
  'Último marco de aviso de fim de acesso já enviado (7 ou 1). Nulo = nenhum aviso pendente para o ciclo atual.';

notify pgrst, 'reload schema';
