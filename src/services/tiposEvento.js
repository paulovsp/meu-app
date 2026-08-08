// ─── Tipos de evento da Agenda (item J.23) ──────────────────────────────
// Cor e rótulo de cada tipo, num único lugar — usado tanto no formulário
// de disponibilidade quanto na Agenda (cores dos cards/badges) e no
// detalhe do compromisso, pra nunca dessincronizar.
export const TIPOS_EVENTO = [
  {
    valor: 'sessao_individual', label: 'Nova sessão individual', labelCurto: 'Sessão individual',
    cor: '#D64545', grupo: false, temPaciente: true,
  },
  {
    valor: 'sessao_grupo', label: 'Nova sessão em grupo', labelCurto: 'Sessão em grupo',
    cor: '#6B2737', grupo: true, temPaciente: false,
  },
  {
    valor: 'supervisao_individual', label: 'Nova supervisão individual', labelCurto: 'Supervisão individual',
    cor: '#F2994A', grupo: false, temPaciente: true,
  },
  {
    valor: 'supervisao_grupo', label: 'Nova supervisão em grupo', labelCurto: 'Supervisão em grupo',
    cor: '#B5651D', grupo: true, temPaciente: false,
  },
  {
    valor: 'outros', label: 'Outros', labelCurto: 'Outros',
    cor: '#3D5A80', grupo: false, temPaciente: false,
  },
];

export function infoTipoEvento(tipo) {
  return TIPOS_EVENTO.find((t) => t.valor === tipo) || TIPOS_EVENTO[0];
}

export function corTipoEvento(tipo) {
  return infoTipoEvento(tipo).cor;
}

export function ehTipoGrupo(tipo) {
  return infoTipoEvento(tipo).grupo;
}

export function tipoTemPacienteUnico(tipo) {
  return infoTipoEvento(tipo).temPaciente;
}
