// Sessões online transcritas pelo próprio provedor da chamada (hoje, Google
// Meet; Zoom depois, com a mesma forma).
//
// Por que existe: a causa raiz das gravações que voltavam mudas é que o
// Android entrega o microfone pro app que está em chamada e SILENCIA o
// nosso. Não tem conserto pelo lado do app. Puxando o texto direto do Meet
// não existe gravação nossa, então o conflito some — e a transcrição sai sem
// custo de IA, porque quem transcreve é o Google.
//
// Só funciona em sala criada pelo Dr.Sig: o escopo do Google só dá acesso
// aos artefatos de salas criadas pelo próprio app. Por isso a sessão online
// passa a nascer aqui, e o app é quem gera o link.
import { Linking } from 'react-native';
import { supabase } from './supabase';

/** O que a conta do Google precisa ter pra transcrição automática existir.
 *  Mostrado ANTES de a pessoa tentar conectar — descobrir depois da sessão
 *  significa a sessão perdida. */
export const PLANOS_COM_TRANSCRICAO = [
  'Google Workspace Business Plus',
  'Enterprise Standard ou Enterprise Plus',
  'Education Plus',
  'Enterprise Essentials ou Essentials Plus',
];

async function invocar(funcao, body) {
  const { data, error } = await supabase.functions.invoke(funcao, { body });
  if (error) {
    let mensagem = error.message;
    let corpo = null;
    try {
      corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    const erro = new Error(mensagem);
    // Repassa as marcações que a tela usa pra decidir o que oferecer, em vez
    // de tentar adivinhar pelo texto da mensagem.
    erro.precisaConectar = !!corpo?.precisaConectar;
    erro.semTranscricaoAutomatica = !!corpo?.semTranscricaoAutomatica;
    erro.semAutorizacao = !!corpo?.semAutorizacao;
    erro.assinaturaInativa = !!corpo?.assinaturaInativa;
    throw erro;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Estado da conexão com o Google desta profissional.
 *
 * `refresh_token` nem aparece aqui: o app não tem permissão de ler essa
 * coluna (GRANT por coluna, migration 0055), então nem por engano ele
 * trafega até o aparelho.
 */
export async function getIntegracaoMeet() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('integracoes_videochamada')
    .select('conta_email, transcricao_automatica_disponivel, capacidade_verificada_em, conectado_em, invalidado_em, invalidado_motivo')
    .eq('user_id', user.id)
    .eq('provedor', 'google_meet')
    .maybeSingle();
  if (error) return null;
  return data;
}

/** true quando dá pra fazer sessão pelo Meet agora: conectada, válida e com
 *  plano que gera transcrição. */
export function integracaoUtilizavel(integracao) {
  return !!integracao
    && !integracao.invalidado_em
    && integracao.transcricao_automatica_disponivel === true;
}

/** Abre a tela de consentimento do Google no navegador. A volta acontece na
 *  página app.drsig.com.br/google-conectado.html, que finaliza a conexão. */
export async function conectarGoogle() {
  const data = await invocar('google-oauth-iniciar', {});
  if (!data?.url) throw new Error('Não foi possível iniciar a conexão com o Google.');
  await Linking.openURL(data.url);
}

export async function desconectarGoogle() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('integracoes_videochamada')
    .delete()
    .eq('user_id', user.id)
    .eq('provedor', 'google_meet');
  if (error) throw error;
}

/** Cria a sala da sessão e devolve o link. O servidor confere autorização do
 *  analisante, assinatura e plano antes de criar — a tela não é a única
 *  trava. */
export async function criarSalaMeet(sessionId) {
  return invocar('meet-criar-sala', { sessionId });
}

/** Força a busca da transcrição de uma sessão, sem esperar o ciclo de 5
 *  minutos do cron. */
export async function buscarTranscricaoMeet(sessionId) {
  return invocar('meet-buscar-transcricao', { sessionId });
}
