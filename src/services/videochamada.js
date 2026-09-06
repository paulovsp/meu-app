// Sessões online transcritas pelo próprio provedor da chamada — Google Meet
// e Zoom.
//
// Por que existe: a causa raiz das gravações que voltavam mudas é que o
// Android entrega o microfone pro app que está em chamada e SILENCIA o
// nosso. Não tem conserto pelo lado do app. Puxando o texto direto do
// provedor não existe gravação nossa, então o conflito some — e a
// transcrição sai sem custo de IA, porque quem transcreve é o Google/Zoom.
//
// Nos dois casos a sessão nasce aqui e o app gera o link: no Meet porque o
// escopo só dá acesso a salas criadas pelo próprio app; no Zoom porque é o
// que permite ligar a gravação em nuvem automaticamente, sem depender de
// alguém lembrar de apertar "gravar".
//
// Como o texto chega, e é a diferença entre os dois: o Meet não avisa
// ninguém (por isso lá existe um cron de varredura), enquanto o Zoom manda
// webhook quando a gravação/transcrição fica pronta.
import { Linking } from 'react-native';
import { supabase } from './supabase';

/** O que a conta precisa ter pra transcrição automática existir, por
 *  provedor. Mostrado ANTES de a pessoa tentar conectar — descobrir depois
 *  da sessão significa a sessão perdida. */
export const PROVEDORES = {
  google_meet: {
    id: 'google_meet',
    label: 'Google Meet',
    plataformaApp: 'meet',
    icone: 'logo-google',
    requisitos: [
      'Google Workspace Business Plus',
      'Enterprise Standard ou Enterprise Plus',
      'Education Plus',
      'Enterprise Essentials ou Essentials Plus',
    ],
    ressalva: 'Conta pessoal @gmail.com e planos Business Starter/Standard não geram transcrição automática.',
    // Quem transcreve é o próprio Google, então não há custo de IA a repassar.
    consomeCreditos: false,
    comoTranscreve: 'Quem transcreve é o próprio Google Meet, sem consumir créditos de IA.',
  },
  zoom: {
    id: 'zoom',
    label: 'Zoom',
    plataformaApp: 'zoom',
    icone: 'videocam-outline',
    requisitos: [
      'Zoom Pro, Business, Education ou Enterprise',
      'Gravação em nuvem ativada na conta',
    ],
    ressalva: 'O plano gratuito do Zoom não grava em nuvem, e sem gravação em nuvem o Dr.Sig não tem de onde tirar o áudio.',
    // Mudou em 06/09/2026: a transcrição do próprio Zoom sai em inglês mesmo
    // com a sessão inteira em português, e não há ajuste de conta que
    // resolva. O Zoom passou a servir só pra captar o áudio; quem transcreve
    // é a AssemblyAI — e isso, sim, consome créditos.
    consomeCreditos: true,
    comoTranscreve: 'O Zoom grava o áudio e a transcrição é feita pelo Dr.Sig, em português — isso consome créditos de IA, como uma sessão gravada pelo aparelho.',
  },
};

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
export async function getIntegracao(provedor) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('integracoes_videochamada')
    .select('provedor, conta_email, conta_nome, transcricao_automatica_disponivel, capacidade_verificada_em, conectado_em, invalidado_em, invalidado_motivo')
    .eq('user_id', user.id)
    .eq('provedor', provedor)
    .maybeSingle();
  if (error) return null;
  return data;
}

/** Todas as contas conectadas, pra tela de sessão saber quais plataformas
 *  já podem transcrever sem gravar pelo aparelho. */
export async function getIntegracoes() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('integracoes_videochamada')
    .select('provedor, conta_email, transcricao_automatica_disponivel, invalidado_em')
    .eq('user_id', user.id);
  if (error) return [];
  return data || [];
}

export const getIntegracaoMeet = () => getIntegracao('google_meet');

/** true quando dá pra fazer sessão por aquele provedor agora: conectada,
 *  válida e com plano que gera transcrição. */
