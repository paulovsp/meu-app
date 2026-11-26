// Relatório geral da clínica: período escolhido e as contas de sessões e
// dinheiro. As regras precisam bater com Agenda, Cobrança e Saídas.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const {
  periodoDe, deslocarReferencia, rotuloPeriodo, marcaPeriodoAtual, validarPeriodo, mesesDoPeriodo,
  contarSessoesDoPeriodo, resumirPagamentosRecebidos, resumirCobrancas, resumirDespesas,
  resumirMovimentoDePessoas, feriasNoPeriodo, montarTextoRelatorio, formatarReais,
} = require('../relatorioGeral');

// 26/11/2026 é uma quinta-feira.
const AGORA = new Date(2026, 10, 26, 12, 0);

describe('período', () => {
  it('semana vai de domingo a sábado', () => {
    expect(periodoDe('semana', AGORA)).toEqual({ tipo: 'semana', inicioISO: '2026-11-22', fimISO: '2026-11-28' });
  });
  it('mês e ano', () => {
    expect(periodoDe('mes', AGORA)).toMatchObject({ inicioISO: '2026-11-01', fimISO: '2026-11-30' });
    expect(periodoDe('mes', new Date(2028, 1, 10))).toMatchObject({ inicioISO: '2028-02-01', fimISO: '2028-02-29' });
    expect(periodoDe('ano', AGORA)).toMatchObject({ inicioISO: '2026-01-01', fimISO: '2026-12-31' });
  });
  it('anda para trás e para frente', () => {
    expect(periodoDe('semana', deslocarReferencia('semana', AGORA, -1)).inicioISO).toBe('2026-11-15');
    expect(periodoDe('mes', deslocarReferencia('mes', new Date(2026, 0, 31), 1)).inicioISO).toBe('2026-02-01');
    expect(periodoDe('ano', deslocarReferencia('ano', AGORA, 1)).inicioISO).toBe('2027-01-01');
  });
  it('rótulos por extenso, para conferir', () => {
    expect(rotuloPeriodo(periodoDe('semana', AGORA))).toBe('Semana de domingo, 22/11 a sábado, 28/11/2026');
    expect(rotuloPeriodo(periodoDe('mes', AGORA))).toBe('Novembro de 2026');
    expect(rotuloPeriodo(periodoDe('ano', AGORA))).toBe('Ano de 2026');
    expect(rotuloPeriodo({ tipo: 'personalizado', inicioISO: '2026-10-01', fimISO: '2026-11-26' }))
      .toBe('De 01/10/2026 a 26/11/2026');
    expect(marcaPeriodoAtual(periodoDe('semana', AGORA), AGORA)).toBe('esta semana');
    expect(marcaPeriodoAtual(periodoDe('mes', new Date(2026, 9, 1)), AGORA)).toBe('');
  });
  it('valida o período livre', () => {
    expect(validarPeriodo('2026-11-10', '2026-11-01')).toMatch(/anterior/);
    expect(validarPeriodo(null, '2026-11-01')).toMatch(/Preencha/);
    expect(validarPeriodo('2020-01-01', '2026-01-01')).toMatch(/dois anos/);
    expect(validarPeriodo('2026-01-01', '2026-11-01')).toBeNull();
  });
  it('meses que o período toca', () => {
    expect(mesesDoPeriodo('2026-11-29', '2026-12-05')).toEqual([{ ano: 2026, mes: 10 }, { ano: 2026, mes: 11 }]);
    expect(mesesDoPeriodo('2026-12-20', '2027-01-03')).toEqual([{ ano: 2026, mes: 11 }, { ano: 2027, mes: 0 }]);
  });
});

const slotQuinta = (extra = {}) => ({
  id: 's1', day_of_week: 4, start_time: '10:00', end_time: '10:50', modality: 'presencial',
  patient_id: 'p1', patient_name: 'Ana Souza', tipo: 'sessao_individual', recorrencia_tipo: 'semanal', ...extra,
});
const compromisso = (extra = {}) => ({
  id: `c-${Math.random()}`, start_time: '10:00', end_time: '10:50', modality: 'presencial',
  patient_id: 'p1', patient_nome: 'Ana Souza', tipo: 'sessao_individual', participantes: [], ...extra,
});

