// Estado da assinatura — única fonte de verdade é a função SQL
// `assinatura_ativa` (ver migration 0025), consultada aqui via RPC. Nunca
// replica a regra (ativa/cortesia + ainda dentro da validade) em JS: se a
// regra mudar no banco, este arquivo não precisa mudar.
import { supabase } from './supabase';

// Texto único, usado em todo canto que precisa avisar a psicanalista sobre
// assinatura inativa (banner, telas de criação bloqueadas, erro do
// ia-busca) — política do Google Play proíbe qualquer link, preço ou
// instrução de pagamento nas telas do app; a ponte pro site é o e-mail.
//
// Ele dizia "enviamos um e-mail com os próximos passos", e nenhum e-mail
// era enviado: o envio só acontece quando a pessoa PEDE, em Meu Perfil ›
// Seu plano. Quem batia no bloqueio ficava esperando uma mensagem que
// nunca ia chegar. Agora o texto aponta pro botão que existe de verdade —
// mandar um e-mail a cada toque bloqueado seria pior, viraria spam.
export const MENSAGEM_ASSINATURA_INATIVA =
  'Sua conta está sem assinatura ativa. Você continua com acesso a tudo que já ' +
  'registrou, e pode exportar seus dados quando quiser.\n\n' +
  'Para ativar, abra Meu Perfil › Seu plano e toque em "Receber o link por e-mail".';

/** Quantos dias faltam para uma data (negativo = já passou). */
function diasAte(iso) {
  if (!iso) return null;
  const alvo = new Date(iso);
  if (Number.isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  const soData = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((soData(alvo) - soData(hoje)) / 86400000);
}

export const PLANO_LABEL_ASSINATURA = {
  mensal: 'Mensal',
  semestral: 'Semestral',
  anual: 'Anual',
};

/**
 * O estado da assinatura, para MOSTRAR — não para autorizar.
 *
 * Quem autoriza continua sendo a RLS do banco; isto existe porque o app
 * nunca dizia à pessoa em que situação ela estava. Uma conta sem plano
 * recebia "Assinatura inativa" a cada tentativa de criar qualquer coisa,
 * sem nunca informar o status, a validade, ou o que fazer a respeito —
 * e quem estava prestes a vencer não era avisado de nada.
 *
 * `situacao`:
 *  'ativa'      — em dia. `diasRestantes` diz quanto falta.
 *  'vencendo'   — ativa, mas acaba em 7 dias ou menos.
 *  'inadimplente' — pagamento não confirmado; ainda há prazo.
 *  'cancelada'  — não renova, mas vale até a data.
 *  'expirada'   — já teve plano e venceu.
 *  'nenhuma'    — nunca assinou.
 *  'indefinida' — não deu para consultar (rede). Não afirma nada.
 */
export async function getStatusAssinatura() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { situacao: 'indefinida' };

  const { data, error } = await supabase
    .from('profiles')
    .select('assinatura_status, assinatura_plano, assinatura_expira_em, email')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !data) return { situacao: 'indefinida' };

  const dias = diasAte(data.assinatura_expira_em);
  const base = {
    plano: data.assinatura_plano || null,
    planoLabel: PLANO_LABEL_ASSINATURA[data.assinatura_plano] || null,
    expiraEm: data.assinatura_expira_em || null,
    diasRestantes: dias,
    email: data.email || session.user.email || null,
    cortesia: data.assinatura_status === 'cortesia',
  };

  const valendo = (data.assinatura_status === 'ativa' || data.assinatura_status === 'cortesia')
    && dias != null && dias >= 0;

  if (valendo) {
    return { ...base, situacao: dias <= 7 ? 'vencendo' : 'ativa' };
  }
  if (data.assinatura_status === 'inadimplente') return { ...base, situacao: 'inadimplente' };
  if (data.assinatura_status === 'cancelada') {
    return { ...base, situacao: dias != null && dias >= 0 ? 'cancelada' : 'expirada' };
  }
  if (data.assinatura_status === 'sem_assinatura') return { ...base, situacao: 'nenhuma' };
  return { ...base, situacao: 'expirada' };
}

/**
 * Reenvia, por e-mail, o link para escolher o plano.
 *
 * É a saída do beco: sem isto, o aviso "enviamos um e-mail" apontava para
 * uma mensagem que a pessoa podia não ter mais, e não havia nada a fazer
 * dentro do app.
 */
export async function reenviarInstrucoesDePlano() {
  const { data, error } = await supabase.functions.invoke('reenviar-instrucoes-plano', { body: {} });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    throw new Error(mensagem);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Cancela a assinatura desta conta.
 *
 * A tela de pagamento promete "cancele quando quiser, pelo app" — e até
 * agora não havia onde. A única coisa parecida no perfil era "Excluir
 * conta", que apaga tudo: quem só queria parar de pagar tinha que escolher
 * entre continuar pagando e destruir o próprio arquivo clínico.
 *
 * Devolve `validaAte`: cancelar não tira o acesso na hora, e essa é a data
 * até quando o que já foi pago continua valendo.
 */
export async function cancelarAssinatura() {
  const { data, error } = await supabase.functions.invoke('assinatura-cancelar', { body: {} });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    throw new Error(mensagem);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function assinaturaEstaAtiva() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data, error } = await supabase.rpc('assinatura_ativa', { uid: session.user.id });
  if (error) {
    console.error('Erro ao checar assinatura:', error.message);
    // Falha aberta: um erro de rede aqui não deve travar quem já está com
    // assinatura ativa — a RLS do banco é a checagem real e continua
    // valendo em qualquer tentativa de escrita, mesmo que este aviso falhe.
    return true;
  }
  return !!data;
}
