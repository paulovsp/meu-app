// ─── Cruzamento de status do compromisso + presença de relato/transcrição ──
// Usado na Agenda (card do horário) e no detalhe do compromisso, pra manter
// a mesma lógica de "qual estado mostrar" nos dois lugares.

/** "2026-07-25" + "14:30" -> já passou desse horário agora? */
export function horarioJaPassou(dataISO, endTime) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const [hh, mm] = (endTime || '00:00').split(':').map(Number);
  const fim = new Date(ano, mes - 1, dia, hh, mm);
  return Date.now() > fim.getTime();
}

/**
 * status: 'agendado' | 'realizado' | 'cancelado' | 'nao_realizado'
 * Retorna um dos: 'agendado_futuro', 'aguardando_confirmacao',
 * 'realizado_ok', 'realizado_sem_relato', 'cancelado', 'nao_realizado'.
 */
export function getEstadoCompromisso({ status, temTranscricao, horarioPassou }) {
  if (status === 'cancelado') return 'cancelado';
  if (status === 'nao_realizado') return 'nao_realizado';
  if (status === 'realizado') {
    return temTranscricao ? 'realizado_ok' : 'realizado_sem_relato';
  }
  // status === 'agendado'
  return horarioPassou ? 'aguardando_confirmacao' : 'agendado_futuro';
}

// Cores de ESTADO (não de tipo de evento — essas ficam em tiposEvento.js,
// preservadas). Aqui valem as semânticas do tema: info, atenção, sucesso,
// erro e neutro, todas verificadas em contraste sobre papel.
export const ESTADO_LABEL = {
  agendado_futuro: { texto: 'Agendado', cor: '#4D6B88' },
  aguardando_confirmacao: { texto: 'Aguardando confirmação', cor: '#7D6540' },
  realizado_ok: { texto: 'Realizada', cor: '#44745B' },
  realizado_sem_relato: { texto: 'Realizada — sem relato', cor: '#975451' },
  cancelado: { texto: 'Cancelada', cor: '#8C857B' },
  nao_realizado: { texto: 'Não realizada', cor: '#975451' },
};
