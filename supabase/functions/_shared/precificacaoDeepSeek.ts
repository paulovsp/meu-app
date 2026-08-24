// Precificação DeepSeek V4-Flash — fonte única, usada por ia-busca (custo
// real, calculado no momento exato da resposta da IA). Espelhada em
// src/services/precificacaoIA.js pro app conseguir estimar o orçamento
// ANTES de chamar a IA (mesma lógica de pico/fora de pico, já que o app
// não pode importar um módulo Deno).
//
// Preços verificados em api-docs.deepseek.com/quick_start/pricing em
// 23/08/2026 — a DeepSeek trocou o modelo de preço em 16/08/2026: hoje
// existe pico (mais caro) e fora de pico, e os valores hardcoded antigos
// ($0.14 / $0.0028 / $0.28) ficaram desatualizados desde então. Reconferir
// esta página se a DeepSeek anunciar nova mudança.
export const PRECO_INPUT_MISS_OFFPEAK_POR_1M = 0.22;
export const PRECO_INPUT_HIT_OFFPEAK_POR_1M = 0.007;
export const PRECO_OUTPUT_OFFPEAK_POR_1M = 0.66;

export const PRECO_INPUT_MISS_PEAK_POR_1M = 0.44;
export const PRECO_INPUT_HIT_PEAK_POR_1M = 0.014;
export const PRECO_OUTPUT_PEAK_POR_1M = 1.32;

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
