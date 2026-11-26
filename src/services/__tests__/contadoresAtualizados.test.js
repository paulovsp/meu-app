// Os contadores de "sessões hoje" (Início e Perfil), o previsto do dia e da
// semana no Financeiro e o horário da ficha precisam acompanhar o que muda
// na Agenda — cancelamento, remarcação, horário apagado só num dia, avulso,
// férias. Antes liam só a grade fixa e ficavam desatualizados.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const { sessoesDoDia, resumirSessoes } = require('../agendaResumo');
const { ocorrenciaValePelaAgenda, sessoesForaDaGrade } = require('../database');
const { resumoDosHorarios } = require('../horarios');

// 04/09/2026 é uma sexta-feira.
const SEXTA = '2026-09-04';

const slot = (extra = {}) => ({
  id: 's1', day_of_week: 5, start_time: '14:00', end_time: '14:50',
  patient_id: 'p1', tipo: 'sessao_individual', recorrencia_tipo: 'semanal', ...extra,
});
const compromisso = (extra = {}) => ({
  id: 'a1', date: SEXTA, start_time: '14:00', end_time: '14:50', patient_id: 'p1',
  status: 'agendado', tipo: 'sessao_individual', ...extra,
});
const contar = (dados) => sessoesDoDia({ dataISO: SEXTA, compromissos: [], liberados: [], ferias: [], ...dados }).length;

describe('sessoesDoDia (contador "sessões hoje")', () => {
  it('conta o horário fixo do dia', () => {
    expect(contar({ slots: [slot()] })).toBe(1);
  });

  it('sessão cancelada não conta', () => {
    expect(contar({ slots: [slot()], compromissos: [compromisso({ status: 'cancelado' })] })).toBe(0);
  });

  it('horário apagado só neste dia não conta', () => {
    expect(contar({ slots: [slot()], liberados: [{ date: SEXTA, start_time: '14:00' }] })).toBe(0);
  });

  it('sessão remarcada para outro horário do mesmo dia conta uma vez só', () => {
    expect(contar({
      slots: [slot()],
      liberados: [{ date: SEXTA, start_time: '14:00' }],
      compromissos: [compromisso({ start_time: '16:00', end_time: '16:50' })],
    })).toBe(1);
  });

  it('sessão remarcada para hoje, vinda de outro dia, conta', () => {
    expect(contar({ slots: [], compromissos: [compromisso({ start_time: '09:00' })] })).toBe(1);
  });

  it('cancelada e outra marcada no lugar: conta a nova', () => {
    expect(contar({
      slots: [slot()],
      compromissos: [compromisso({ status: 'cancelado' }), compromisso({ id: 'a2', patient_id: 'p2' })],
    })).toBe(1);
  });

  it('férias (compromisso ou período) não contam', () => {
    expect(contar({ slots: [slot()], compromissos: [compromisso({ status: 'ferias' })] })).toBe(0);
    expect(contar({
      slots: [slot()],
      ferias: [{ tipo: 'analista', data_inicio: '2026-09-01', data_fim: '2026-09-10', pacientes: [] }],
    })).toBe(0);
  });

  it('"outros" ocupa a agenda mas não é sessão; grupo é', () => {
    expect(contar({ slots: [slot({ patient_id: null, tipo: 'outros' })] })).toBe(0);
    expect(contar({ slots: [slot({ patient_id: null, tipo: 'sessao_grupo' })] })).toBe(1);
  });

  it('quinzenal fora da semana dele não conta', () => {
    expect(contar({
      slots: [slot({ recorrencia_tipo: 'quinzenal', recorrencia_data_referencia: '2026-08-28', recorrencia_semanas_ativas: [1, 3] })],
    })).toBe(0);
  });

  it('horário livre não conta', () => {
    expect(contar({ slots: [slot({ patient_id: null })] })).toBe(0);
  });
});

describe('resumirSessoes', () => {
  it('conta as que já terminaram e diz quando a próxima termina', () => {
    const agora = new Date(2026, 8, 4, 15, 0);
    const r = resumirSessoes([
      { startTime: '14:00', endTime: '14:50' },
      { startTime: '16:00', endTime: '16:50' },
    ], agora);
    expect(r.total).toBe(2);
    expect(r.concluidas).toBe(1);
    expect(r.proximaMudanca.getHours()).toBe(16);
    expect(r.proximaMudanca.getMinutes()).toBe(50);
  });
});

describe('ocorrenciaValePelaAgenda (Financeiro hoje/semana)', () => {
  it('vale sem nada na agenda', () => {
    expect(ocorrenciaValePelaAgenda(slot(), SEXTA, {})).toBe(true);
  });
  it('cancelada não vale', () => {
    expect(ocorrenciaValePelaAgenda(slot(), SEXTA, { compromissos: [compromisso({ status: 'cancelado' })] })).toBe(false);
  });
  it('apagada só nesse dia não vale', () => {
    expect(ocorrenciaValePelaAgenda(slot(), SEXTA, { liberados: [{ date: SEXTA, start_time: '14:00' }] })).toBe(false);
  });
  it('horário usado por outra pessoa nesse dia não vale', () => {
    expect(ocorrenciaValePelaAgenda(slot(), SEXTA, { compromissos: [compromisso({ patient_id: 'p2' })] })).toBe(false);
  });
});

describe('sessoesForaDaGrade', () => {
  const base = { inicioISO: '2026-08-30', fimISO: '2026-09-05' };
  it('sessão remarcada para outro dia entra no dia novo', () => {
    const itens = sessoesForaDaGrade({
      ...base, slots: [slot()], compromissos: [compromisso({ date: '2026-09-02', patient_preco: '200' })],
    });
    expect(itens).toHaveLength(1);
    expect(itens[0].day_of_week).toBe(3);
  });
  it('sessão no próprio horário fixo não entra de novo', () => {
    expect(sessoesForaDaGrade({ ...base, slots: [slot()], compromissos: [compromisso()] })).toHaveLength(0);
  });
  it('cancelada não entra', () => {
    expect(sessoesForaDaGrade({
      ...base, slots: [], compromissos: [compromisso({ status: 'cancelado' })],
    })).toHaveLength(0);
  });
});

describe('resumoDosHorarios (Horário na ficha)', () => {
  it('monta a partir da grade, segunda primeiro, sem avulso', () => {
    expect(resumoDosHorarios([
      slot({ day_of_week: 0, start_time: '10:00' }),
      slot({ day_of_week: 1, start_time: '14:00', recorrencia_tipo: 'quinzenal' }),
      slot({ day_of_week: 3, start_time: '09:00', recorrencia_tipo: 'avulso' }),
    ])).toBe('Seg 14:00 (quinzenal), Dom 10:00');
  });
  it('sem horário fixo devolve null', () => {
    expect(resumoDosHorarios([])).toBeNull();
  });
});
