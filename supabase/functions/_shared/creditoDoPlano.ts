// ─── Crédito de IA que cada plano dá de brinde ────────────────────────
//
// Cresce com a duração do compromisso: é o prêmio de fidelidade, e o site
// diz isso com essas palavras. Estes números são promessa comercial, não
// configuração interna — mudar aqui obriga a mudar o texto do site e do
// app junto.
//
// Ficam num módulo só porque duas funções precisam do mesmo número: o
// webhook, que credita o primeiro mês quando o pagamento entra, e
// renovar-creditos, que credita os meses seguintes. Já esteve duplicado, e
// os dois lados divergiram — 20/30/40 num, o valor pago inteiro no outro.
export const CREDITO_MENSAL_BRL: Record<string, number> = {
  mensal: 5,
  semestral: 7,
  anual: 10,
};

// Cotação de referência FIXA. O saldo interno é em dólar; o brinde é
// anunciado em real. Não busca cotação ao vivo de propósito: o valor
// prometido na página de vendas não pode variar com o câmbio do dia.
export const TAXA_REFERENCIA_USD_BRL = 5.08;

/** Brinde mensal do plano, já convertido pro saldo interno (US$). */
export function creditoMensalUsd(plano: string | null | undefined): number | null {
  if (!plano) return null;
  const brl = CREDITO_MENSAL_BRL[plano];
  return brl == null ? null : brl / TAXA_REFERENCIA_USD_BRL;
}