export function integracaoUtilizavel(integracao) {
  return !!integracao
    && !integracao.invalidado_em
    && integracao.transcricao_automatica_disponivel === true;
}

/**
 * O estado da conexão em uma palavra. São QUATRO, não dois — e a tela
 * tratava três deles como o mesmo "não funciona", o que fazia uma conta
 * boa parecer defeituosa só porque a consulta de configurações falhou.
 *
 *  'ausente'      — nenhuma conta conectada.
 *  'expirada'     — conectada, mas o acesso foi revogado/expirou.
 *  'pronta'       — conectada e o plano gera transcrição.
 *  'sem_recurso'  — conectada, e o provedor respondeu que o plano NÃO gera.
 *  'indefinida'   — conectada, e não deu pra confirmar (a consulta falhou).
 *                   Diferente de 'sem_recurso': aqui pode muito bem
 *                   funcionar, só não dá pra prometer.
 */
export function estadoIntegracao(integracao) {
  if (!integracao) return 'ausente';
  if (integracao.invalidado_em) return 'expirada';
  const disponivel = integracao.transcricao_automatica_disponivel;
  if (disponivel === true) return 'pronta';
  if (disponivel === false) return 'sem_recurso';
  return 'indefinida';
}

/** Abre a tela de consentimento do provedor no navegador. A volta acontece
 *  na página app.drsig.com.br/<provedor>-conectado.html, que finaliza a
 *  conexão (o app não tem deep link configurado). */
export async function conectar(provedor) {
  const funcao = provedor === 'zoom' ? 'zoom-oauth-iniciar' : 'google-oauth-iniciar';
  const data = await invocar(funcao, {});
  if (!data?.url) throw new Error('Não foi possível iniciar a conexão.');
  await Linking.openURL(data.url);
}

export async function desconectar(provedor) {
  // Zoom: apagar a linha aqui não desfaz nada do lado do Zoom — a
  // autorização continua de pé lá, e reconectar voltava direto na mesma
  // conta, sem nem perguntar qual. Quem cancela de verdade é o servidor,
  // que tem o refresh_token (o app não tem permissão de ler essa coluna).
  if (provedor === 'zoom') {
    await invocar('zoom-desconectar', {});
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('integracoes_videochamada')
    .delete()
    .eq('user_id', user.id)
    .eq('provedor', provedor);
  if (error) throw error;
}

/** Cria a sala do Meet e devolve o link. O servidor confere autorização do
 *  analisante, assinatura e plano antes de criar — a tela não é a única
 *  trava. */
export async function criarSalaMeet(sessionId) {
  return invocar('meet-criar-sala', { sessionId });
}

/** Cria a reunião do Zoom da sessão. Mesmas travas do Meet, conferidas no
 *  servidor: autorização do analisante, assinatura e plano. */
export async function criarReuniaoZoom(sessionId) {
  return invocar('zoom-criar-reuniao', { sessionId });
}

/** Cria a sala/reunião conforme a plataforma escolhida na tela. */
export function criarSalaDaPlataforma(plataformaId, sessionId) {
  return plataformaId === 'zoom' ? criarReuniaoZoom(sessionId) : criarSalaMeet(sessionId);
}

/** Força a busca da transcrição de uma sessão, sem esperar o ciclo do cron
 *  (2 minutos). Usada pelo botão "Buscar transcrição agora" na sessão. */
export async function buscarTranscricaoMeet(sessionId) {
  return invocar('meet-buscar-transcricao', { sessionId });
}

/** Idem, pro Zoom: baixa o áudio da gravação em nuvem e manda pra
 *  transcrição, sem esperar o cron. */
export async function buscarTranscricaoZoom(sessionId) {
  return invocar('zoom-buscar-transcricao', { sessionId });
}

/** Despacha pro provedor certo — a tela da sessão sabe a plataforma, não
 *  precisa saber qual função é de quem. */
export function buscarTranscricaoDaPlataforma(plataformaId, sessionId) {
  return plataformaId === 'zoom'
    ? buscarTranscricaoZoom(sessionId)
    : buscarTranscricaoMeet(sessionId);
}
