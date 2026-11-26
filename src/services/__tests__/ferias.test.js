// Férias do analista e do cliente: quem paga, o que cobra, o que a agenda
// marca como férias.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const {
  feriasNaData, horarioFicaEmFerias, sessaoCobravelComFerias, sessaoPrevistaComFerias,
  ocorrenciaContaComFerias, validarFerias, resumoPagamentoFerias, formatarPeriodoFerias,
  valorMensalFixoComFerias, datasDoPeriodo, STATUS_FERIAS,
} = require('../ferias');
const { projetarOcorrenciasFuturas, contarOcorrenciasAtivasNoMes } = require('../database');

// Férias do analista em janeiro: Ana paga, Bruno não paga; quem não está na
// lista segue o padrão (não paga).
const doAnalista = {
  id: 'fa', tipo: 'analista', patient_id: null, data_inicio: '2027-01-04', data_fim: '2027-01-31',
  paga: false, pacientes: [{ patient_id: 'ana', paga: true }, { patient_id: 'bruno', paga: false }],
};
// Carla tira duas semanas pagas em dezembro; Davi, uma semana não paga.
const daCarla = { id: 'fc', tipo: 'cliente', patient_id: 'carla', data_inicio: '2026-12-07', data_fim: '2026-12-20', paga: true };
const doDavi = { id: 'fd', tipo: 'cliente', patient_id: 'davi', data_inicio: '2026-12-07', data_fim: '2026-12-13', paga: false };
const ferias = [doAnalista, daCarla, doDavi];

describe('feriasNaData', () => {
  it('férias do analista: vale a escolha de cada cliente', () => {
    expect(feriasNaData(ferias, 'ana', '2027-01-10')).toEqual({ feriasId: 'fa', tipo: 'analista', paga: true });
    expect(feriasNaData(ferias, 'bruno', '2027-01-10').paga).toBe(false);
  });

  it('quem não estava na lista segue o padrão das férias', () => {
    expect(feriasNaData(ferias, 'novo', '2027-01-10').paga).toBe(false);
    const pagasParaTodos = { ...doAnalista, paga: true, pacientes: [] };
    expect(feriasNaData([pagasParaTodos], 'novo', '2027-01-10').paga).toBe(true);
  });

  it('férias do cliente só valem para ele e dentro do período (inclusive)', () => {
    expect(feriasNaData(ferias, 'carla', '2026-12-07').paga).toBe(true);
    expect(feriasNaData(ferias, 'carla', '2026-12-20').paga).toBe(true);
    expect(feriasNaData(ferias, 'carla', '2026-12-21')).toBeNull();
    expect(feriasNaData(ferias, 'ana', '2026-12-10')).toBeNull();
  });

  it('férias do analista vêm antes das do cliente no mesmo dia', () => {
    const carlaEmJaneiro = { ...daCarla, id: 'fc2', data_inicio: '2027-01-04', data_fim: '2027-01-10' };
    expect(feriasNaData([doAnalista, carlaEmJaneiro], 'carla', '2027-01-05').tipo).toBe('analista');
  });
});

describe('horarioFicaEmFerias', () => {
  const individual = { patient_id: 'carla', tipo: 'sessao_individual' };
  it('nas férias do analista tudo para, até grupo e "outros"', () => {
    expect(horarioFicaEmFerias({ patient_id: null, tipo: 'sessao_grupo' }, '2027-01-05', ferias)).toBe(true);
    expect(horarioFicaEmFerias({ patient_id: null, tipo: 'outros' }, '2027-01-05', ferias)).toBe(true);
  });
  it('nas férias do cliente só o horário individual dele', () => {
    expect(horarioFicaEmFerias(individual, '2026-12-10', ferias)).toBe(true);
    expect(horarioFicaEmFerias({ patient_id: 'ana', tipo: 'sessao_individual' }, '2026-12-10', ferias)).toBe(false);
    expect(horarioFicaEmFerias(individual, '2026-12-28', ferias)).toBe(false);
  });
});

describe('cobrança com férias', () => {
  it('férias paga cobra; não paga não cobra', () => {
    expect(sessaoCobravelComFerias({ status: STATUS_FERIAS, patientId: 'carla', date: '2026-12-10' }, ferias)).toBe(true);
    expect(sessaoCobravelComFerias({ status: STATUS_FERIAS, patientId: 'davi', date: '2026-12-10' }, ferias)).toBe(false);
    expect(sessaoPrevistaComFerias({ status: STATUS_FERIAS, patientId: 'davi', date: '2026-12-10' }, ferias)).toBe(false);
  });

  it('compromisso em férias sem férias gravada (apagada) não cobra', () => {
    expect(sessaoCobravelComFerias({ status: STATUS_FERIAS, patientId: 'carla', date: '2026-11-02' }, ferias)).toBe(false);
  });

  it('fora das férias, a régua de sempre', () => {
    expect(sessaoCobravelComFerias({ status: 'realizado', patientId: 'davi', date: '2026-11-02' }, ferias)).toBe(true);
    expect(sessaoCobravelComFerias({ status: 'cancelado', patientId: 'davi', date: '2026-11-02' }, ferias)).toBe(false);
    expect(sessaoPrevistaComFerias({ status: 'agendado', patientId: 'davi', date: '2026-11-02' }, ferias)).toBe(true);
  });

  it('no grupo que seguiu sem a pessoa de férias, vale o paga/não paga dela', () => {
    expect(sessaoCobravelComFerias({ status: 'realizado', patientId: 'davi', date: '2026-12-10', emGrupo: true }, ferias)).toBe(false);
    expect(sessaoCobravelComFerias({ status: 'realizado', patientId: 'carla', date: '2026-12-10', emGrupo: true }, ferias)).toBe(true);
  });

  it('ocorrência futura: só entra se as férias forem pagas', () => {
    expect(ocorrenciaContaComFerias('davi', '2026-12-08', ferias)).toBe(false);
    expect(ocorrenciaContaComFerias('carla', '2026-12-08', ferias)).toBe(true);
    expect(ocorrenciaContaComFerias('davi', '2026-12-15', ferias)).toBe(true);
  });
});

