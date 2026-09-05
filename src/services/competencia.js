// A qual mês uma cobrança se refere, e em que dia ela vence.
//
// Cobrança mensal VARIÁVEL cobre as sessões já feitas. Quem recebe no
// começo do mês está cobrando o mês anterior, que fechou; quem recebe no
// último dia — ou no dia da última sessão — está cobrando o mês corrente,
// que acabou de terminar. Até 05/09/2026 o app somava sempre as sessões do
// MESMO mês da cobrança, então para a maioria dos analisantes o valor
// exibido era o do mês errado.
//
// Cobrança por sessão não tem esse deslocamento: paga-se no ato ou poucos
// dias depois, sessão a sessão.

/** Modos de dia de pagamento oferecidos na ficha. `mesAnterior` diz se a
 *  cobrança daquele modo se refere ao mês fechado ou ao mês corrente. */
export const MODOS_DIA_PAGAMENTO = [
  { id: 'dia_fixo', label: 'Dia fixo do mês', mesAnterior: true },
  { id: 'quinto_dia_util', label: 'Quinto dia útil do mês', mesAnterior: true },
  { id: 'ultima_sessao', label: 'Dia da última sessão do mês', mesAnterior: false },
  { id: 'ultimo_dia', label: 'Último dia do mês', mesAnterior: false },
];

/** Atalhos oferecidos no formulário para o modo de dia fixo. */
export const DIAS_FIXOS_SUGERIDOS = [1, 5, 10];

function modo(id) {
  return MODOS_DIA_PAGAMENTO.find((m) => m.id === id) || MODOS_DIA_PAGAMENTO[0];
}

/**
 * Mês cujas sessões aquela cobrança cobre.
 *
 * Recebe o mês em que o pagamento ACONTECE e devolve `{ ano, mes }` do mês
 * de competência — o mês das sessões que estão sendo pagas.
 *
 * Só vale para cobrança mensal (fixa ou variável). Por sessão não desloca:
 * cada sessão é cobrada por si.
 */
export function mesDeCompetencia(ano, mesIndex, diaPagamentoModo) {
  if (!modo(diaPagamentoModo).mesAnterior) return { ano, mes: mesIndex };
  return mesIndex === 0 ? { ano: ano - 1, mes: 11 } : { ano, mes: mesIndex - 1 };
}

/** O inverso: dado um mês de sessões, em que mês ele será cobrado. Usado
 *  para responder "quanto entra neste mês" a partir do que foi atendido. */
export function mesDeCobranca(ano, mesIndex, diaPagamentoModo) {
  if (!modo(diaPagamentoModo).mesAnterior) return { ano, mes: mesIndex };
  return mesIndex === 11 ? { ano: ano + 1, mes: 0 } : { ano, mes: mesIndex + 1 };
}

function ultimoDiaDoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

/** Quinto dia ÚTIL: conta de segunda a sexta, ignorando fins de semana.
 *  Feriado não entra — o app não tem calendário de feriados, e chutar um
 *  seria pior que assumir dia útil. */
function quintoDiaUtil(ano, mesIndex) {
  let uteis = 0;
  const ultimo = ultimoDiaDoMes(ano, mesIndex);
  for (let dia = 1; dia <= ultimo; dia += 1) {
    const semana = new Date(ano, mesIndex, dia).getDay();
    if (semana !== 0 && semana !== 6) uteis += 1;
    if (uteis === 5) return dia;
  }
  return ultimo;
}

/**
 * Em que dia daquele mês a cobrança vence.
 *
 * `dataUltimaSessao` (ISO) só é usada no modo 'ultima_sessao'; sem ela —
 * mês sem sessão nenhuma —, cai no último dia do mês, que é o mais próximo
 * do que aquele modo significa.
 *
 * Dia fixo maior que o tamanho do mês cai no último dia real: dia 31 em
 * abril vence dia 30, nunca desaparece.
 */
export function diaDeVencimento(ano, mesIndex, { diaPagamento, diaPagamentoModo, dataUltimaSessao } = {}) {
  const ultimo = ultimoDiaDoMes(ano, mesIndex);
  switch (modo(diaPagamentoModo).id) {
    case 'ultimo_dia':
      return ultimo;
    case 'quinto_dia_util':
      return quintoDiaUtil(ano, mesIndex);
    case 'ultima_sessao': {
      if (!dataUltimaSessao) return ultimo;
      const dia = Number(String(dataUltimaSessao).split('-')[2]);
      return Number.isFinite(dia) ? Math.min(dia, ultimo) : ultimo;
    }
    default:
      return diaPagamento ? Math.min(Number(diaPagamento), ultimo) : ultimo;
  }
}

/** Rótulo curto pra tela dizer a que mês a cobrança se refere. */
export function rotuloCompetencia(diaPagamentoModo) {
  return modo(diaPagamentoModo).mesAnterior ? 'mês anterior' : 'mês corrente';
}

// ── Sessões que entram na conta ──────────────────────────────────────────
// Cobrança mensal variável soma o que foi ATENDIDO, não o que estava na
// grade. As regras, que valem igual para os dois lados (previsão e valor
// cobrado):
//   realizado     -> cobra
//   nao_realizado -> cobra (falta do analisante não desobriga)
//   cancelado     -> NÃO cobra
//   agendado      -> ainda conta como previsto: a sessão está de pé até
//                    alguém dizer o contrário. Vira cobrança ou some
//                    conforme for confirmada.
export const STATUS_COBRAVEIS = ['realizado', 'nao_realizado'];
export const STATUS_PREVISTOS = ['realizado', 'nao_realizado', 'agendado'];

export function sessaoEhCobravel(status) {
  return STATUS_COBRAVEIS.includes(status);
}

export function sessaoContaComoPrevista(status) {
  return STATUS_PREVISTOS.includes(status);
}
