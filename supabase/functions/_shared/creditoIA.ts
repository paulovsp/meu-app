// ─── Débito e crédito do saldo de IA, numa instrução só ────────────────
//
// Quem soma é o banco (`ajustar_credito_ia`, migration 0100), não este
// código. Ler o saldo, somar em JavaScript e gravar de volta perdia
// débitos quando duas chamadas terminavam juntas — dois blocos da mesma
// gravação, por exemplo — porque a segunda gravava por cima da primeira.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Cliente = ReturnType<typeof createClient>;

/**
 * Soma `delta` ao saldo (negativo debita) e devolve o saldo resultante —
 * ou `null` se a conta não existe mais.
 */
export async function ajustarCreditoIA(admin: Cliente, userId: string, delta: number): Promise<number | null> {
  const { data, error } = await admin.rpc('ajustar_credito_ia', { uid: userId, delta });
  if (error) throw new Error(`Não foi possível ajustar o crédito de IA: ${error.message}`);
  return data == null ? null : Number(data);
}