describe('contarSessoesDoPeriodo', () => {
  const base = { liberados: [], ferias: [], agora: AGORA };

  it('conta cada compromisso pelo status e soma as agendadas', () => {
    const r = contarSessoesDoPeriodo({
      ...base,
      slots: [],
      compromissos: [
        compromisso({ date: '2026-11-02', status: 'realizado' }),
        compromisso({ date: '2026-11-05', status: 'nao_realizado' }),
        compromisso({ date: '2026-11-12', status: 'cancelado' }),
        compromisso({ date: '2026-11-19', status: 'agendado' }), // passou sem confirmar
        compromisso({ date: '2026-11-27', status: 'agendado' }), // ainda vem
        compromisso({ date: '2026-11-10', status: 'realizado', tipo: 'outros', titulo: 'Reunião' }),
      ],
      inicioISO: '2026-11-01',
      fimISO: '2026-11-30',
    });
    expect(r).toMatchObject({
      realizadas: 1, faltas: 1, canceladas: 1, aguardando: 1, porVir: 1, agendadas: 5, outros: 1,
      comparecimento: 50,
    });
    expect(r.porPessoa).toHaveLength(1);
    expect(r.porPessoa[0]).toMatchObject({ nome: 'Ana Souza', realizadas: 1, faltas: 1, canceladas: 1 });
    expect(r.porTipo).toEqual({ sessao_individual: 1 });
    expect(r.porDiaSemana[1]).toBe(1); // 02/11 foi segunda
  });

  it('passado sem compromisso não vira sessão; futuro projeta a grade', () => {
    const r = contarSessoesDoPeriodo({
      ...base, slots: [slotQuinta()], compromissos: [], inicioISO: '2026-11-01', fimISO: '2026-11-30',
    });
    // Quintas: 05, 12, 19 (passadas, nada), 26 (hoje, ainda não terminou às 12h? terminou às 10:50).
    expect(r.aguardando).toBe(1);
    expect(r.porVir).toBe(0);
    expect(r.agendadas).toBe(1);
  });

  it('horário apagado ou remarcado conta como desmarcado, mesmo no passado', () => {
    const r = contarSessoesDoPeriodo({
      ...base,
      slots: [slotQuinta()],
      compromissos: [compromisso({ date: '2026-11-13', status: 'realizado' })], // remarcada para sexta
      liberados: [{ date: '2026-11-12', start_time: '10:00' }, { date: '2026-12-03', start_time: '10:00' }],
      inicioISO: '2026-11-08',
      fimISO: '2026-12-05',
    });
    expect(r.desmarcadas).toBe(2);
    expect(r.realizadas).toBe(1);
    expect(r.porVir).toBe(0); // 03/12 foi desmarcado
    expect(r.aguardando).toBe(1); // hoje, 26/11
  });

  it('férias e análise paralisada', () => {
    const ferias = [{ tipo: 'cliente', patient_id: 'p1', data_inicio: '2026-12-01', data_fim: '2026-12-15', paga: false }];
    const r = contarSessoesDoPeriodo({
      ...base, ferias, slots: [slotQuinta(), slotQuinta({ id: 's2', start_time: '11:00', patient_id: 'p2', patient_name: 'Bia' })],
      compromissos: [],
      paralisadas: { p2: '2026-12-01' },
      inicioISO: '2026-11-29', fimISO: '2026-12-31',
    });
    // Ana: 03 e 10/12 em férias; 17, 24, 31 por vir. Bia: parada desde 01/12, nada.
    expect(r.ferias).toBe(2);
    expect(r.porVir).toBe(3);
    expect(r.porPessoa.map((p) => p.nome)).toEqual(['Ana Souza']);
  });

  it('quinzenal: a semana de folga é horário temporariamente livre, não sessão', () => {
    const quinzenal = slotQuinta({ recorrencia_tipo: 'quinzenal', recorrencia_data_referencia: '2026-11-05', recorrencia_semanas_ativas: [1, 3] });
    const r = contarSessoesDoPeriodo({
      ...base, slots: [quinzenal], compromissos: [], inicioISO: '2026-11-29', fimISO: '2026-12-26',
    });
    // 03/12 (semana 5 → ciclo 1, ativa), 10/12 (2, folga), 17/12 (3, ativa), 24/12 (4, folga)
    expect(r.porVir).toBe(2);
    expect(r.temporariamenteLivres).toBe(2);
  });

  it('grupo conta uma sessão, com o nome do grupo', () => {
    const r = contarSessoesDoPeriodo({
      ...base, slots: [],
      compromissos: [compromisso({
        date: '2026-11-03', status: 'realizado', tipo: 'sessao_grupo', patient_id: null, patient_nome: null,
        participantes: [{ id: 'p1', nome: 'Ana Souza' }, { id: 'p2', nome: 'Bia Lima' }],
      })],
      inicioISO: '2026-11-01', fimISO: '2026-11-30',
    });
    expect(r.realizadas).toBe(1);
    expect(r.porPessoa[0].nome).toBe('Grupo (Ana, Bia)');
    expect(r.pessoasAtendidas).toBe(0);
  });
});

