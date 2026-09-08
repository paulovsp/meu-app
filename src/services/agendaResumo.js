// Qual dia a prévia da Agenda, na tela inicial, deve mostrar.
//
// Antes era sempre hoje, e sem dizer que era hoje. Duas consequências:
//
//   1. Às nove da noite de sexta o widget mostrava a sexta inteira já
//      vencida — a informação menos útil do dia. Quem olha o celular
//      depois do último atendimento quer saber do próximo, não do que
//      acabou de acontecer.
//
//   2. Como não havia rótulo de data, não dava pra saber que dia era.
//      Agora que o dia mostrado pode não ser hoje, o rótulo deixa de ser
//      enfeite e vira parte da informação.
//
// A regra: mostra o dia corrente até uma hora depois do fim do último
// compromisso dele; passado isso, salta pro próximo dia que tenha alguma
// coisa. Dia vazio é pulado — por isso, uma hora depois da última sessão
// de sexta, aparece a segunda, se o fim de semana estiver livre.
import {
  getAppointmentsByDateRange, getAvailabilitySlots, slotAtivoNaData,
  getHorariosLiberadosNoIntervalo, ensureAppointmentsForDate,
} from './database';
import { corTipoEvento, ehTipoGrupo } from './tiposEvento';
import { dataParaISO, dataISOParaData } from './validacao';

const COR_LIVRE = '#43A047';

/** Quanto tempo o dia que acabou ainda continua em cartaz. */
export const MINUTOS_APOS_ULTIMO = 60;

/** Até onde procurar um dia com algo, antes de desistir e mostrar hoje. */
const DIAS_A_FRENTE = 14;

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Primeiro nome (ou o título/"Grupo") — o widget é estreito demais pro
 *  nome inteiro. */
export function nomeCurto({ tipo, patientNome, titulo, participantes }) {
  if (tipo === 'outros') return (titulo || 'Outros').split(' ')[0];
  if (ehTipoGrupo(tipo)) return participantes?.[0]?.nome?.split(' ')[0] || 'Grupo';
  return (patientNome || 'Livre').split(' ')[0];
}

// `Number('')` é ZERO, não NaN — a armadilha clássica. Sem exigir o
// formato, um `endTime` nulo virava "meia-noite" em vez de "não informado",
// e o dia era dado por encerrado à 1h da manhã.
function minutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Os blocos de um dia — horários recorrentes ativos naquela data, mais os
 * compromissos avulsos que não têm horário por trás.
 *
 * `liberados` é o que faltava no widget e existia na Agenda: um horário
 * apagado só naquela data, ou esvaziado por uma remarcação, sai da grade
 * daquele dia. Sem isso, a prévia mostrava como ocupado um horário que a
 * Agenda já mostrava livre — era o "não reconhece as mudanças".
 *
 * Função pura: recebe os dados, devolve a lista. É o que torna a regra
 * testável sem banco.
 */
export function montarBlocosDoDia({ slots, compromissos, liberados, dataISO }) {
  const diaSemana = dataISOParaData(dataISO)?.getDay();
  const ativos = (compromissos || []).filter((c) => c.status !== 'cancelado');
  const liberadosNoDia = new Set(
    (liberados || []).filter((l) => l.date === dataISO).map((l) => l.start_time)
  );

  const horariosComSlot = new Set();
  const lista = [];

  for (const slot of slots || []) {
    if (slot.day_of_week !== diaSemana) continue;
    if (!slotAtivoNaData(slot, dataISO)) continue;

    const compromisso = ativos.find((c) => c.start_time === slot.start_time);
    // Liberado e sem compromisso novo no lugar: o horário não existe nesse
    // dia. Mesmo critério da Agenda.
    if (!compromisso && liberadosNoDia.has(slot.start_time)) continue;

    horariosComSlot.add(slot.start_time);
    const tipo = compromisso?.tipo || slot.tipo || 'sessao_individual';
    const ocupado = !!compromisso || !!slot.patient_id || tipo === 'outros' || ehTipoGrupo(tipo);
    lista.push({
      key: `slot-${slot.id}-${dataISO}`,
      startTime: slot.start_time,
      endTime: compromisso?.end_time || slot.end_time,
      cor: ocupado ? corTipoEvento(tipo) : COR_LIVRE,
      nome: nomeCurto({
        tipo,
        patientNome: compromisso?.patient_nome || slot.patient_name,
        titulo: compromisso?.titulo || slot.titulo,
        participantes: compromisso?.participantes || slot.participantes,
      }),
    });
  }

  // Compromissos avulsos (sem horário recorrente por trás) — entram à
  // parte, como a Agenda também faz.
  for (const c of ativos) {
    if (horariosComSlot.has(c.start_time)) continue;
    lista.push({
      key: `compromisso-${c.id}`,
      startTime: c.start_time,
      endTime: c.end_time,
      cor: corTipoEvento(c.tipo),
      nome: nomeCurto({
        tipo: c.tipo,
        patientNome: c.patient_nome,
        titulo: c.titulo,
        participantes: c.participantes,
      }),
    });
  }

  lista.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  return lista;
}

