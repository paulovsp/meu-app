import { MULTIPLICADOR_COBRANCA_USUARIO } from './margemCobranca.ts';

// Precificação de transcrição de áudio (AssemblyAI) — fonte única, usada por
// ia-transcrever-webhook e curso-transcrever-webhook. Antes cada um tinha sua
// própria constante `PRECO_POR_HORA_USD = 0.21`, mantidas em sincronia à mão
// (risco real de dessincronizar); e nenhuma das duas incluía o add-on de
// diarização (`speaker_labels: true`, que os dois pedem).
//
// Preços verificados em assemblyai.com/pricing em 15/08/2026: Universal-3.5
// Pro pré-gravado = US$0,21/h; diarização (speaker labels) padrão para
// pré-gravado = +US$0,02/h, cobrada à parte, não inclusa no preço-base.
// Reconferir esta página se a AssemblyAI anunciar mudança de preço.
export const PRECO_BASE_USD_HORA = 0.21;
export const PRECO_DIARIZACAO_USD_HORA = 0.02;

/** Valor debitado de `creditos_ia` do usuário para `segundos` de áudio
 * transcrito — sempre o dobro do custo real pago à AssemblyAI. */
export function calcularCobrancaIA(segundos: number): number {
  const horas = segundos / 3600;
  return horas * (PRECO_BASE_USD_HORA + PRECO_DIARIZACAO_USD_HORA) * MULTIPLICADOR_COBRANCA_USUARIO;
}
