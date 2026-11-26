// ─── Férias (do analista e de cada analisante/supervisionando) ──────────
//
// Dois jeitos de sair de férias, guardados na tabela `ferias` (migration
// 0115):
//   • do ANALISTA (tipo 'analista'): o consultório inteiro para no período.
//     Quem paga e quem não paga é escolhido cliente por cliente
//     (`ferias_pacientes`); quem não estiver na lista — alguém cadastrado
//     depois, por exemplo — segue o padrão da própria férias (`paga`).
//     "Pagas" = todos pagam; "não pagas" = ninguém paga; "parcialmente
//     pagas" = alguns pagam.
//   • de um CLIENTE (tipo 'cliente'): só os horários daquela pessoa param,
//     e a férias inteira é paga ou não paga.
//
// Na agenda, cada sessão que cai nas férias vira um compromisso com status
// 'ferias' (não pergunta "a sessão aconteceu?" e não conta como falta). No
// financeiro, sessão de férias PAGA é cobrada como se tivesse acontecido;
// NÃO PAGA sai da conta, como um cancelamento.
//
// Este arquivo é só lógica pura (sem banco), pra ser testável. Quem lê e
// grava as férias fica em database.js, seção "Férias".

import { sessaoEhCobravel, sessaoContaComoPrevista } from './competencia';

export const STATUS_FERIAS = 'ferias';

// Limite de um período, pra ninguém criar férias de dez anos por engano
// de digitação (e porque cada dia do período vira compromisso na agenda).
export const MAX_DIAS_FERIAS = 180;

function cobre(f, dataISO) {
  return !!f && !!dataISO && f.data_inicio <= dataISO && dataISO <= f.data_fim;
}

/** Férias do analista que cobrem a data (ou null). */
export function feriasDoAnalistaNaData(ferias, dataISO) {
  return (ferias || []).find((f) => f.tipo === 'analista' && cobre(f, dataISO)) || null;
}

/** Férias do próprio cliente que cobrem a data (ou null). */
export function feriasDoClienteNaData(ferias, patientId, dataISO) {
  if (!patientId) return null;
  return (ferias || []).find((f) => f.tipo === 'cliente' && f.patient_id === patientId && cobre(f, dataISO)) || null;
}

/** Quem paga nas férias do analista: a escolha feita para a pessoa ou, se
 * ela não estava na lista, o padrão daquela férias. */
export function pagaNasFeriasDoAnalista(registro, patientId) {
  const escolha = (registro?.pacientes || []).find((p) => p.patient_id === patientId);
  if (escolha) return !!escolha.paga;
  return !!registro?.paga;
}

/**
 * Situação de férias de uma pessoa numa data:
 *   null                                   -> não está de férias
 *   { feriasId, tipo: 'analista'|'cliente', paga }
 * Férias do analista vêm antes: se o consultório está parado, vale o que
 * o analista combinou com aquela pessoa, mesmo que ela também tenha
 * marcado férias próprias no mesmo dia.
 */
export function feriasNaData(ferias, patientId, dataISO) {
  const doAnalista = feriasDoAnalistaNaData(ferias, dataISO);
  if (doAnalista) {
    return { feriasId: doAnalista.id, tipo: 'analista', paga: patientId ? pagaNasFeriasDoAnalista(doAnalista, patientId) : false };
  }
  const doCliente = feriasDoClienteNaData(ferias, patientId, dataISO);
  if (doCliente) return { feriasId: doCliente.id, tipo: 'cliente', paga: !!doCliente.paga };
  return null;
}

/** O compromisso que nasce deste horário nesta data fica em férias? Nas
 * férias do analista, tudo para (sessões, grupos, "outros"). Nas férias de
 * um cliente, só o horário individual dele — o grupo continua acontecendo
 * para os outros participantes (a cobrança da pessoa é tratada à parte). */
export function horarioFicaEmFerias(slot, dataISO, ferias) {
  if (feriasDoAnalistaNaData(ferias, dataISO)) return true;
  if (!slot?.patient_id) return false;
  const tipo = slot.tipo || 'sessao_individual';
  if (tipo !== 'sessao_individual' && tipo !== 'supervisao_individual') return false;
  return !!feriasDoClienteNaData(ferias, slot.patient_id, dataISO);
}

/**
 * A sessão entra na COBRANÇA? Mesma régua de competencia.js
 * (realizado/falta cobram, cancelado não), com as férias por cima:
 *   • compromisso em férias: cobra só se as férias são pagas para a pessoa;
 *   • participante de grupo de férias (o grupo seguiu sem ele): idem.
 */
export function sessaoCobravelComFerias({ status, patientId, date, emGrupo = false }, ferias) {
  if (status === STATUS_FERIAS) return !!feriasNaData(ferias, patientId, date)?.paga;
  if (emGrupo && status !== 'cancelado') {
    const situacao = feriasNaData(ferias, patientId, date);
    if (situacao) return situacao.paga;
  }
  return sessaoEhCobravel(status);
}

/** A sessão conta como PREVISTA (o que se espera receber no mês)? Igual à
 * cobrança, mas 'agendado' também conta (ver competencia.js). */
