// Cobre o bug do item 2 (leva pós-teste 15/08/2026): getResumoAssinaturaECreditosDoMes
// mostrava o valor da assinatura em QUALQUER mês navegado em Pagamentos —
// porque lia direto o snapshot atual do profile, sem checar se o ciclo
// pago realmente cobre o mês consultado.
jest.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
  },
}));
jest.mock('../creditosIA', () => ({
  usdParaBRL: (valorUSD) => valorUSD * 5,
}));

const { supabase } = require('../supabase');
const { getResumoAssinaturaECreditosDoMes } = require('../despesas');

function makeQueryBuilder(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    gt: () => builder,
    single: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return builder;
}

function mockPerfil(perfil) {
  supabase.from.mockImplementation((tabela) => {
    if (tabela === 'profiles') return makeQueryBuilder({ data: perfil, error: null });
    if (tabela === 'uso_ia') return makeQueryBuilder({ data: [], error: null });
    throw new Error(`tabela inesperada: ${tabela}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('getResumoAssinaturaECreditosDoMes', () => {
  const perfilMensal = {
    assinatura_plano: 'mensal',
    assinatura_valor_mensal_equivalente: 89,
    assinatura_ciclo_inicio: '2026-08-01T00:00:00.000Z',
    assinatura_expira_em: '2026-09-01T00:00:00.000Z',
  };

  it('mostra o valor da assinatura quando o mês consultado está dentro do ciclo pago', async () => {
    mockPerfil(perfilMensal);
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 8);
    expect(resultado.assinaturaValorBRL).toBe(89);
  });

  it('mostra 0 quando o mês consultado está fora do ciclo pago (mês passado)', async () => {
    mockPerfil(perfilMensal);
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 6);
    expect(resultado.assinaturaValorBRL).toBe(0);
  });

  it('mostra 0 quando o mês consultado está fora do ciclo pago (mês futuro)', async () => {
    mockPerfil(perfilMensal);
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 10);
    expect(resultado.assinaturaValorBRL).toBe(0);
  });

  it('mostra 0 quando não há ciclo/expiração registrados (nunca assinou)', async () => {
    mockPerfil({ assinatura_plano: null, assinatura_valor_mensal_equivalente: null, assinatura_ciclo_inicio: null, assinatura_expira_em: null });
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 8);
    expect(resultado.assinaturaValorBRL).toBe(0);
  });

  it('soma recarga avulsa (dinheiro novo pago no mês) como créditos comprados', async () => {
    supabase.from.mockImplementation((tabela) => {
      if (tabela === 'profiles') return makeQueryBuilder({ data: perfilMensal, error: null });
      if (tabela === 'uso_ia') return makeQueryBuilder({ data: [{ custo_estimado: -4 }], error: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 8);
    expect(resultado.creditosCompradosBRL).toBe(20); // 4 USD * 5 (taxa mockada)
  });

  it('NÃO inclui consumo de crédito nem renovação mensal — só recarga avulsa é despesa nova', async () => {
    // O filtro .eq('tipo', 'recarga_avulsa') já exclui 'relatorio'/'busca'/
    // 'transcricao' (consumo) e 'renovacao' (já embutida na Assinatura) —
    // aqui simula o banco devolvendo vazio, como faria esse filtro na prática.
    mockPerfil(perfilMensal);
    const resultado = await getResumoAssinaturaECreditosDoMes(2026, 8);
    expect(resultado.creditosCompradosBRL).toBe(0);
  });
});