/**
 * O dia de hoje ainda vale a pena mostrar?
 *
 * Vale até uma hora depois do fim do último bloco. Sem nenhum bloco, não
 * vale — não há o que mostrar de hoje.
 */
export function hojeAindaInteressa(blocos, agora = new Date()) {
  if (!blocos || blocos.length === 0) return false;
  const fins = blocos
    .map((b) => minutos(b.endTime) ?? ((minutos(b.startTime) ?? 0) + 50))
    .filter((m) => m != null);
  if (fins.length === 0) return true;
  const ultimoFim = Math.max(...fins);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  return agoraMin < ultimoFim + MINUTOS_APOS_ULTIMO;
}

/** Quando o dia de hoje deixa de valer — pra agendar a virada exata em vez
 *  de ficar perguntando de minuto em minuto. */
export function momentoDaVirada(blocos, agora = new Date()) {
  if (!blocos || blocos.length === 0) return null;
  const fins = blocos.map((b) => minutos(b.endTime) ?? ((minutos(b.startTime) ?? 0) + 50));
  const alvoMin = Math.max(...fins) + MINUTOS_APOS_ULTIMO;
  const virada = new Date(agora);
  virada.setHours(0, alvoMin, 0, 0);
  return virada > agora ? virada : null;
}

export function rotuloDoDia(dataISO, agora = new Date()) {
  const hoje = dataParaISO(agora);
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  if (dataISO === hoje) return 'Hoje';
  if (dataISO === dataParaISO(amanha)) return 'Amanhã';
  const d = dataISOParaData(dataISO);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${DIAS_CURTOS[d.getDay()]}, ${dia}/${mes}`;
}

/**
 * A prévia pronta: qual dia, com que rótulo, quais blocos e quando essa
 * escolha expira.
 *
 * Uma consulta de horários e uma de compromissos para a janela inteira —
 * não uma por dia. Materializa só o dia que vai ser mostrado, porque
 * `ensureAppointmentsForDate` escreve no banco e não faz sentido criar
 * compromissos de duas semanas à frente só pra decidir o que exibir.
 */
export async function getPreviaDaAgenda(agora = new Date()) {
  const inicioISO = dataParaISO(agora);
  const fim = new Date(agora);
  fim.setDate(fim.getDate() + DIAS_A_FRENTE);
  const fimISO = dataParaISO(fim);

  const [slots, compromissos, liberados] = await Promise.all([
    getAvailabilitySlots(),
    getAppointmentsByDateRange(inicioISO, fimISO),
    getHorariosLiberadosNoIntervalo(inicioISO, fimISO),
  ]);

  for (let i = 0; i <= DIAS_A_FRENTE; i += 1) {
    const d = new Date(agora);
    d.setDate(d.getDate() + i);
    const dataISO = dataParaISO(d);

    const blocos = montarBlocosDoDia({
      slots,
      compromissos: (compromissos || []).filter((c) => c.date === dataISO),
      liberados,
      dataISO,
    });

    if (blocos.length === 0) continue;              // dia vazio: pula
    if (i === 0 && !hojeAindaInteressa(blocos, agora)) continue; // hoje já acabou

    // Só agora vale materializar: é este dia que vai à tela. Sem isto, um
    // dia nunca aberto na Agenda apareceria sem os compromissos que o
    // horário recorrente produz.
    try {
      await ensureAppointmentsForDate(dataISO, d.getDay());
      const doDia = await getAppointmentsByDateRange(dataISO, dataISO);
      const blocosFinais = montarBlocosDoDia({
        slots, compromissos: doDia, liberados, dataISO,
      });
      return {
        dataISO,
        rotulo: rotuloDoDia(dataISO, agora),
        blocos: blocosFinais,
        viradaEm: i === 0 ? momentoDaVirada(blocosFinais, agora) : null,
      };
    } catch (_) {
      return {
        dataISO,
        rotulo: rotuloDoDia(dataISO, agora),
        blocos,
        viradaEm: i === 0 ? momentoDaVirada(blocos, agora) : null,
      };
    }
  }

  // Duas semanas sem nada marcado: mostra hoje, vazio, em vez de mentir
  // sobre um dia distante.
  return { dataISO: inicioISO, rotulo: 'Hoje', blocos: [], viradaEm: null };
}
