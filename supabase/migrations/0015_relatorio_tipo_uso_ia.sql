-- A Edge Function `ia-busca` (antes só o chat livre) passa a ser reaproveitada
-- pra gerar relatórios por analisante — o tipo gravado no histórico de uso
-- muda de 'busca' pra 'relatorio' pra refletir isso. Linhas antigas com
-- 'busca' continuam válidas (fato histórico), só o valor novo precisa ser
-- aceito daqui pra frente.
alter table public.uso_ia drop constraint uso_ia_tipo_check;
alter table public.uso_ia
  add constraint uso_ia_tipo_check
  check (tipo in ('transcricao', 'ocr', 'analise_texto', 'busca', 'renovacao', 'relatorio'));
