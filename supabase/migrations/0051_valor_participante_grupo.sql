-- Sessão/supervisão em grupo: quanto CADA integrante paga por aquele grupo.
--
-- Até aqui o app usava sempre `patients.preco_sessao` (o preço da sessão
-- INDIVIDUAL da pessoa) pra calcular o que ela contribui num grupo — o que
-- praticamente nunca é o valor combinado: grupo costuma ter valor próprio,
-- normalmente menor, e às vezes diferente entre integrantes. Sem um valor do
-- grupo, Financeiro/Recebíveis/Fiscal somavam um número que não existia.
--
-- Os dois campos são OPCIONAIS: nulo = "usa o que está na ficha da pessoa",
-- que é exatamente o comportamento de antes. Nenhum grupo já cadastrado
-- muda de valor por causa desta migration.
alter table public.slot_participantes add column if not exists valor_sessao numeric;
alter table public.slot_participantes add column if not exists tipo_cobranca text
  check (tipo_cobranca is null or tipo_cobranca in ('mensal', 'mensal_fixo', 'por_sessao'));

-- Mesma dupla na OCORRÊNCIA, copiada do template no momento em que o
-- compromisso é materializado: o que já aconteceu precisa guardar o valor
-- vigente naquele dia. Sem isso, reajustar o grupo reescreveria o histórico
-- financeiro de todas as sessões passadas.
alter table public.appointment_participantes add column if not exists valor_sessao numeric;
alter table public.appointment_participantes add column if not exists tipo_cobranca text
  check (tipo_cobranca is null or tipo_cobranca in ('mensal', 'mensal_fixo', 'por_sessao'));
