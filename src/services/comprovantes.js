// Conferência de comprovante recebido por WhatsApp contra o que era
// esperado no Recebíveis.
//
// A leitura por OCR erra: valor cortado, vírgula perdida, número de outra
// linha do recibo. Por isso o app NUNCA marca pagamento sozinho — o que
// estas funções fazem é dizer o quanto bate, para a profissional decidir
// com a informação na frente em vez de no escuro.

/** Diferença tolerada entre o valor lido e o previsto para considerar que
 *  "bate". Um centavo de diferença é arredondamento, não outro pagamento. */
const TOLERANCIA_REAIS = 0.02;

/**
 * Compara o valor lido no comprovante com o previsto para aquele
 * analisante no mês.
 *
 * Devolve um dos três casos, porque as saídas na tela são diferentes:
 *  - 'confere'    -> valor bate; confirmar é seguro
 *  - 'divergente' -> leu um valor, mas não é o esperado (pagamento parcial,
 *                    mês errado, ou OCR errado) — mostra os dois números
 *  - 'sem_valor'  -> não deu pra ler valor nenhum; só a pessoa decide
 */
export function compararValores(valorDetectado, valorPrevisto) {
  const lido = Number(valorDetectado);
  const previsto = Number(valorPrevisto);
  if (!Number.isFinite(lido) || lido <= 0) return 'sem_valor';
  if (!Number.isFinite(previsto) || previsto <= 0) return 'sem_valor';
  return Math.abs(lido - previsto) <= TOLERANCIA_REAIS ? 'confere' : 'divergente';
}

/**
 * Junta o comprovante com a linha de recebimento do mês que está sendo
 * visto na tela, para a profissional ver de uma vez: de quem é, quanto o
 * OCR leu, quanto era esperado, e se aquele mês já está quitado.
 *
 * Comprovante sem analisante identificado (telefone que não bate com
 * nenhuma ficha) fica na lista assim mesmo, marcado — some-lo seria pior:
 * a pessoa mandou o comprovante e ninguém veria.
 */
export function cruzarComprovantesComRecebimentos(comprovantes, recebimentos) {
  return (comprovantes || []).map((c) => {
    const recebimento = (recebimentos || []).find((r) => r.patient_id === c.patient_id) || null;
    return {
      ...c,
      recebimento,
      valorPrevisto: recebimento?.valorPrevisto ?? null,
      jaRecebido: !!recebimento?.recebido,
      conferencia: compararValores(c.valor_detectado, recebimento?.valorPrevisto),
    };
  });
}

/** Texto curto do resultado da conferência, pra tela não repetir lógica. */
export function rotuloConferencia(item) {
  if (!item.patient_id) return 'Analisante não identificado';
  if (item.jaRecebido) return 'Este mês já está marcado como recebido';
  if (item.conferencia === 'confere') return 'Valor confere com o previsto';
  if (item.conferencia === 'divergente') return 'Valor diferente do previsto';
  return 'Não foi possível ler o valor';
}
