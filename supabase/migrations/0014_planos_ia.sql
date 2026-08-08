-- Plano de assinatura (define quanto de crédito de IA a conta recebe por
-- mês) + data da próxima renovação automática. Atribuição de plano
-- continua manual (mesmo padrão do saldo de créditos) — o admin ajusta
-- direto aqui no Supabase.
alter table public.profiles
  add column if not exists plano_ia text check (plano_ia in ('mensal', 'semestral', 'anual'));
alter table public.profiles
  add column if not exists proxima_renovacao_credito date;

-- 'renovacao' é um novo tipo de linha em uso_ia: o crédito mensal automático
-- do plano, sempre com custo_estimado NEGATIVO (é o oposto de consumo) —
-- assim o histórico de uso já criado na migration 0013 mostra os dois lados
-- (consumo e recarga) numa timeline só, sem precisar de tabela nova.
alter table public.uso_ia drop constraint uso_ia_tipo_check;
alter table public.uso_ia
  add constraint uso_ia_tipo_check
  check (tipo in ('transcricao', 'ocr', 'analise_texto', 'busca', 'renovacao'));
