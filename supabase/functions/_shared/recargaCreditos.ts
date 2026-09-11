// ─── Recarga avulsa de crédito de IA ───────────────────────────────────
//
// Dois caminhos creditam uma recarga: a própria página de pagamento, no
// instante em que o Mercado Pago aprova (a pessoa está olhando para a
// tela), e o webhook, segundos depois, com o mesmo pagamento — e mais de
// uma vez, porque `payment.created` e `payment.updated` chegam separados.
//
// Por isso a regra mora aqui, num lugar só: o pagamento entra em
// `recargas_creditos` (chave pelo id do pagamento) ANTES de somar no
// saldo; quem chega depois encontra a chave ocupada e não soma de novo.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ajustarCreditoIA } from './creditoIA.ts';
import { TAXA_REFERENCIA_USD_BRL } from './creditoDoPlano.ts';

type Cliente = ReturnType<typeof createClient>;

export const MP_API = 'https://api.mercadopago.com';

/** Pacotes vendidos. Fechado de propósito: nada de valor livre vindo do cliente. */
export const PACOTES_BRL = [20, 50, 100];

export const PREFIXO_REFERENCIA = 'creditos:';

export type PagamentoMercadoPago = {
  id: number | string;
  status?: string;
  transaction_amount?: number;
  external_reference?: string;
  payment_method_id?: string;
  payer?: { email?: string };
};

export type ResultadoRecarga =
  | { creditado: true; userId: string; creditoUsd: number; saldo: number | null }
  | { creditado: false; motivo: 'nao_aprovado' | 'sem_referencia' | 'ja_creditado' | 'conta_inexistente'; userId?: string };

export function userIdDaReferencia(referencia: string): string | null {
  if (!referencia.startsWith(PREFIXO_REFERENCIA)) return null;
  const userId = referencia.slice(PREFIXO_REFERENCIA.length).trim();
  return userId || null;
}

/**
 * Credita um pagamento de recarga uma única vez.
 *
 * Idempotente: pode ser chamada por todo caminho que fique sabendo do
 * pagamento, quantas vezes for. Só a primeira chamada com um pagamento
 * aprovado soma no saldo.
 */
export async function creditarRecarga(admin: Cliente, pagamento: PagamentoMercadoPago): Promise<ResultadoRecarga> {
  if (pagamento.status !== 'approved') return { creditado: false, motivo: 'nao_aprovado' };

  const userId = userIdDaReferencia(String(pagamento.external_reference || ''));
  if (!userId) return { creditado: false, motivo: 'sem_referencia' };

  const valorBrl = Number(pagamento.transaction_amount) || 0;
  const creditoUsd = valorBrl / TAXA_REFERENCIA_USD_BRL;

  // A chave é o pagamento. `insert` sem `upsert`: se já existe, o erro de
  // chave duplicada (23505) é exatamente a resposta que se quer.
  const { error: erroChave } = await admin.from('recargas_creditos').insert({
    mp_payment_id: String(pagamento.id),
    user_id: userId,
    valor_brl: valorBrl,
    credito_usd: creditoUsd,
    meio: String(pagamento.payment_method_id || 'desconhecido'),
  });
  if (erroChave) {
    if (erroChave.code === '23505') return { creditado: false, motivo: 'ja_creditado', userId };
    // FK para auth.users falhou: a conta foi excluída depois de pagar.
    if (erroChave.code === '23503') return { creditado: false, motivo: 'conta_inexistente', userId };
    throw new Error(`Não foi possível registrar a recarga: ${erroChave.message}`);
  }

  const saldo = await ajustarCreditoIA(admin, userId, creditoUsd);

  await admin.from('uso_ia').insert({
    user_id: userId,
    tipo: 'recarga_avulsa',
    provedor: 'sistema',
    modelo: `recarga_${pagamento.payment_method_id || 'mercadopago'}`,
    unidades: null,
    custo_estimado: -creditoUsd,
  });

  return { creditado: true, userId, creditoUsd, saldo };
}