describe('financeiro com férias', () => {
  // Terça-feira (day_of_week 2), semanal. Dezembro/2026 tem 5 terças: 1, 8, 15, 22, 29.
  const slotDavi = { id: 's1', day_of_week: 2, start_time: '10:00', patient_id: 'davi', recorrencia_tipo: 'semanal' };
  const slotCarla = { ...slotDavi, id: 's2', start_time: '11:00', patient_id: 'carla' };

  it('previsto do mês tira as sessões de férias não pagas', () => {
    expect(contarOcorrenciasAtivasNoMes(slotDavi, 2026, 11)).toBe(5);
    expect(contarOcorrenciasAtivasNoMes(slotDavi, 2026, 11, ferias)).toBe(4);
    expect(contarOcorrenciasAtivasNoMes(slotCarla, 2026, 11, ferias)).toBe(5);
  });

  it('projeção de sessões futuras respeita as férias', () => {
    const contagem = projetarOcorrenciasFuturas({
      slots: [slotDavi, slotCarla], ocupadas: new Set(), liberadas: new Set(),
      ano: 2026, mesIndex: 11, hoje: '2026-12-01', ferias,
    });
    expect(contagem).toEqual({ davi: 4, carla: 5 });
  });

  it('mensalidade fixa: desconto proporcional às sessões de férias não pagas', () => {
    expect(valorMensalFixoComFerias(1000, ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22'], 'davi', ferias)).toBe(750);
    expect(valorMensalFixoComFerias(1000, ['2026-12-01', '2026-12-08'], 'carla', ferias)).toBe(1000);
    expect(valorMensalFixoComFerias(1000, [], 'davi', ferias)).toBe(1000);
  });
});

describe('validarFerias', () => {
  it('confere datas e sobreposição do mesmo tipo', () => {
    expect(validarFerias({ tipo: 'analista', data_inicio: '2027-02-10', data_fim: '2027-02-01' })).toMatch(/antes do início/);
    expect(validarFerias({ tipo: 'cliente', data_inicio: '2027-02-01', data_fim: '2027-02-10' })).toMatch(/de quem/);
    expect(validarFerias({ tipo: 'analista', data_inicio: '2027-01-20', data_fim: '2027-02-10' }, ferias)).toMatch(/sobrepõem/);
    expect(validarFerias({ tipo: 'analista', data_inicio: '2027-02-01', data_fim: '2027-02-10' }, ferias)).toBeNull();
    // Editar a própria férias não conflita consigo mesma.
    expect(validarFerias({ ...doAnalista, data_fim: '2027-02-05' }, ferias)).toBeNull();
    // Férias do cliente não conflitam com as do analista nem com as de outro cliente.
    expect(validarFerias({ tipo: 'cliente', patient_id: 'ana', data_inicio: '2026-12-07', data_fim: '2026-12-10' }, ferias)).toBeNull();
    expect(validarFerias({ tipo: 'cliente', patient_id: 'carla', data_inicio: '2026-12-19', data_fim: '2026-12-30' }, ferias)).toMatch(/sobrepõem/);
  });
});

describe('textos', () => {
  it('resumo de quem paga', () => {
    expect(resumoPagamentoFerias(doAnalista)).toBe('Parcialmente pagas (1 de 2 pagam)');
    expect(resumoPagamentoFerias({ tipo: 'analista', paga: true, pacientes: [{ patient_id: 'a', paga: true }] })).toBe('Pagas');
    expect(resumoPagamentoFerias({ tipo: 'analista', paga: false, pacientes: [{ patient_id: 'a', paga: false }] })).toBe('Não pagas');
    expect(resumoPagamentoFerias(daCarla)).toBe('Paga');
  });

  it('período', () => {
    expect(formatarPeriodoFerias('2027-01-04', '2027-01-31')).toBe('04/01 a 31/01');
    expect(formatarPeriodoFerias('2026-12-28', '2027-01-08')).toBe('28/12/2026 a 08/01/2027');
    expect(datasDoPeriodo('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
