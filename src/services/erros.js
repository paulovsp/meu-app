const MSG_SEM_CONEXAO = 'Sem conexão. Tente novamente.';

// Regras que o BANCO recusa (triggers da migration 0076). O servidor é quem
// decide — a tela também confere, mas quem chamasse a API direto passaria
// por cima dela. O código curto vem em `error.message` e a explicação em
// `error.hint`; sem esta tradução, a pessoa veria "AUTOCADASTRO" na tela.
const REGRAS_DO_BANCO = {
  AUTOCADASTRO:
    'Você não pode se cadastrar como analisante de si mesma. A autorização '
    + 'de gravação existe para que outra pessoa confirme — cadastrar-se aqui '
    + 'fecharia esse circuito sozinha.',
  NOME_IMUTAVEL:
    'O nome do titular da conta não pode ser alterado depois do cadastro.',
  CPF_IMUTAVEL:
    'O CPF do titular da conta não pode ser alterado depois do cadastro.',
};

// O que o Supabase Auth responde vem em inglês, e chegava cru na tela. Uma
// testadora leu "Email not confirmed" como "o app não reconhece meu e-mail"
// (21/09/2026). Cada mensagem conhecida ganha a frase que diz o que fazer.
const AUTH = [
  [/email not confirmed/i,
    'Sua conta existe, mas o e-mail ainda não foi confirmado. Abra o e-mail '
    + '"Bem-vindo(a) ao Dr.Sig — confirme seu cadastro" e toque em Confirmar minha conta. '
    + 'Não achou? Veja a caixa de spam.'],
  [/invalid login credentials/i,
    'E-mail ou senha não conferem. Se você ainda não criou a conta, toque em Criar conta; '
    + 'se esqueceu a senha, use "Esqueceu a senha?".'],
  [/already registered|already exists|already been registered/i,
    'Já existe uma conta com este e-mail. Entre com ela, ou use "Esqueceu a senha?" na tela de entrada.'],
  [/password should be at least|password is too short|weak password/i,
    'A senha precisa ter pelo menos 6 caracteres.'],
  [/signup requires a valid password/i,
    'Digite uma senha com pelo menos 6 caracteres.'],
  [/unable to validate email|invalid format|is invalid/i,
    'Confira o e-mail digitado.'],
  [/rate limit|only request this after|too many requests/i,
    'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.'],
  [/link is invalid or has expired|otp_expired|token has expired/i,
    'Este link já foi usado ou expirou. Peça um novo.'],
  [/database error saving new user/i,
    'Não foi possível criar a conta. Confira os dados e tente de novo. Se você já tem uma '
    + 'conta com este CPF, entre com ela, ou use "Esqueceu a senha?" na tela de entrada.'],
];

export function isErroDeRede(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  if (!error.code && (msg.includes('network') || msg.includes('fetch'))) return true;
  return false;
}

export function mensagemDeErro(error, fallback = 'Não foi possível completar a ação. Tente novamente.') {
  if (isErroDeRede(error)) return MSG_SEM_CONEXAO;

  const bruta = String(error?.message || '');
  for (const [codigo, texto] of Object.entries(REGRAS_DO_BANCO)) {
    if (bruta.includes(codigo)) {
      return error?.hint ? `${texto}\n\n${error.hint}` : texto;
    }
  }
  for (const [padrao, texto] of AUTH) {
    if (padrao.test(bruta)) return texto;
  }

  return error?.message || fallback;
}
