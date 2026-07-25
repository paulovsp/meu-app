// ─── Métricas do Perfil por Núcleos Psíquicos ─────────────────────────────
// Todas as funções aqui são puras (sem tocar banco/rede) — recebem
// evidências/transições já carregadas e devolvem números. Pesos e
// normalizações são constantes nomeadas, fáceis de recalibrar depois do
// piloto retrospectivo (F6), sem precisar mexer na lógica.

import { instanciasCandidatas } from './nucleos';
import { getRubricaSemente } from './rubricas';

const NUCLEO_ORDEM = ['bem', 'mal', 'mau', 'bom'];

/** Densidade de referências por núcleo: Σ intensidade ÷ Σ intensidade total, em %. Eu nuclear fica fora da base (não é um "núcleo" para fins de proporção). */
export function calcularDensidadePorNucleo(evidencias) {
  const soma = { bem: 0, mal: 0, mau: 0, bom: 0 };
  (evidencias || []).forEach((e) => {
    if (soma[e.nucleo] === undefined) return;
    soma[e.nucleo] += Number(e.intensidade) || 0;
  });
  const total = NUCLEO_ORDEM.reduce((acc, n) => acc + soma[n], 0);
  const pct = {};
  NUCLEO_ORDEM.forEach((n) => {
    pct[n] = total > 0 ? Math.round((soma[n] / total) * 100) : 0;
  });
  return pct;
}

/**
 * Defesas mediadas por asa (dimensiona o tamanho de cada asa na mandala).
 * Transição diagonal direta conta 1 para "eu_nuclear" (evento anômalo,
 * só se comunica por ali). Transição não-diagonal com 2 instâncias
 * topologicamente possíveis divide o crédito 0.5/0.5 entre elas — sem
 * uma segunda chamada de IA pra decidir qual delas de fato mediou.
 */
export function calcularDefesasPorAsa(transicoes, rubrica = getRubricaSemente()) {
  const contagem = { ego: 0, id: 0, superego: 0, superid: 0, eu_nuclear: 0 };
  (transicoes || []).forEach((t) => {
    if (t.diagonal_direta) {
      contagem.eu_nuclear += 1;
      return;
    }
    const candidatas = instanciasCandidatas(t.de_nucleo, t.para_nucleo, rubrica);
    if (candidatas.length === 0) return;
    const credito = 1 / candidatas.length;
    candidatas.forEach((c) => {
      if (contagem[c] !== undefined) contagem[c] += credito;
    });
  });
  return contagem;
}

/**
 * Índice de retorno: das transições que partem de `nucleoOrigem`, qual
 * fração vai para `nucleoRetorno`. Default replica o exemplo do
 * documento de referência (Mal→Bem como "retorno" ao registro
 * relacional/desejante). Devolve null se não há transições dessa origem.
 */
export function calcularIndiceRetorno(transicoes, nucleoOrigem = 'mal', nucleoRetorno = 'bem') {
  const daOrigem = (transicoes || []).filter((t) => t.de_nucleo === nucleoOrigem);
  if (daOrigem.length === 0) return null;
  const retornos = daOrigem.filter((t) => t.para_nucleo === nucleoRetorno).length;
  return Number((retornos / daOrigem.length).toFixed(2));
}

/** Mobilidade entre núcleos: nº de transições ÷ nº de sessões, sempre entre 0 e 1. */
export function calcularMobilidade(numeroTransicoes, numeroSessoes) {
  if (!numeroSessoes || numeroSessoes <= 0) return 0;
  return Math.min(1, Number(((numeroTransicoes || 0) / numeroSessoes).toFixed(2)));
}

/** Gatilhos de virada rankeados por frequência (agrupados por trecho literal). */
export function rankearGatilhos(transicoes) {
  const porTrecho = new Map();
  (transicoes || []).forEach((t) => {
    if (!t.gatilho_trecho) return;
    const chave = t.gatilho_trecho.trim().toLowerCase();
    if (!porTrecho.has(chave)) {
      porTrecho.set(chave, { trecho: t.gatilho_trecho, contagem: 0 });
    }
    porTrecho.get(chave).contagem += 1;
  });
  return [...porTrecho.values()].sort((a, b) => b.contagem - a.contagem);
}

/**
 * Núcleos sem nenhuma evidência dentro da janela de sessões recentes
 * informada (já filtrada pelo chamador para as K sessões mais recentes).
 * Usado para gerar a "pergunta do app por ausência".
 */
export function detectarAusencias(evidencias, datasSessoesRecentes) {
  if (!datasSessoesRecentes || datasSessoesRecentes.length === 0) return [];
  const setDatas = new Set(datasSessoesRecentes);
  const presentes = new Set(
    (evidencias || [])
      .filter((e) => setDatas.has(e.data_sessao))
      .map((e) => e.nucleo)
  );
  return NUCLEO_ORDEM.filter((n) => !presentes.has(n));
}
