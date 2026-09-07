-- Formatação por afazer: tamanho, negrito e cor.
--
-- A lista de afazeres é a única do app onde a pessoa organiza prioridade
-- com as próprias mãos (a ordem manual veio na 0079). Poder destacar um
-- item — maior, em negrito, em vermelho — é a continuação disso: a ordem
-- diz o que vem antes, o destaque diz o que pesa.
--
-- Três colunas e não um JSON de estilo: são três atributos fechados, com
-- valores conhecidos, e `check` no banco é o que impede a tela de gravar
-- um tamanho que ninguém sabe renderizar.
--
-- `cor` guarda o NOME da cor, não o hexadecimal. Os hexadecimais vivem em
-- src/theme e mudam quando a identidade do app mudar; se estivessem
-- gravados aqui, cada mudança de paleta exigiria migrar dado.
alter table public.afazeres
  add column if not exists tamanho text not null default 'm'
    check (tamanho in ('p', 'm', 'g')),
  add column if not exists negrito boolean not null default false,
  add column if not exists cor text
    check (cor is null or cor in ('verde', 'ambar', 'vermelho', 'azul', 'roxo'));

-- `cor` nula = cor padrão do texto. Deixar nulo em vez de gravar 'padrao'
-- mantém o significado no lugar certo: a ausência de escolha é a ausência
-- de destaque.

notify pgrst, 'reload schema';
