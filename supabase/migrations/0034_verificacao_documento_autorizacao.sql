-- A.2: fortalece a autorização de gravação/transcrição exigindo foto de
-- documento (RG, CNH ou passaporte) do próprio analisante, em vez de só
-- confirmar nome/CPF/nascimento digitados — que a profissional, sabendo
-- esses dados (ela mesma cadastrou), podia preencher se autoautorizando
-- com o próprio contato no lugar do analisante.
--
-- Decisão do Paulo: a imagem do documento NUNCA é armazenada. Ela trafega
-- só durante a chamada da Edge Function `confirmar-autorizacao`, é
-- processada por um serviço de OCR pra extrair o CPF, comparada, e
-- descartada. Fica só o registro de auditoria abaixo (sem a imagem).
--
-- `metodo_verificacao`: como a verificação foi feita ('documento_ocr' =
-- CPF lido do documento bateu com o cadastro; 'documento_ocr_nome' =
-- documento sem CPF legível — ex. passaporte —, aceito pelo nome
-- encontrado no texto extraído, verificação mais fraca).
-- `motivo_rejeicao`: só preenchido quando a tentativa falha ou é
-- bloqueada, pra auditoria (nunca exposto na resposta pública da API).
alter table public.autorizacoes_transcricao
  add column if not exists metodo_verificacao text,
  add column if not exists motivo_rejeicao text;
