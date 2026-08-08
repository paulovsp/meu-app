// Login por biometria (digital/Face ID), opt-in, sem depender de sessão
// persistida (supabase.js usa persistSession:false de propósito). O que
// fica guardado no aparelho não é a senha, e sim o refresh_token da sessão
// no momento em que a biometria foi ativada — protegido no Keychain/
// Keystore com `requireAuthentication`, então só sai de lá com digital/Face
// ID confirmados. Ao usar, o refresh_token é trocado por uma sessão nova
// via `refreshSession` (o Supabase roda rotação de refresh token, então o
// valor guardado é atualizado a cada uso).
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const CHAVE_TOKEN = 'dr_sig_biometria_refresh_token';
const CHAVE_EMAIL = 'dr_sig_biometria_email';
const PROMPT = 'Confirme sua identidade pra entrar no Dr.Sig';

export async function biometriaDisponivelNoAparelho() {
  const temHardware = await LocalAuthentication.hasHardwareAsync();
  if (!temHardware) return false;
  const temCadastrada = await LocalAuthentication.isEnrolledAsync();
  return temCadastrada;
}

export async function loginBiometricoEstaAtivo() {
  const email = await SecureStore.getItemAsync(CHAVE_EMAIL);
  return !!email;
}

export async function obterEmailBiometrico() {
  return SecureStore.getItemAsync(CHAVE_EMAIL);
}

export async function ativarLoginBiometrico(email) {
  const disponivel = await biometriaDisponivelNoAparelho();
  if (!disponivel) {
    throw new Error('Este aparelho não tem digital/Face ID configurados.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const refreshToken = sessionData?.session?.refresh_token;
  if (!refreshToken) {
    throw new Error('Sessão atual não encontrada. Entre novamente e tente ativar de novo.');
  }
  const resultado = await LocalAuthentication.authenticateAsync({
    promptMessage: PROMPT,
    cancelLabel: 'Cancelar',
  });
  if (!resultado.success) {
    throw new Error('Confirmação de biometria cancelada.');
  }
  await SecureStore.setItemAsync(CHAVE_TOKEN, refreshToken, { requireAuthentication: true });
  await SecureStore.setItemAsync(CHAVE_EMAIL, email);
}

export async function desativarLoginBiometrico() {
  await SecureStore.deleteItemAsync(CHAVE_TOKEN);
  await SecureStore.deleteItemAsync(CHAVE_EMAIL);
}

// Retorna { error } — em sucesso, o onAuthStateChange do AuthContext detecta
// a sessão nova sozinho (mesmo caminho de um login normal).
export async function entrarComBiometria() {
  let refreshToken;
  try {
    refreshToken = await SecureStore.getItemAsync(CHAVE_TOKEN, {
      requireAuthentication: true,
      authenticationPrompt: PROMPT,
    });
  } catch (err) {
    return { error: new Error('Não foi possível confirmar sua identidade.') };
  }
  if (!refreshToken) {
    const erro = new Error('Login por biometria não está ativado neste aparelho.');
    erro.naoConfigurado = true;
    return { error: erro };
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    // Token guardado não serve mais (ex: expirou, ou senha foi trocada) —
    // desativa pra não ficar mostrando um atalho que não funciona.
    await desativarLoginBiometrico();
    return { error: error || new Error('Sessão salva expirou. Entre com e-mail e senha.') };
  }

  // Supabase roda rotação de refresh token: o valor antigo já foi
  // invalidado no servidor, então guarda o novo pra próxima vez.
  await SecureStore.setItemAsync(CHAVE_TOKEN, data.session.refresh_token, { requireAuthentication: true });
  return { error: null };
}
