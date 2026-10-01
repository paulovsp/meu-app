// Precificação DeepSeek V4-Flash usada só pra estimar o orçamento ANTES de
// chamar a IA — espelha supabase/functions/_shared/precificacaoDeepSeek.ts
// (o custo real é calculado lá, no momento exato da resposta; o app não
// pode importar um módulo Deno, por isso a duplicação). Se um mudar, o
// outro precisa mudar junto.
//
// Preços reconferidos em api-docs.deepseek.com/quick_start/pricing em
// 01/10/2026 — os nomes antigos `deepseek-v4-flash` e
// `deepseek-v4-flash-vision-exp` foram aposentados e passaram a ser
// servidos pelo modelo DeepSeek-V4.1-Flash, faturado na tabela "Flash"
// atual — mais barata do que os valores anteriores ($0.22 / $0.007 /
// $0.66), vigentes desde a checagem de 23/08/2026. Reconferir esta página
// se a DeepSeek anunciar nova mudança.
const PRECO_INPUT_MISS_OFFPEAK_POR_1M = 0.15;
const PRECO_INPUT_HIT_OFFPEAK_POR_1M = 0.003;
const PRECO_OUTPUT_OFFPEAK_POR_1M = 0.6;

const PRECO_INPUT_MISS_PEAK_POR_1M = 0.3;
const PRECO_INPUT_HIT_PEAK_POR_1M = 0.006;
const PRECO_OUTPUT_PEAK_POR_1M = 1.2;

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
