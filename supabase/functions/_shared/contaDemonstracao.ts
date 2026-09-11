// ─── A conta de demonstração não gasta IA ──────────────────────────────
//
// O login dela é público: a senha está na tela de entrada. O banco já
// recusa toda escrita dessa conta (migration 0097), mas as funções de IA
// não escrevem nada em nome dela — elas gastam. Busca, relatório e
// transcrição saem do crédito da conta, que é dinheiro do dono, pago à
// DeepSeek e à AssemblyAI. Sem esta checagem, qualquer visitante rodava
// tudo até zerar.
//
// A checagem fica ANTES do gasto, em cada função que gasta, e devolve o
// mesmo motivo que o app já reconhece.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Cliente = ReturnType<typeof createClient>;

export const MOTIVO_DEMONSTRACAO = 'demonstracao';

/** `true` quando a conta é a de demonstração — e portanto não pode gastar. */
export async function ehContaDemonstracao(admin: Cliente, userId: string): Promise<boolean> {
  const { data } = await admin
    .from('profiles')
    .select('conta_demonstracao')
    .eq('id', userId)
    .maybeSingle();
  return data?.conta_demonstracao === true;
}

export function respostaDemonstracao(): Response {
  return new Response(
    JSON.stringify({
      error: 'A conta de demonstração não usa os recursos de IA. Para transcrever, gerar relatórios e usar a Busca Dr.Sig, crie a sua conta.',
      demonstracao: true,
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
