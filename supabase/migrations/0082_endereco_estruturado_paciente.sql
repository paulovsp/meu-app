-- Endereço do analisante em partes, para o CEP poder preencher o resto.
--
-- Até aqui era um campo de texto livre, `endereco`, digitado inteiro à mão
-- — rua, número, bairro, cidade. Com o CEP, os Correios respondem tudo
-- menos número e complemento, que é a única parte que ninguém adivinha.
--
-- O perfil da profissional já tinha essas colunas desde a migration 0008 e
-- o app nunca as usou; agora as duas fichas ficam com a mesma forma.
--
-- `endereco` continua existindo e continua sendo escrito, montado a partir
-- das partes: é o que a ficha do analisante mostra e o que qualquer
-- exportação já lê. Trocar isso agora quebraria telas por nenhum ganho —
-- e a linha montada é justamente a forma legível do endereço.
alter table public.patients
  add column if not exists cep text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cidade text,
  add column if not exists uf text;

notify pgrst, 'reload schema';
