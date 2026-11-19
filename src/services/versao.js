// As duas versões do Dr.Sig.
//
//  'agenda'   — Agenda inteligente: agenda, financeiro, fiscal, afazeres e
//               a ficha administrativa de cada analisante. Sem registros
//               clínicos, sem Busca Dr.Sig, sem relatórios por IA.
//  'completa' — Agenda + Arquivo inteligente: tudo.
//
// A coluna é `profiles.assinatura_versao` (migration 0112). Quem decide de
// verdade é o banco (`arquivo_liberado`, nas políticas de `records`); isto
// aqui só serve pra tela mostrar cadeado em vez de deixar a pessoa
// preencher um registro inteiro e levar um erro de permissão no fim.
//
// Ler os registros que já existem nunca é bloqueado no banco: o que é seu
// continua seu. Na versão Agenda eles só não aparecem na tela — e voltam
// se a pessoa voltar para a versão completa.
import { supabase } from './supabase';

export const VERSAO_AGENDA = 'agenda';
export const VERSAO_COMPLETA = 'completa';

export const VERSAO_LABEL = {
  [VERSAO_AGENDA]: 'Agenda inteligente',
  [VERSAO_COMPLETA]: 'Agenda + Arquivo inteligente',
};

// Sem preço e sem link de propósito: o Google Play não permite nenhum dos
// dois nas telas do app. O caminho é o mesmo do plano — e-mail com o link.
export const MENSAGEM_SO_NA_VERSAO_COMPLETA =
  'Esta parte faz parte da versão Agenda + Arquivo inteligente. A sua conta está na ' +
  'versão Agenda inteligente, que guarda só os dados administrativos dos analisantes.\n\n' +
  'Para mudar de versão, abra Meu Perfil › Seu plano e toque em "Receber o link por e-mail".';

/** A versão da conta logada. Na dúvida (sem sessão, erro de rede),
 *  devolve 'completa': a tela não esconde nada de quem paga, e o banco
 *  continua barrando a escrita de quem não pode. */
export async function getVersaoDaConta() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return VERSAO_COMPLETA;
  const { data, error } = await supabase
    .from('profiles')
    .select('assinatura_versao')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !data) return VERSAO_COMPLETA;
  return normalizarVersao(data.assinatura_versao);
}

export function normalizarVersao(valor) {
  return valor === VERSAO_AGENDA ? VERSAO_AGENDA : VERSAO_COMPLETA;
}

export function temArquivo(versao) {
  return normalizarVersao(versao) === VERSAO_COMPLETA;
}

export async function arquivoLiberado() {
  return temArquivo(await getVersaoDaConta());
}
