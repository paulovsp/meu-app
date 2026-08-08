const MSG_SEM_CONEXAO = 'Sem conexão. Tente novamente.';

export function isErroDeRede(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  if (!error.code && (msg.includes('network') || msg.includes('fetch'))) return true;
  return false;
}

export function mensagemDeErro(error, fallback = 'Não foi possível completar a ação. Tente novamente.') {
  if (isErroDeRede(error)) return MSG_SEM_CONEXAO;
  return error?.message || fallback;
}
