// ─── O "não" do Mercado Pago, em português ─────────────────────────────
//
// Quando um cartão é recusado, a API devolve um código (`cc_rejected_…`)
// no `status_detail` ou em `cause[].code`. É o mesmo vocabulário na
// assinatura (preapproval) e no pagamento avulso (recarga de créditos), e
// a pessoa na frente da tela precisa do mesmo texto nos dois casos.
const MENSAGENS: Record<string, string> = {
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
  cc_rejected_bad_filled_date: 'Confira a validade do cartão.',
  cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV).',
  cc_rejected_bad_filled_other: 'Algum dado do cartão não confere. Confira e tente de novo.',
  cc_rejected_insufficient_amount: 'O cartão não tem limite disponível para este valor.',
  cc_rejected_high_risk: 'O banco não autorizou esta cobrança. Tente outro cartão, ou fale com o banco.',
  cc_rejected_call_for_authorize: 'O banco pediu que você autorize esta cobrança. Ligue para o banco e tente de novo.',
  cc_rejected_card_disabled: 'O cartão está desativado. Fale com o banco ou use outro.',
  cc_rejected_duplicated_payment: 'Esta cobrança já foi feita. Confira antes de tentar de novo.',
  cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Espere um pouco ou use outro.',
  cc_rejected_other_reason: 'O banco não autorizou. Tente outro cartão.',
  cc_rejected_card_type_not_allowed: 'Este tipo de cartão não é aceito. Use um cartão de crédito.',
  cc_rejected_blacklist: 'O banco não autorizou esta cobrança. Tente outro cartão.',
};

/** `corpo` é a resposta do Mercado Pago (erro HTTP ou pagamento recusado). */
export function mensagemDeRecusa(corpo: Record<string, unknown> | null | undefined): string {
  const causa = String(
    (corpo?.cause as Array<{ code?: string }> | undefined)?.[0]?.code
      ?? corpo?.status_detail
      ?? corpo?.error
      ?? '',
  );
  if (MENSAGENS[causa]) return MENSAGENS[causa];
  if (causa.includes('card_token')) {
    return 'Os dados do cartão expiraram nesta página. Preencha de novo.';
  }
  return 'Não foi possível autorizar o cartão. Confira os dados ou tente outro cartão.';
}
