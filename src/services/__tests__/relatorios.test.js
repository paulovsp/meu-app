// Cobre a reescrita dos relatórios (conversa de 21/08/2026): o bug real era
// "Resumo das últimas sessões" olhar só a tabela `sessions` — um analisante
// com só registros manuais (Novo Registro), sem nenhuma sessão gravada,
// nunca conseguia gerar esse relatório mesmo tendo material de sobra.
// Também cobre que frequência/pagamento agora são gerados localmente, sem
// nenhuma chamada à Edge Function `ia-busca` (sem custo, sem depender de
// crédito/assinatura).
jest.mock('../database', () => ({
  getSessions: jest.fn(),
  getRecords: jest.fn(),
  getAppointmentsByPatient: jest.fn(),
  getPagamentosPorPaciente: jest.fn(),
  getHistoricoParalizacoes: jest.fn(),
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

const {
  getSessions, getRecords, getAppointmentsByPatient, getPagamentosPorPaciente,
  getHistoricoParalizacoes,
} = require('../database');
const { supabase } = require('../supabase');
const { estimarCustoRelatorio, gerarRelatorio } = require('../relatorios');

const paciente = { id: 'p1', nome: 'Fulano de Tal', data_inicio: '2023-01-10', dia_pagamento: 10 };

function mockInsertRelatorios(conteudoEsperado) {
  supabase.from.mockImplementation((tabela) => {
    if (tabela !== 'relatorios') throw new Error(`tabela inesperada: ${tabela}`);
    return {
      insert: (registro) => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'r1', ...registro }, error: null }),
        }),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resumo das últimas sessões — bug de analisante só com registros', () => {
  it('não lança erro e gera o relatório quando não há sessões, só registros', async () => {
    getSessions.mockResolvedValue([]);
    getRecords.mockResolvedValue([
      { date: '2026-08-01', type: 'registro', title: 'Anotação', content: '<p>Conteúdo relevante.</p>' },
    ]);
    mockInsertRelatorios();
    supabase.functions.invoke.mockResolvedValue({ data: { resposta: 'Resumo gerado.', custo: 0.001 }, error: null });

    await expect(
      estimarCustoRelatorio(paciente, 'ultimas_sessoes', { quantidade: 3 })
    ).resolves.not.toThrow();

    const relatorio = await gerarRelatorio(paciente, 'ultimas_sessoes', { quantidade: 3 });
    expect(relatorio.conteudo).toBe('Resumo gerado.');

    const mensagens = supabase.functions.invoke.mock.calls[0][1].body.mensagens;
    const mensagemUsuario = mensagens.find((m) => m.role === 'user');
    expect(mensagemUsuario.content).toContain('Conteúdo relevante');
  });

  it('ainda lança erro quando não há sessões NEM registros', async () => {
    getSessions.mockResolvedValue([]);
    getRecords.mockResolvedValue([]);

    await expect(
      estimarCustoRelatorio(paciente, 'ultimas_sessoes', { quantidade: 3 })
    ).rejects.toThrow(/ainda não tem sessões ou registros/);
  });
});

describe('relatórios locais (frequência e pagamento) — sem chamada à IA', () => {
  it('gera o relatório de frequência sem invocar ia-busca, com custo zero', async () => {
    getAppointmentsByPatient.mockResolvedValue([
      { date: '2026-08-01', start_time: '10:00', status: 'realizado' },
      { date: '2026-08-08', start_time: '10:00', status: 'nao_realizado' },
      { date: '2026-08-15', start_time: '10:00', status: 'realizado' },
    ]);
    mockInsertRelatorios();

    const relatorio = await gerarRelatorio(paciente, 'frequencia', {});

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(relatorio.custo_estimado).toBe(0);
    expect(relatorio.conteudo).toContain('Realizados: 2');
    expect(relatorio.conteudo).toContain('Faltas: 1');
  });

  it('gera o relatório de pagamento sem invocar ia-busca, com custo zero', async () => {
    getPagamentosPorPaciente.mockResolvedValue([
      { ano: 2026, mes: 6, recebido: true, data_recebimento: '2026-06-10', valor: 200 },
      { ano: 2026, mes: 7, recebido: false, valor: 200 },
    ]);
    mockInsertRelatorios();

    const relatorio = await gerarRelatorio(paciente, 'pagamento', {});

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(relatorio.custo_estimado).toBe(0);
    expect(relatorio.conteudo).toContain('Em aberto: 1');
  });

  it('estimarCustoRelatorio retorna 0 pros tipos locais sem montar mensagens de IA', async () => {
    getAppointmentsByPatient.mockResolvedValue([{ date: '2026-08-01', start_time: '10:00', status: 'realizado' }]);
    const custo = await estimarCustoRelatorio(paciente, 'frequencia', {});
    expect(custo).toBe(0);
  });
});

describe('resumo geral do caso — combina sessões e registros sem truncar conteúdo', () => {
  it('inclui o texto completo, sem cortar em 800/400 caracteres como antes', async () => {
    const transcricaoLonga = 'A'.repeat(2000);
    getSessions.mockResolvedValue([{ date: '2026-01-01', type: 'presencial', transcript: transcricaoLonga }]);
    getRecords.mockResolvedValue([]);
    getHistoricoParalizacoes.mockResolvedValue([]);
    mockInsertRelatorios();
    supabase.functions.invoke.mockResolvedValue({ data: { resposta: 'ok', custo: 0 }, error: null });

    await gerarRelatorio(paciente, 'resumo_geral', {});

    const mensagens = supabase.functions.invoke.mock.calls[0][1].body.mensagens;
    const mensagemUsuario = mensagens.find((m) => m.role === 'user');
    expect(mensagemUsuario.content).toContain(transcricaoLonga);
  });

  it('usa data_inicio/data_fim (colunas reais de patient_paralizacoes) — não data_paralizacao/data_retorno', async () => {
    getSessions.mockResolvedValue([]);
    getRecords.mockResolvedValue([{ date: '2026-01-01', type: 'estudo', content: 'x' }]);
    getHistoricoParalizacoes.mockResolvedValue([
      { data_inicio: '2025-03-01', data_fim: '2025-06-15' },
      { data_inicio: '2026-02-01', data_fim: null },
    ]);
    mockInsertRelatorios();
    supabase.functions.invoke.mockResolvedValue({ data: { resposta: 'ok', custo: 0 }, error: null });

    await gerarRelatorio(paciente, 'resumo_geral', {});

    const mensagens = supabase.functions.invoke.mock.calls[0][1].body.mensagens;
    const mensagemUsuario = mensagens.find((m) => m.role === 'user');
    expect(mensagemUsuario.content).toContain('Paralização em 01/03/2025, retorno em 15/06/2025');
    expect(mensagemUsuario.content).toContain('Paralização em 01/02/2026 (ainda em aberto)');
    expect(mensagemUsuario.content).not.toContain('Paralização em —');
  });
});
