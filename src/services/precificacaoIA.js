// Precificação DeepSeek V4-Flash usada só pra estimar o orçamento ANTES de
// chamar a IA — espelha supabase/functions/_shared/precificacaoDeepSeek.ts
// (o custo real é calculado lá, no momento exato da resposta; o app não
// pode importar um módulo Deno, por isso a duplicação). Se um mudar, o
// outro precisa mudar junto.
//
// Preços verificados em api-docs.deepseek.com/quick_start/pricing em
// 23/08/2026 — a DeepSeek trocou o modelo de preço em 16/08/2026: hoje
// existe pico (mais caro) e fora de pico. Reconferir esta página se a
// DeepSeek anunciar nova mudança.
const PRECO_INPUT_MISS_OFFPEAK_POR_1M = 0.22;
const PRECO_INPUT_HIT_OFFPEAK_POR_1M = 0.007;
const PRECO_OUTPUT_OFFPEAK_POR_1M = 0.66;

const PRECO_INPUT_MISS_PEAK_POR_1M = 0.44;
const PRECO_INPUT_HIT_PEAK_POR_1M = 0.014;
const PRECO_OUTPUT_PEAK_POR_1M = 1.32;

// Multiplicador de cobrança sobre o custo real — espelha
// supabase/functions/_shared/margemCobranca.ts. O usuário paga sempre o
// dobro do custo real pago à DeepSeek; a estimativa mostrada antes de
// gerar já reflete esse valor (nunca o custo "nu" da IA).
const MULTIPLICADOR_COBRANCA_USUARIO = 2;

// Pico: 01:00-04:00 e 06:00-10:00 UTC, segunda a sexta (preço 2x).
export function ehHorarioDePico(data = new Date()) {
  const dia = data.getUTCDay();
  if (dia === 0 || dia === 6) return false;
  const hora = data.getUTCHours();
  return (hora >= 1 && hora < 4) || (hora >= 6 && hora < 10);
}

/** Preço de entrada (cache miss) já cobrado do usuário, por 1M tokens, no
 * horário atual. Usado só pra estimativa pré-chamada — o custo real vem
 * da Edge Function. */
export function precoInputPor1M(data = new Date()) {
  const base = ehHorarioDePico(data) ? PRECO_INPUT_MISS_PEAK_POR_1M : PRECO_INPUT_MISS_OFFPEAK_POR_1M;
  return base * MULTIPLICADOR_COBRANCA_USUARIO;
}

/** Preço de saída já cobrado do usuário, por 1M tokens, no horário atual. */
export function precoOutputPor1M(data = new Date()) {
  const base = ehHorarioDePico(data) ? PRECO_OUTPUT_PEAK_POR_1M : PRECO_OUTPUT_OFFPEAK_POR_1M;
  return base * MULTIPLICADOR_COBRANCA_USUARIO;
}