describe('dinheiro', () => {
  it('soma os pagamentos recebidos e separa os sem valor', () => {
    const r = resumirPagamentosRecebidos([
      { patient_id: 'p1', patient_nome: 'Ana', valor: 200 },
      { patient_id: 'p1', patient_nome: 'Ana', valor: 150.5 },
      { patient_id: 'p2', patient_nome: 'Bia', valor: null },
    ]);
    expect(r).toMatchObject({ total: 350.5, quantidade: 3, semValor: 1 });
    expect(r.porPessoa[0]).toMatchObject({ nome: 'Ana', valor: 350.5, quantidade: 2 });
  });

  it('cobranças: recebido, em atraso e a vencer', () => {
    const r = resumirCobrancas([{
      ano: 2026, mes: 10,
      recebimentos: [
        { nome: 'Ana', tipo_cobranca: 'mensal', valorPrevisto: 800, recebido: true, dia_pagamento: 5 },
        { nome: 'Bia', tipo_cobranca: 'mensal', valorPrevisto: 600, recebido: false, dia_pagamento: 10 },
        { nome: 'Caio', tipo_cobranca: 'mensal_fixo', valorPrevisto: 500, recebido: false, dia_pagamento: 30 },
        {
          nome: 'Duda', tipo_cobranca: 'por_sessao', valorPrevisto: 400, valorRecebido: 200, valorEmAberto: 200,
          valorFuturo: 200, sessoesCobraveis: 2, sessoesEmAberto: 1,
        },
        { nome: 'Eva', tipo_cobranca: 'por_sessao', sessoesCobraveis: 0, valorFuturo: 300 }, // sem sessão: fora
        { nome: 'Fábio', tipo_cobranca: 'mensal', valorPrevisto: 0, recebido: false, dia_pagamento: 5 }, // nada a cobrar
      ],
    }], AGORA);
    expect(r).toMatchObject({ previsto: 800 + 600 + 500 + 600, recebido: 1000, emAtraso: 800, aVencer: 700 });
    expect(r.pendencias.map((p) => `${p.nome}:${p.situacao}`)).toEqual(['Bia:atrasado', 'Duda:atrasado', 'Caio:a_vencer']);
  });

  it('despesas por categoria', () => {
    const r = resumirDespesas([
      { categoria: 'aluguel', valor: '1200' }, { categoria: 'contas', valor: 100 }, { categoria: 'contas', valor: 50 },
    ]);
    expect(r.total).toBe(1350);
    expect(r.porCategoria).toEqual([{ label: 'Aluguel', valor: 1200 }, { label: 'Contas', valor: 150 }]);
  });

  it('formata reais com milhar', () => {
    expect(formatarReais(12345.6)).toBe('R$ 12.345,60');
  });
});

describe('pessoas e férias', () => {
  it('quem começou, parou e voltou no período', () => {
    const r = resumirMovimentoDePessoas({
      pacientes: [
        { id: 'p1', nome: 'Ana', data_inicio: '2026-11-03' },
        { id: 'p2', nome: 'Bia', data_inicio: '2025-01-01' },
      ],
      paralizacoes: [
        { patient_id: 'p2', data_inicio: '2026-11-10', data_fim: null },
        { patient_id: 'p1', data_inicio: '2026-10-01', data_fim: '2026-11-20' },
      ],
      inicioISO: '2026-11-01', fimISO: '2026-11-30',
    });
    expect(r).toEqual({ comecaram: ['Ana'], pararam: ['Bia'], voltaram: ['Ana'] });
  });

  it('férias que tocam o período', () => {
    const r = feriasNoPeriodo([
      { tipo: 'analista', data_inicio: '2026-12-20', data_fim: '2027-01-10', paga: true },
      { tipo: 'cliente', patient_nome: 'Ana', data_inicio: '2026-10-01', data_fim: '2026-10-10', paga: false },
    ], '2026-12-01', '2026-12-31');
    expect(r).toEqual([{ quem: 'Suas férias', inicioISO: '2026-12-20', fimISO: '2027-01-10', paga: null }]);
  });
});

it('monta o texto para compartilhar', () => {
  const sessoes = contarSessoesDoPeriodo({
    slots: [], compromissos: [], liberados: [], inicioISO: '2026-11-01', fimISO: '2026-11-30', agora: AGORA,
  });
  const texto = montarTextoRelatorio({
    periodo: { tipo: 'mes', inicioISO: '2026-11-01', fimISO: '2026-11-30' },
    sessoes,
    recebidos: resumirPagamentosRecebidos([]),
    despesas: resumirDespesas([]),
    cobrancas: resumirCobrancas([], AGORA),
    mesesCobranca: [{ ano: 2026, mes: 10 }],
  });
  expect(texto).toContain('Novembro de 2026');
  expect(texto).toContain('Cobranças de novembro/2026');
});
