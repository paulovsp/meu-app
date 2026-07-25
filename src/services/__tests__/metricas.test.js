const {
  calcularDensidadePorNucleo,
  calcularDefesasPorAsa,
  calcularIndiceRetorno,
  calcularMobilidade,
  rankearGatilhos,
  detectarAusencias,
} = require('../metricas');

describe('calcularDensidadePorNucleo', () => {
  test('soma intensidade por núcleo e normaliza em %, excluindo eu_nuclear da base', () => {
    const evidencias = [
      { nucleo: 'bem', intensidade: 3 },
      { nucleo: 'bem', intensidade: 1 },
      { nucleo: 'mal', intensidade: 2 },
      { nucleo: 'eu_nuclear', intensidade: 3 }, // não entra na base
    ];
    const pct = calcularDensidadePorNucleo(evidencias);
    // total considerado = 3+1+2 = 6 -> bem=4/6=67%, mal=2/6=33%
    expect(pct.bem).toBe(67);
    expect(pct.mal).toBe(33);
    expect(pct.mau).toBe(0);
    expect(pct.bom).toBe(0);
  });

  test('lista vazia devolve tudo zero, sem dividir por zero', () => {
    expect(calcularDensidadePorNucleo([])).toEqual({ bem: 0, mal: 0, mau: 0, bom: 0 });
  });
});

describe('calcularDefesasPorAsa', () => {
  test('transição diagonal conta 1 para eu_nuclear', () => {
    const transicoes = [{ de_nucleo: 'bem', para_nucleo: 'bom', diagonal_direta: true }];
    const asas = calcularDefesasPorAsa(transicoes);
    expect(asas.eu_nuclear).toBe(1);
    expect(asas.ego + asas.id + asas.superego + asas.superid).toBe(0);
  });

  test('transição não-diagonal ambígua (2 candidatas) divide 0.5/0.5', () => {
    // bem->mal: candidatas topologicamente possíveis = ego, id
    const transicoes = [{ de_nucleo: 'bem', para_nucleo: 'mal', diagonal_direta: false }];
    const asas = calcularDefesasPorAsa(transicoes);
    expect(asas.ego).toBe(0.5);
    expect(asas.id).toBe(0.5);
    expect(asas.superego).toBe(0);
    expect(asas.superid).toBe(0);
  });

  test('acumula corretamente ao longo de várias transições', () => {
    const transicoes = [
      { de_nucleo: 'bem', para_nucleo: 'mal', diagonal_direta: false }, // ego+0.5, id+0.5
      { de_nucleo: 'bem', para_nucleo: 'mal', diagonal_direta: false }, // ego+0.5, id+0.5
      { de_nucleo: 'mal', para_nucleo: 'mau', diagonal_direta: true }, // eu_nuclear+1
    ];
    const asas = calcularDefesasPorAsa(transicoes);
    expect(asas.ego).toBe(1);
    expect(asas.id).toBe(1);
    expect(asas.eu_nuclear).toBe(1);
  });
});

describe('calcularIndiceRetorno', () => {
  test('replica o exemplo de referência (Mal->Bem vs Mal->Bom)', () => {
    const transicoes = [
      { de_nucleo: 'mal', para_nucleo: 'bem' },
      { de_nucleo: 'mal', para_nucleo: 'bem' },
      { de_nucleo: 'mal', para_nucleo: 'bem' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'mal', para_nucleo: 'mau' },
      { de_nucleo: 'bem', para_nucleo: 'mal' }, // não conta (origem != mal)
    ];
    expect(calcularIndiceRetorno(transicoes)).toBe(0.3);
  });

  test('sem transições da origem, devolve null', () => {
    expect(calcularIndiceRetorno([{ de_nucleo: 'bem', para_nucleo: 'mal' }])).toBeNull();
  });
});

describe('calcularMobilidade', () => {
  test('divide transições por sessões', () => {
    expect(calcularMobilidade(8, 21)).toBe(0.38);
  });

  test('nunca passa de 1 (normalizado)', () => {
    expect(calcularMobilidade(50, 10)).toBe(1);
  });

  test('zero sessões não quebra (divisão por zero)', () => {
    expect(calcularMobilidade(5, 0)).toBe(0);
  });
});

describe('rankearGatilhos', () => {
  test('agrupa por trecho literal (case-insensitive) e ordena por frequência', () => {
    const transicoes = [
      { gatilho_trecho: 'Ameaça de perda do objeto' },
      { gatilho_trecho: 'ameaça de perda do objeto' },
      { gatilho_trecho: 'Exposição ao julgamento' },
      { gatilho_trecho: 'Ameaça de perda do objeto' },
      { gatilho_trecho: null },
    ];
    const rank = rankearGatilhos(transicoes);
    expect(rank[0].contagem).toBe(3);
    expect(rank[0].trecho).toBe('Ameaça de perda do objeto');
    expect(rank[1].contagem).toBe(1);
  });
});

describe('detectarAusencias', () => {
  test('detecta núcleos sem nenhuma evidência na janela de sessões recentes', () => {
    const evidencias = [
      { nucleo: 'bem', data_sessao: '2026-01-01' },
      { nucleo: 'mal', data_sessao: '2026-01-08' },
      { nucleo: 'bem', data_sessao: '2025-01-01' }, // fora da janela
    ];
    const ausencias = detectarAusencias(evidencias, ['2026-01-01', '2026-01-08', '2026-01-15']);
    expect(ausencias.sort()).toEqual(['bom', 'mau']);
  });

  test('sem janela de sessões, devolve lista vazia (não gera pergunta indevida)', () => {
    expect(detectarAusencias([{ nucleo: 'bem', data_sessao: '2026-01-01' }], [])).toEqual([]);
  });
});
