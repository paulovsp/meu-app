// ─── Relatórios gerais da clínica ───────────────────────────────────────
//
// Os relatórios por analisante (relatorios.js) olham uma pessoa só. Este
// olha o consultório inteiro num período escolhido — uma semana, um mês, um
// ano ou datas livres — e junta o que hoje está espalhado pela Agenda, pela
// Cobrança, pelas Entradas e pelas Saídas.
//
// As regras de contagem são as mesmas do resto do app, para os números
// baterem com o que a pessoa vê nas outras telas:
//
//  • Passado: só conta o que virou compromisso na Agenda (o que o
//    Financeiro também faz). Um horário fixo de um dia que ninguém abriu na
//    Agenda não vira sessão "feita" nem "falta" — não sabemos o que houve.
//  • De hoje em diante: compromissos já marcados mais a grade fixa
//    projetada (como contarSessoesFuturasDoMes), sem os horários apagados
//    só naquele dia, sem quem está com a análise paralisada, e com as
//    férias separadas.
//  • "Temporariamente livre" (quinzenal/personalizado fora da sua semana)
//    nunca é sessão: entra à parte, como horário vago.
//  • Status: realizado = feita; nao_realizado = falta ou cancelamento
//    cobrado (é o mesmo status no app); cancelado = cancelada sem cobrança;
//    ferias = em férias; agendado = aguardando confirmação (já passou) ou
//    por vir.
//  • "Desmarcada": o horário fixo foi tirado da agenda só naquele dia
//    (apagado, ou a sessão foi remarcada para outro dia/horário).
//
// As contas são funções puras (testadas em __tests__/relatorioGeral.test.js);
// a leitura do banco fica em gerarRelatorioGeral, no fim do arquivo.
import { supabase } from './supabase';
import {
  getAvailabilitySlots, getFerias, listarPacientes, slotAtivoNaData,
  horariosTemporariamenteLivres, getRecebimentosDoMes, filtrarRecebimentosMensais,
  valorEntradaDoMes,
} from './database';
import { horarioFicaEmFerias, datasDoPeriodo, diasNoPeriodo } from './ferias';
import { ehTipoGrupo, infoTipoEvento } from './tiposEvento';
import { dataParaISO, dataISOParaData } from './validacao';
import { labelCategoria } from './despesas';

// ─── Período ────────────────────────────────────────────────────────────

export const TIPOS_PERIODO = [
  { valor: 'semana', label: 'Semanal' },
  { valor: 'mes', label: 'Mensal' },
  { valor: 'ano', label: 'Anual' },
  { valor: 'personalizado', label: 'Por período' },
];

/** Período livre mais longo aceito: dois anos. Além de ficar lento (cada
 *  mês é uma conta de cobrança), um relatório de dez anos por engano de
 *  digitação não ajuda ninguém. */
export const MAX_DIAS_PERSONALIZADO = 731;

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const DIAS_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

