// Férias do analista (tabela `ferias`, migration 0115): enquanto durarem,
// o Dr.Sig não manda nenhum aviso — nem e-mail de resumo, nem push.
// Pedido do Paulo, 26/11/2026.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** "AAAA-MM-DD" de hoje no horário de Brasília (o cron roda em UTC). */
export function hojeEmBrasilia(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Ids das contas cujo analista está de férias hoje. Uma consulta só para
 *  todas as contas; com erro, devolve vazio (melhor avisar do que calar
 *  sem querer). */
export async function contasDeFeriasHoje(admin: SupabaseClient, hoje = hojeEmBrasilia()): Promise<Set<string>> {
  const { data, error } = await admin
    .from('ferias')
    .select('user_id')
    .eq('tipo', 'analista')
    .lte('data_inicio', hoje)
    .gte('data_fim', hoje);
  if (error) {
    console.warn('[ferias] leitura falhou', error.message);
    return new Set();
  }
  return new Set((data || []).map((f: { user_id: string }) => f.user_id));
}
