-- Assinatura desenhada (imagem PNG em base64) pra aparecer nos recibos em
-- PDF, acima do nome/CPF/CRP impressos — não substitui esses dados, só
-- preenche visualmente a linha de assinatura. RLS/GRANT de `profiles` já
-- cobrem select/update pra authenticated (0002/0006), então só a coluna
-- nova é necessária aqui.
alter table public.profiles add column if not exists assinatura text;
