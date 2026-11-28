// Versão de computador (web) do login por digital/Face ID.
//
// No navegador não há digital nem cofre seguro do aparelho (SecureStore),
// então o login é sempre por e-mail e senha. Este arquivo substitui
// biometria.js só na versão web (o Metro escolhe o .web.js sozinho) e
// mantém as mesmas funções, para nenhuma tela precisar saber disso.
export async function biometriaDisponivelNoAparelho() { return false; }
export async function loginBiometricoEstaAtivo() { return false; }
export async function obterEmailBiometrico() { return null; }
export async function ativarLoginBiometrico() {
  throw new Error('No computador, a entrada é sempre com e-mail e senha.');
}
export async function sincronizarTokenBiometrico() {}
export async function desativarLoginBiometrico() {}
export async function entrarComBiometria() {
  const erro = new Error('No computador, a entrada é sempre com e-mail e senha.');
  erro.naoConfigurado = true;
  return { error: erro };
}
