// Precificação DeepSeek V4-Flash — fonte única, usada por ia-busca (custo
// real, calculado no momento exato da resposta da IA). Espelhada em
// src/services/precificacaoIA.js pro app conseguir estimar o orçamento
// ANTES de chamar a IA (mesma lógica de pico/fora de pico, já que o app
// não pode importar um módulo Deno).
//
// Preços reconferidos em api-docs.deepseek.com/quick_start/pricing em
// 01/10/2026 — os nomes antigos `deepseek-v4-flash` e
// `deepseek-v4-flash-vision-exp` (ainda aceitos pela API, é o que
// `ia-busca/index.ts` chama) foram aposentados e passaram a ser servidos
// pelo modelo DeepSeek-V4.1-Flash, faturado na tabela "Flash" atual — mais
// barata do que os valores anteriores ($0.22 / $0.007 / $0.66), vigentes
// desde a checagem de 23/08/2026. Reconferir esta página se a DeepSeek
// anunciar nova mudança.
export const PRECO_INPUT_MISS_OFFPEAK_POR_1M = 0.15;
export const PRECO_INPUT_HIT_OFFPEAK_POR_1M = 0.003;
export const PRECO_OUTPUT_OFFPEAK_POR_1M = 0.6;

export const PRECO_INPUT_MISS_PEAK_POR_1M = 0.3;
export const PRECO_INPUT_HIT_PEAK_POR_1M = 0.006;
export const PRECO_OUTPUT_PEAK_POR_1M = 1.2;

// Pico: 01:00-04:00 e 06:00-10:00 UTC, segunda a sexta (preço 2x).
export function ehHorarioDePico(data: Date = new Date()): boolean {
  const dia = data.getUTCDay();
  if (dia === 0 || dia === 6) return false;
  const hora = data.getUTCHours();
  return (hora >= 1 && hora < 4) || (hora >= 6 && hora < 10);
}

export function precosAtuais(data: Date = new Date()) {
  const pico = ehHorarioDePico(data);
  return {
    inputMiss: pico ? PRECO_INPUT_MISS_PEAK_POR_1M : PRECO_INPUT_MISS_OFFPEAK_POR_1M,
    inputHit: pico ? PRECO_INPUT_HIT_PEAK_POR_1M : PRECO_INPUT_HIT_OFFPEAK_POR_1M,
    output: pico ? PRECO_OUTPUT_PEAK_POR_1M : PRECO_OUTPUT_OFFPEAK_POR_1M,
    pico,
  };
}