function ddmm(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function ddmmaaaa(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * O período (início e fim, inclusive) que contém `ref`. A semana vai de
 * domingo a sábado, a mesma da Agenda e do "esta semana" do Financeiro.
 */
export function periodoDe(tipo, ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (tipo === 'semana') {
    const inicio = new Date(d);
    inicio.setDate(d.getDate() - d.getDay());
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    return { tipo, inicioISO: dataParaISO(inicio), fimISO: dataParaISO(fim) };
  }
  if (tipo === 'ano') {
    return {
      tipo,
      inicioISO: dataParaISO(new Date(d.getFullYear(), 0, 1)),
      fimISO: dataParaISO(new Date(d.getFullYear(), 11, 31)),
    };
  }
  // mês (e o ponto de partida do personalizado)
  return {
    tipo,
    inicioISO: dataParaISO(new Date(d.getFullYear(), d.getMonth(), 1)),
    fimISO: dataParaISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

/** A data de referência um período para trás (-1) ou para frente (+1). */
export function deslocarReferencia(tipo, ref, passo) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (tipo === 'semana') d.setDate(d.getDate() + 7 * passo);
  else if (tipo === 'ano') d.setFullYear(d.getFullYear() + passo, 0, 1);
  else d.setMonth(d.getMonth() + passo, 1);
  return d;
}

/** Nome do período por extenso, para a pessoa conferir antes de gerar.
 *  "Semana de domingo, 22/11 a sábado, 28/11/2026", "Novembro de 2026",
 *  "Ano de 2026", "De 01/10/2026 a 26/11/2026". */
export function rotuloPeriodo({ tipo, inicioISO, fimISO }) {
  if (!inicioISO || !fimISO) return '';
  if (tipo === 'semana') {
    return `Semana de domingo, ${ddmm(inicioISO)} a sábado, ${ddmmaaaa(fimISO)}`;
  }
  if (tipo === 'mes') {
    const d = dataISOParaData(inicioISO);
    const nome = MESES[d.getMonth()];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${d.getFullYear()}`;
  }
  if (tipo === 'ano') return `Ano de ${inicioISO.slice(0, 4)}`;
  if (inicioISO === fimISO) return `Dia ${ddmmaaaa(inicioISO)}`;
  return `De ${ddmmaaaa(inicioISO)} a ${ddmmaaaa(fimISO)}`;
}

/** "(esta semana)", "(este mês)", "(este ano)" quando o período é o atual. */
export function marcaPeriodoAtual({ tipo, inicioISO, fimISO }, agora = new Date()) {
  const hoje = dataParaISO(agora);
  if (!(inicioISO <= hoje && hoje <= fimISO)) return '';
  if (tipo === 'semana') return 'esta semana';
  if (tipo === 'mes') return 'este mês';
  if (tipo === 'ano') return 'este ano';
  return 'inclui hoje';
}

/** Confere um período livre. Devolve a mensagem do problema ou null. */
export function validarPeriodo(inicioISO, fimISO) {
  if (!inicioISO || !fimISO) return 'Preencha as duas datas (dia/mês/ano).';
  if (!dataISOParaData(inicioISO) || !dataISOParaData(fimISO)) return 'Uma das datas não existe.';
  if (fimISO < inicioISO) return 'A data final é anterior à inicial.';
  if (diasNoPeriodo(inicioISO, fimISO) > MAX_DIAS_PERSONALIZADO) {
    return 'O período pode ter no máximo dois anos.';
  }
  return null;
}

/** Meses (0-11) que o período toca, em ordem. */
export function mesesDoPeriodo(inicioISO, fimISO) {
  const [a1, m1] = inicioISO.split('-').map(Number);
  const [a2, m2] = fimISO.split('-').map(Number);
  const meses = [];
  let ano = a1;
  let mes = m1 - 1;
  while (ano < a2 || (ano === a2 && mes <= m2 - 1)) {
    meses.push({ ano, mes });
    mes += 1;
    if (mes === 12) { mes = 0; ano += 1; }
  }
  return meses;
}

// ─── Sessões ────────────────────────────────────────────────────────────

function minutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** O horário daquela data já terminou? Sem fim, conta 50 min do início. */
function jaTerminou(dataISO, startTime, endTime, agora) {
  const hoje = dataParaISO(agora);
  if (dataISO < hoje) return true;
  if (dataISO > hoje) return false;
  const fim = minutos(endTime) ?? ((minutos(startTime) ?? 0) + 50);
  return agora.getHours() * 60 + agora.getMinutes() >= fim;
}

function nomeDoGrupo({ titulo, participantes }) {
  if (titulo) return titulo;
  const nomes = (participantes || []).map((p) => (p.nome || '').split(' ')[0]).filter(Boolean);
  return nomes.length ? `Grupo (${nomes.join(', ')})` : 'Grupo';
}

const CAMPOS_PESSOA = ['realizadas', 'faltas', 'canceladas', 'ferias', 'aguardando', 'porVir', 'desmarcadas'];

/**
 * Conta as sessões de um período, dia a dia. Pura.
 *
 *  slots       grade fixa (getAvailabilitySlots), com `participantes` nos grupos
 *  compromissos appointments do período (com patient_nome e participantes)
 *  liberados   horarios_liberados do período ({date, start_time})
 *  ferias      todas as férias (getFerias)
 *  paralisadas { [patient_id]: 'AAAA-MM-DD' } desde quando a análise está parada
 */
export function contarSessoesDoPeriodo({
  slots, compromissos, liberados, ferias = [], paralisadas = {}, inicioISO, fimISO, agora = new Date(),
}) {
  const hoje = dataParaISO(agora);
  const r = {
    realizadas: 0, faltas: 0, canceladas: 0, ferias: 0, aguardando: 0, porVir: 0,
    desmarcadas: 0, temporariamenteLivres: 0, outros: 0,
    porTipo: {}, porModalidade: {}, porDiaSemana: [0, 0, 0, 0, 0, 0, 0],
  };
  const pessoas = new Map();
  const pessoa = (chave, nome) => {
    if (!pessoas.has(chave)) {
      const linha = { chave, nome: nome || 'Sem nome' };
      CAMPOS_PESSOA.forEach((c) => { linha[c] = 0; });
      pessoas.set(chave, linha);
    }
    return pessoas.get(chave);
  };
  const chaveDe = ({ tipo, patient_id: pid, nome, titulo, participantes }) => (
    ehTipoGrupo(tipo)
      ? [`grupo|${nomeDoGrupo({ titulo, participantes })}`, nomeDoGrupo({ titulo, participantes })]
      : [pid || `sem|${nome || ''}`, nome]
  );
  const contar = (campo, quem) => {
    r[campo] += 1;
    if (quem) pessoa(...quem)[campo] += 1;
  };
  const registrarFeita = ({ tipo, modality }, dataISO) => {
    const t = tipo || 'sessao_individual';
    r.porTipo[t] = (r.porTipo[t] || 0) + 1;
    const mod = modality || 'nao_informada';
    r.porModalidade[mod] = (r.porModalidade[mod] || 0) + 1;
    r.porDiaSemana[dataISOParaData(dataISO).getDay()] += 1;
  };

  const porData = new Map();
  for (const c of compromissos || []) {
    if (c.date < inicioISO || c.date > fimISO) continue;
    if (!porData.has(c.date)) porData.set(c.date, []);
    porData.get(c.date).push(c);
  }
  const liberadosSet = new Set((liberados || []).map((l) => `${l.date}|${l.start_time}`));

  for (const dataISO of datasDoPeriodo(inicioISO, fimISO)) {
    const doDia = porData.get(dataISO) || [];
    const diaSemana = dataISOParaData(dataISO).getDay();

    // 1. Tudo o que virou compromisso: cada um conta uma vez, pelo status.
    for (const c of doDia) {
      if ((c.tipo || 'sessao_individual') === 'outros') { r.outros += 1; continue; }
      const quem = chaveDe({
        tipo: c.tipo, patient_id: c.patient_id, nome: c.patient_nome, titulo: c.titulo, participantes: c.participantes,
      });
      switch (c.status) {
        case 'realizado': contar('realizadas', quem); registrarFeita(c, dataISO); break;
        case 'nao_realizado': contar('faltas', quem); break;
        case 'cancelado': contar('canceladas', quem); break;
        case 'ferias': contar('ferias', quem); break;
        default:
          contar(jaTerminou(dataISO, c.start_time, c.end_time, agora) ? 'aguardando' : 'porVir', quem);
      }
    }

    // 2. A grade fixa, nos horários sem compromisso.
    const horasComCompromisso = new Set(doDia.map((c) => c.start_time));
    const horasVistas = new Set();
    for (const slot of slots || []) {
      if (slot.day_of_week !== diaSemana) continue;
      if (!slotAtivoNaData(slot, dataISO)) continue;
      const tipo = slot.tipo || 'sessao_individual';
      const temAlguem = !!slot.patient_id || ehTipoGrupo(tipo) || tipo === 'outros';
      if (!temAlguem) continue;
      if (horasVistas.has(slot.start_time)) continue;
      horasVistas.add(slot.start_time);
      if (horasComCompromisso.has(slot.start_time)) continue;

      const quem = tipo === 'outros' ? null : chaveDe({
        tipo, patient_id: slot.patient_id, nome: slot.patient_name, titulo: slot.titulo, participantes: slot.participantes,
      });
      if (liberadosSet.has(`${dataISO}|${slot.start_time}`)) {
        if (quem) contar('desmarcadas', quem);
        continue;
      }
      if (dataISO < hoje) continue; // passado sem compromisso: não se sabe o que houve
      const parouEm = slot.patient_id ? paralisadas[slot.patient_id] : null;
      if (parouEm && parouEm <= dataISO) continue;
      if (tipo === 'outros') { r.outros += 1; continue; }
      if (horarioFicaEmFerias(slot, dataISO, ferias)) { contar('ferias', quem); continue; }
      contar(jaTerminou(dataISO, slot.start_time, slot.end_time, agora) ? 'aguardando' : 'porVir', quem);
    }

    // 3. Horários de quinzenais/personalizados fora da sua semana.
    r.temporariamenteLivres += horariosTemporariamenteLivres(slots, dataISO, doDia).length;
  }

  r.agendadas = r.realizadas + r.faltas + r.canceladas + r.ferias + r.aguardando + r.porVir;
  const base = r.realizadas + r.faltas;
  r.comparecimento = base > 0 ? Math.round((r.realizadas / base) * 1000) / 10 : null;
  const resolvidas = r.realizadas + r.faltas + r.canceladas;
  r.taxaCancelamento = resolvidas > 0 ? Math.round((r.canceladas / resolvidas) * 1000) / 10 : null;
  r.porPessoa = [...pessoas.values()]
    .filter((p) => CAMPOS_PESSOA.some((c) => p[c] > 0))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  r.pessoasAtendidas = r.porPessoa.filter((p) => p.realizadas > 0 && !String(p.chave).startsWith('grupo|')).length;
  return r;
}

export function labelTipoSessao(tipo) {
  return infoTipoEvento(tipo).labelCurto;
}

export function labelModalidade(mod) {
  if (mod === 'presencial') return 'Presencial';
  if (mod === 'online') return 'On-line';
  if (mod === 'nao_informada') return 'Não informada';
  return mod.charAt(0).toUpperCase() + mod.slice(1);
}

// ─── Dinheiro ───────────────────────────────────────────────────────────

/** Pagamentos marcados como recebidos dentro do período (pela data em que
 *  foram marcados no app). Pura. */
export function resumirPagamentosRecebidos(pagamentos) {
  const porPessoa = new Map();
  let total = 0;
  let semValor = 0;
  for (const p of pagamentos || []) {
    const valor = Number(p.valor);
    if (!Number.isFinite(valor) || p.valor == null) semValor += 1;
    else total += valor;
    const chave = p.patient_id || 'sem';
    if (!porPessoa.has(chave)) porPessoa.set(chave, { nome: p.patient_nome || 'Sem nome', valor: 0, quantidade: 0 });
    const linha = porPessoa.get(chave);
    linha.quantidade += 1;
    if (Number.isFinite(valor) && p.valor != null) linha.valor += valor;
  }
  return {
    total,
    quantidade: (pagamentos || []).length,
    semValor,
    porPessoa: [...porPessoa.values()].sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

function isoDoDia(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Cobranças dos meses que o período toca, como a tela de Cobrança mostra
 * (mensalidade inteira no mês em que é cobrada; por sessão, sessão a
 * sessão). Pura. `meses` = [{ ano, mes, recebimentos }] (getRecebimentosDoMes).
 *
 *   recebido  — já marcado como recebido
 *   emAtraso  — já devia ter entrado (mensalidade vencida, sessão feita e não paga)
 *   aVencer   — ainda não venceu (mensalidade a vencer, sessões por vir)
 */
export function resumirCobrancas(meses, agora = new Date()) {
  const hoje = dataParaISO(agora);
  const r = { previsto: 0, recebido: 0, emAtraso: 0, aVencer: 0, pendencias: [] };
  for (const { ano, mes, recebimentos } of meses || []) {
    for (const item of filtrarRecebimentosMensais(recebimentos)) {
      if (item.tipo_cobranca === 'por_sessao') {
        const recebido = item.valorRecebido || 0;
        const emAberto = item.valorEmAberto || 0;
        const futuro = item.valorFuturo || 0;
        r.previsto += valorEntradaDoMes(item);
        r.recebido += recebido;
        r.emAtraso += emAberto;
        r.aVencer += futuro;
        if (emAberto > 0) {
          r.pendencias.push({
            nome: item.nome, ano, mes, valor: emAberto, situacao: 'atrasado',
            detalhe: `${item.sessoesEmAberto} sessão(ões) feita(s) sem pagamento`,
          });
        }
        continue;
      }
      const valor = item.valorPrevisto || 0;
      if (valor <= 0 && !item.recebido) continue;
      r.previsto += valor;
      if (item.recebido) { r.recebido += valor; continue; }
      const vencimento = isoDoDia(ano, mes, item.dia_pagamento || new Date(ano, mes + 1, 0).getDate());
      const atrasado = vencimento < hoje;
      if (atrasado) r.emAtraso += valor; else r.aVencer += valor;
      r.pendencias.push({
        nome: item.nome, ano, mes, valor, situacao: atrasado ? 'atrasado' : 'a_vencer',
        detalhe: `mensalidade, vence ${ddmm(vencimento)}`,
      });
    }
  }
  r.pendencias.sort((a, b) => (
    (a.situacao === b.situacao ? 0 : a.situacao === 'atrasado' ? -1 : 1)
    || (a.ano - b.ano) || (a.mes - b.mes) || a.nome.localeCompare(b.nome, 'pt-BR')
  ));
  return r;
}

/** Despesas lançadas em Saídas no período, por categoria. Pura. */
export function resumirDespesas(despesas) {
  const porCategoria = new Map();
  let total = 0;
  for (const d of despesas || []) {
    const valor = Number(d.valor) || 0;
    total += valor;
    const label = labelCategoria(d.categoria || 'outros');
    porCategoria.set(label, (porCategoria.get(label) || 0) + valor);
  }
  return {
    total,
    quantidade: (despesas || []).length,
    porCategoria: [...porCategoria.entries()]
      .map(([label, valor]) => ({ label, valor }))
      .sort((a, b) => b.valor - a.valor),
  };
}

/** Entradas e saídas de analisantes no período. Pura. */
export function resumirMovimentoDePessoas({ pacientes, paralizacoes, inicioISO, fimISO }) {
  const dentro = (iso) => !!iso && String(iso).slice(0, 10) >= inicioISO && String(iso).slice(0, 10) <= fimISO;
  const nomes = new Map((pacientes || []).map((p) => [p.id, p.nome]));
  const ordenar = (lista) => lista.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    comecaram: ordenar((pacientes || []).filter((p) => dentro(p.data_inicio)).map((p) => p.nome)),
    pararam: ordenar((paralizacoes || []).filter((p) => dentro(p.data_inicio)).map((p) => nomes.get(p.patient_id) || 'Sem nome')),
    voltaram: ordenar((paralizacoes || []).filter((p) => dentro(p.data_fim)).map((p) => nomes.get(p.patient_id) || 'Sem nome')),
  };
}

/** Férias (do analista e de clientes) que tocam o período. Pura. */
export function feriasNoPeriodo(ferias, inicioISO, fimISO) {
  return (ferias || [])
    .filter((f) => f.data_inicio <= fimISO && f.data_fim >= inicioISO)
    .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
    .map((f) => ({
      quem: f.tipo === 'analista' ? 'Suas férias' : (f.patient_nome || 'Cliente'),
      inicioISO: f.data_inicio,
      fimISO: f.data_fim,
      paga: f.tipo === 'analista' ? null : !!f.paga,
    }));
}

// ─── Texto para compartilhar ───────────────────────────────────────────

export function formatarReais(valor) {
  return `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function nomeDoMes({ ano, mes }) {
  return `${MESES[mes]}/${ano}`;
}

/** O relatório inteiro em texto corrido, para compartilhar ou copiar. */
export function montarTextoRelatorio(rel) {
  const s = rel.sessoes;
  const linhas = [
    'Relatório geral da clínica — Dr. Sig',
    rotuloPeriodo(rel.periodo),
    '',
    '— SESSÕES —',
    `Agendadas no período: ${s.agendadas}`,
    `Feitas: ${s.realizadas}`,
    `Faltas (ou canceladas com cobrança): ${s.faltas}`,
    `Canceladas sem cobrança: ${s.canceladas}`,
    `Desmarcadas (horário tirado da agenda no dia): ${s.desmarcadas}`,
    `Em férias: ${s.ferias}`,
    `Aguardando confirmação: ${s.aguardando}`,
    `Ainda por vir: ${s.porVir}`,
    `Horários temporariamente livres: ${s.temporariamenteLivres}`,
  ];
  if (s.comparecimento != null) linhas.push(`Comparecimento: ${String(s.comparecimento).replace('.', ',')}%`);
  if (s.taxaCancelamento != null) linhas.push(`Cancelamentos sem cobrança: ${String(s.taxaCancelamento).replace('.', ',')}% das sessões resolvidas`);
  linhas.push(`Pessoas atendidas: ${s.pessoasAtendidas}`);

  const c = rel.cobrancas;
  linhas.push(
    '',
    '— DINHEIRO —',
    `Recebido no período: ${formatarReais(rel.recebidos.total)} (${rel.recebidos.quantidade} pagamento(s) confirmado(s))`,
    `Despesas lançadas no período: ${formatarReais(rel.despesas.total)}`,
    `Saldo (recebido − despesas): ${formatarReais(rel.recebidos.total - rel.despesas.total)}`,
    '',
    `Cobranças de ${rel.mesesCobranca.map(nomeDoMes).join(', ')}:`,
    `Previsto: ${formatarReais(c.previsto)}`,
    `Já recebido: ${formatarReais(c.recebido)}`,
    `Em aberto (já devia ter entrado): ${formatarReais(c.emAtraso)}`,
    `A vencer: ${formatarReais(c.aVencer)}`,
  );
  if (c.pendencias.length) {
    linhas.push('', 'Em aberto:');
    c.pendencias.forEach((p) => linhas.push(
      `• ${p.nome} — ${nomeDoMes(p)} — ${formatarReais(p.valor)} (${p.situacao === 'atrasado' ? 'em atraso' : 'a vencer'}; ${p.detalhe})`,
    ));
  }

  if (s.porPessoa.length) {
    linhas.push('', '— POR ANALISANTE —');
    s.porPessoa.forEach((p) => linhas.push(
      `• ${p.nome}: ${p.realizadas} feita(s), ${p.faltas} falta(s), ${p.canceladas} cancelada(s), ${p.desmarcadas} desmarcada(s)`
      + `${p.ferias ? `, ${p.ferias} em férias` : ''}${p.aguardando ? `, ${p.aguardando} aguardando` : ''}${p.porVir ? `, ${p.porVir} por vir` : ''}`,
    ));
  }
  return linhas.join('\n');
}

// ─── Leitura do banco ───────────────────────────────────────────────────

const TAMANHO_PAGINA = 1000;

/** O Supabase devolve no máximo mil linhas por consulta — um ano de agenda
 *  passa disso. Lê de mil em mil até acabar. */
async function lerTudo(montarConsulta) {
  const linhas = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await montarConsulta().range(de, de + TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < TAMANHO_PAGINA) return linhas;
  }
}

async function lerCompromissos(inicioISO, fimISO) {
  const linhas = await lerTudo(() => supabase
    .from('appointments')
    .select('id, date, start_time, end_time, status, modality, tipo, titulo, patient_id, patients(nome)')
    .gte('date', inicioISO)
    .lte('date', fimISO)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
    .order('id', { ascending: true }));
  const compromissos = linhas.map(({ patients, ...c }) => ({ ...c, patient_nome: patients?.nome ?? null, participantes: [] }));

  const idsGrupo = compromissos.filter((c) => ehTipoGrupo(c.tipo)).map((c) => c.id);
  const porId = new Map(compromissos.map((c) => [c.id, c]));
  for (let i = 0; i < idsGrupo.length; i += 200) {
    const { data, error } = await supabase
      .from('appointment_participantes')
      .select('appointment_id, patient_id, patients(nome)')
      .in('appointment_id', idsGrupo.slice(i, i + 200));
    if (error) throw error;
    (data || []).forEach((p) => {
      porId.get(p.appointment_id)?.participantes.push({ id: p.patient_id, nome: p.patients?.nome ?? null });
    });
  }
  return compromissos;
}

/** Roda `tarefa` para cada item, no máximo `limite` de cada vez. */
async function emLotes(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < itens.length) {
      const i = proximo;
      proximo += 1;
      resultados[i] = await tarefa(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

/**
 * Lê tudo e monta o relatório geral de um período. `periodo` =
 * { tipo, inicioISO, fimISO }.
 */
export async function gerarRelatorioGeral(periodo, agora = new Date()) {
  const { inicioISO, fimISO } = periodo;
  const erro = validarPeriodo(inicioISO, fimISO);
  if (erro) throw new Error(erro);

  const [a1, m1, d1] = inicioISO.split('-').map(Number);
  const [a2, m2, d2] = fimISO.split('-').map(Number);
  // Meia-noite local do primeiro dia até a meia-noite local do dia seguinte
  // ao último: `data_recebimento` é um instante, não uma data.
  const desdeInstante = new Date(a1, m1 - 1, d1).toISOString();
  const ateInstante = new Date(a2, m2 - 1, d2 + 1).toISOString();
  const mesesCobranca = mesesDoPeriodo(inicioISO, fimISO);
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  const [
    slots, compromissos, liberados, ferias, pacientes, paralizacoes, pagamentos, despesas, cobrancasPorMes,
  ] = await Promise.all([
    getAvailabilitySlots(),
    lerCompromissos(inicioISO, fimISO),
    lerTudo(() => supabase.from('horarios_liberados').select('date, start_time')
      .eq('user_id', userId).gte('date', inicioISO).lte('date', fimISO).order('date', { ascending: true })),
    getFerias().catch(() => []),
    listarPacientes(),
    supabase.from('patient_paralizacoes').select('patient_id, data_inicio, data_fim')
      .then(({ data, error }) => { if (error) throw error; return data || []; }),
    lerTudo(() => supabase.from('pagamentos')
      .select('id, valor, data_recebimento, patient_id, appointment_id, patients(nome)')
      .eq('recebido', true)
      .gte('data_recebimento', desdeInstante)
      .lt('data_recebimento', ateInstante)
      .order('data_recebimento', { ascending: true })),
    lerTudo(() => supabase.from('despesas_consultorio').select('id, valor, categoria, data')
      .gte('data', inicioISO).lte('data', fimISO).order('data', { ascending: true })),
    emLotes(mesesCobranca, 3, async ({ ano, mes }) => ({ ano, mes, recebimentos: await getRecebimentosDoMes(ano, mes) })),
  ]);

  const paralisadas = {};
  (pacientes || []).forEach((p) => { if (p.data_paralizacao) paralisadas[p.id] = String(p.data_paralizacao).slice(0, 10); });

  return {
    periodo,
    geradoEm: agora.toISOString(),
    mesesCobranca,
    sessoes: contarSessoesDoPeriodo({
      slots, compromissos, liberados, ferias, paralisadas, inicioISO, fimISO, agora,
    }),
    recebidos: resumirPagamentosRecebidos(pagamentos.map(({ patients, ...p }) => ({ ...p, patient_nome: patients?.nome ?? null }))),
    cobrancas: resumirCobrancas(cobrancasPorMes, agora),
    despesas: resumirDespesas(despesas),
    pessoas: resumirMovimentoDePessoas({ pacientes, paralizacoes, inicioISO, fimISO }),
    ferias: feriasNoPeriodo(ferias, inicioISO, fimISO),
  };
}
