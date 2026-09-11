-- A conta de demonstração mostrava o CPF e o telefone reais do dono.
--
-- O perfil do consultório fictício (oseusig@gmail.com) foi criado com o
-- CPF do desenvolvedor — o único que pode ter mais de uma conta (0020) —
-- e com o telefone dele. Como a senha dessa conta está impressa na tela
-- de entrada, qualquer visitante abria Meu Perfil e via os dois.
--
-- O CPF vira um número fictício mas válido (passa no dígito verificador,
-- para o app não acusar CPF inválido), e o telefone, um da mesma faixa
-- usada nas fichas de exemplo. Para gravar o CPF é preciso desligar o
-- trigger que o torna imutável (0076) — só nesta transação, e só nesta
-- linha.
--
-- E o crédito de IA da demonstração vai a zero: nenhuma função de IA
-- deveria aceitar essa conta (isso é tratado no servidor, em
-- _shared/contaDemonstracao.ts), e um saldo positivo ali é dinheiro do
-- dono à disposição de quem digitar a senha pública.
alter table public.profiles disable trigger profiles_nome_cpf_imutaveis;

update public.profiles
set cpf = '402.317.856-07',
    telefone = '11988120000',
    creditos_ia = 0
where email = 'oseusig@gmail.com' and conta_demonstracao;

alter table public.profiles enable trigger profiles_nome_cpf_imutaveis;