export function sessaoPrevistaComFerias({ status, patientId, date, emGrupo = false }, ferias) {
  if (status === STATUS_FERIAS) return !!feriasNaData(ferias, patientId, date)?.paga;
  if (emGrupo && status !== 'cancelado') {
    const situacao = feriasNaData(ferias, patientId, date);
    if (situacao) return situacao.paga;
  }
  return sessaoContaComoPrevista(status);
}

/** Uma ocorrência futura do horário fixo (ainda sem compromisso) conta no
 * previsto? Fora das férias, sim; dentro, só se forem pagas. */
export function ocorrenciaContaComFerias(patientId, dataISO, ferias) {
  const situacao = feriasNaData(ferias, patientId, dataISO);
  return !situacao || situacao.paga;
}

/** "AAAA-MM-DD" -> número de dias entre duas datas (inclusive). */
export function diasNoPeriodo(inicioISO, fimISO) {
  const [a1, m1, d1] = inicioISO.split('-').map(Number);
  const [a2, m2, d2] = fimISO.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000) + 1;
}

/** Datas ISO de um período, inclusive. */
export function datasDoPeriodo(inicioISO, fimISO) {
  const [a, m, d] = inicioISO.split('-').map(Number);
  const total = diasNoPeriodo(inicioISO, fimISO);
  const datas = [];
  for (let i = 0; i < total; i += 1) {
    const dt = new Date(Date.UTC(a, m - 1, d + i));
    datas.push(dt.toISOString().slice(0, 10));
  }
  return datas;
}

/**
 * Confere uma férias antes de gravar. Devolve a mensagem do problema, ou
 * null se está tudo certo. Não deixa dois períodos se sobreporem do mesmo
 * jeito (duas férias do analista, ou duas do mesmo cliente) — senão a
 * pergunta "paga ou não paga?" teria duas respostas no mesmo dia.
 */
export function validarFerias(nova, existentes = []) {
  if (!nova?.data_inicio || !nova?.data_fim) return 'Informe o início e o fim das férias.';
  if (nova.data_fim < nova.data_inicio) return 'O fim das férias não pode ser antes do início.';
  if (diasNoPeriodo(nova.data_inicio, nova.data_fim) > MAX_DIAS_FERIAS) {
    return `O período passa de ${MAX_DIAS_FERIAS} dias. Confira as datas.`;
  }
  if (nova.tipo === 'cliente' && !nova.patient_id) return 'Escolha de quem são as férias.';
  const conflito = (existentes || []).find((f) => (
    f.id !== nova.id
    && f.tipo === nova.tipo
    && (nova.tipo === 'analista' || f.patient_id === nova.patient_id)
    && f.data_inicio <= nova.data_fim
    && nova.data_inicio <= f.data_fim
  ));
  if (conflito) {
    return `Já existem férias de ${formatarPeriodoFerias(conflito.data_inicio, conflito.data_fim)} que se sobrepõem a este período.`;
  }
  return null;
}

/** Como as férias do analista ficaram para o conjunto de clientes. */
export function resumoPagamentoFerias(registro) {
  if (registro?.tipo === 'cliente') return registro.paga ? 'Paga' : 'Não paga';
  const lista = registro?.pacientes || [];
  if (lista.length === 0) return registro?.paga ? 'Pagas' : 'Não pagas';
  const pagantes = lista.filter((p) => p.paga).length;
  if (pagantes === lista.length) return 'Pagas';
  if (pagantes === 0) return 'Não pagas';
  return `Parcialmente pagas (${pagantes} de ${lista.length} pagam)`;
}

function dataCurta(iso) {
  const [, m, d] = String(iso).split('-');
  return `${d}/${m}`;
}

/** "02/01 a 31/01" — e com o ano quando o período atravessa o ano. */
export function formatarPeriodoFerias(inicioISO, fimISO) {
  if (!inicioISO || !fimISO) return '';
  if (inicioISO.slice(0, 4) !== fimISO.slice(0, 4)) {
    const longa = (iso) => iso.split('-').reverse().join('/');
    return `${longa(inicioISO)} a ${longa(fimISO)}`;
  }
  if (inicioISO === fimISO) return dataCurta(inicioISO);
  return `${dataCurta(inicioISO)} a ${dataCurta(fimISO)}`;
}

/**
 * Mensalidade fixa com férias não pagas no mês: desconto proporcional às
 * sessões que caíram nas férias não pagas. `ocorrencias` é a lista de datas
 * ISO em que a pessoa teria sessão no mês (pelos horários fixos).
 * Ex.: 4 sessões no mês, 2 em férias não pagas -> paga metade.
 */
export function valorMensalFixoComFerias(valorFixo, ocorrencias, patientId, ferias) {
  const valor = Number(valorFixo) || 0;
  const total = (ocorrencias || []).length;
  if (!valor || total === 0) return valor;
  const naoPagas = ocorrencias.filter((iso) => {
    const situacao = feriasNaData(ferias, patientId, iso);
    return situacao && !situacao.paga;
  }).length;
  if (naoPagas === 0) return valor;
  return Math.round(valor * ((total - naoPagas) / total) * 100) / 100;
}
