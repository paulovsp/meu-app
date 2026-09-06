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

  return error?.message || fallback;
}
