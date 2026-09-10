// ─── Programa de indicações ─────────────────────────────────────────────
//
// Cada indicado ativo dá 10% de desconto na assinatura de quem indicou.
// Dez indicados zeram a mensalidade.
//
// Nada aqui decide nada: a regra mora no banco (`desconto_por_indicacoes`)
// e o valor cobrado é ajustado no Mercado Pago pelo servidor. Esta tela só
// mostra — e mostra exatamente o número que está sendo cobrado, não uma
// conta feita de novo no app. Duas contas separadas é como elas divergem.
import { supabase } from './supabase';

export const MAXIMO_INDICADOS = 10;
export const DESCONTO_POR_INDICADO = 10;

/**
 * O estado do programa para esta conta.
 *
 * `null` quando não deu para consultar — a tela não afirma nada nesse
 * caso, em vez de mostrar "0 indicações" para quem tem cinco.
 */
export async function getResumoIndicacoes() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const [{ data: perfil }, { data: ativos }] = await Promise.all([
      supabase
        .from('profiles')
        .select('codigo_indicacao, elegivel_indicacao, indicacao_desconto_percentual, assinatura_status')
        .eq('id', session.user.id)
        .maybeSingle(),
      supabase.rpc('indicados_ativos', { uid: session.user.id }),
    ]);
    if (!perfil) return null;

    const indicadosAtivos = Number(ativos) || 0;
    return {
      codigo: perfil.codigo_indicacao || null,
      elegivel: !!perfil.elegivel_indicacao,
      indicadosAtivos,
      // O desconto que ESTÁ VALENDO na cobrança, vindo do servidor. Se a
      // pessoa tem 3 indicados mas o Mercado Pago ainda não foi ajustado,
      // é honesto mostrar o que ela paga hoje.
      descontoVigente: Number(perfil.indicacao_desconto_percentual) || 0,
      gratuita: perfil.assinatura_status === 'gratuita_indicacao',
      faltamParaGratis: Math.max(MAXIMO_INDICADOS - indicadosAtivos, 0),
    };
  } catch (_) {
    return null;
  }
}

/** O texto que a pessoa manda para quem quer indicar. */
export function convite(codigo) {
  return (
    'Uso o Dr.Sig para organizar meu consultório — agenda, registros de sessão, ' +
    'transcrição e cobrança no mesmo lugar.\n\n' +
    `Se quiser experimentar, use meu código de indicação no cadastro: ${codigo}\n\n` +
    'https://drsig.com.br'
  );
}
