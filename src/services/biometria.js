// Login por biometria (digital/Face ID), opt-in, sem depender de sessão
// persistida (supabase.js usa persistSession:false de propósito). O que
// fica guardado no aparelho não é a senha, e sim o refresh_token da sessão
// no momento em que a biometria foi ativada.
//
// A confirmação biométrica é feita por UMA chamada explícita a
// `LocalAuthentication.authenticateAsync()` — não pelo `requireAuthentication`
// do SecureStore. Motivo: o Supabase roda rotação de refresh token a cada
// uso (o valor salvo precisa ser reescrito depois de cada login), e no
// Android uma chave de Keystore criada com `requireAuthentication:true`
// exige confirmação a CADA operação de cripto, leitura E escrita — isso
// gerava duas telas de digital em sequência (uma pra ler o token antigo,
// outra pra salvar o token novo já rotacionado), a segunda aparecendo
// depois que o usuário já tinha entrado no app. Cancelar essa segunda tela
// não desloga ninguém, mas deixa o token salvo desatualizado — e como o
// valor antigo já foi invalidado pelo Supabase na rotação, o PRÓXIMO login
// por digital falhava sozinho. Com um único gate explícito antes de
// qualquer leitura/escrita (ambas em modo simples, sem `requireAuthentication`
// no SecureStore), só existe uma tela por login.
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
  await SecureStore.setItemAsync(CHAVE_TOKEN, refreshToken);
  await SecureStore.setItemAsync(CHAVE_EMAIL, email);
}

export async function desativarLoginBiometrico() {
  await SecureStore.deleteItemAsync(CHAVE_TOKEN);
  await SecureStore.deleteItemAsync(CHAVE_EMAIL);
}

// Retorna { error } — em sucesso, o onAuthStateChange do AuthContext detecta
// a sessão nova sozinho (mesmo caminho de um login normal).
export async function entrarComBiometria() {
  const refreshToken = await SecureStore.getItemAsync(CHAVE_TOKEN);
  if (!refreshToken) {
    const erro = new Error('Login por biometria não está ativado neste aparelho.');
    erro.naoConfigurado = true;
    return { error: erro };
  }

  const resultado = await LocalAuthentication.authenticateAsync({
    promptMessage: PROMPT,
    cancelLabel: 'Cancelar',
  }).catch(() => ({ success: false }));
  if (!resultado.success) {
    return { error: new Error('Confirmação de biometria cancelada.') };
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    // Token guardado não serve mais (ex: expirou, ou senha foi trocada) —
    // desativa pra não ficar mostrando um atalho que não funciona.
    await desativarLoginBiometrico();
    return { error: error || new Error('Sessão salva expirou. Entre com e-mail e senha.') };
  }

  // Supabase roda rotação de refresh token: o valor antigo já foi
  // invalidado no servidor, então guarda o novo pra próxima vez — sem
  // prompt novo, já confirmamos a identidade acima.
  await SecureStore.setItemAsync(CHAVE_TOKEN, data.session.refresh_token);
  return { error: null };
}
