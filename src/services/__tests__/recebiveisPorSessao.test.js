// Status de cobrança no Recebíveis, com atenção à modalidade "por sessão".
//
// Testado porque aqui erro vira dinheiro que ninguém vai cobrar. Até
// 05/09/2026 quem pagava por sessão era um grupo à parte na tela e NUNCA
// aparecia como devendo: o "recebido" era `valor > 0`, ou seja, "recebi
// alguma coisa" — analisante com 4 sessões e 1 paga contava como quitado, e
// as outras 3 sumiam de todo card e resumo.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const {
  calcularStatusItemRecebimento,
  calcularStatusGeralRecebimentos,
  filtrarRecebimentosMensais,
  diasDesdeSessaoEmAberto,
} = require('../database');

function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HOJE = diasAtras(0);

function porSessao(extra = {}) {
  return {
    patient_id: 'p1', nome: 'Ana', tipo_cobranca: 'por_sessao',
    sessoesCobraveis: 0, sessoesPagas: 0, sessoesEmAberto: 0,
    primeiraSessaoEmAberto: null, recebido: false, ...extra,
  };
}

describe('diasDesdeSessaoEmAberto', () => {
  it('conta os dias desde a sessão não paga mais antiga', () => {
    expect(diasDesdeSessaoEmAberto(porSessao({ primeiraSessaoEmAberto: HOJE }))).toBe(0);
    expect(diasDesdeSessaoEmAberto(porSessao({ primeiraSessaoEmAberto: diasAtras(9) }))).toBe(9);
  });

  it('devolve null quando não há nada em aberto', () => {
    expect(diasDesdeSessaoEmAberto(porSessao())).toBeNull();
    expect(diasDesdeSessaoEmAberto(null)).toBeNull();
  });
});

describe('calcularStatusItemRecebimento — por sessão', () => {
  // O caso que motivou a correção inteira.
  it('sessão paga não quita as que continuam em aberto', () => {
    const item = porSessao({
      sessoesCobraveis: 4, sessoesPagas: 1, sessoesEmAberto: 3,
      primeiraSessaoEmAberto: diasAtras(10),
    });
    expect(calcularStatusItemRecebimento(item)).toBe('vermelho');
  });

  it('fica verde só quando não sobra nenhuma em aberto', () => {
    const item = porSessao({
      sessoesCobraveis: 3, sessoesPagas: 3, sessoesEmAberto: 0, recebido: true,
    });
    expect(calcularStatusItemRecebimento(item)).toBe('verde');
  });

  it('sessão de hoje ainda não paga é pendência, não atraso', () => {
    const item = porSessao({ sessoesCobraveis: 1, sessoesEmAberto: 1, primeiraSessaoEmAberto: HOJE });
    expect(calcularStatusItemRecebimento(item)).toBe('amarelo');
  });

  // Quem não teve sessão no mês não deve nada — diferente de "deve e não
  // pagou".
  it('sem sessão cobrável no mês não é pendência', () => {
    expect(calcularStatusItemRecebimento(porSessao())).toBe('verde');
  });
});

describe('calcularStatusGeralRecebimentos', () => {
  it('acusa vermelho por sessão acumulada não paga', () => {
    const lista = [porSessao({
      sessoesCobraveis: 2, sessoesEmAberto: 2, primeiraSessaoEmAberto: diasAtras(5),
    })];
    expect(calcularStatusGeralRecebimentos(lista)).toBe('vermelho');
  });

  it('não deixa analisante sem sessão no mês sujar o resumo', () => {
    expect(calcularStatusGeralRecebimentos([porSessao()])).toBe('verde');
  });

  // Mistura das duas modalidades: basta uma pendência real pra sair do verde.
  it('soma as duas modalidades no mesmo resumo', () => {
    const lista = [
      { patient_id: 'm1', tipo_cobranca: 'mensal', dia_pagamento: 5, recebido: true },
      porSessao({ sessoesCobraveis: 1, sessoesEmAberto: 1, primeiraSessaoEmAberto: HOJE }),
    ];
    expect(calcularStatusGeralRecebimentos(lista)).toBe('amarelo');
  });
});

describe('filtrarRecebimentosMensais', () => {
  // Antes esta função excluía TODA cobrança por sessão — era por isso que
  // ela nunca aparecia como pendência em card nenhum.
  it('mantém quem paga por sessão e teve sessão no mês', () => {
    const lista = [porSessao({ sessoesCobraveis: 2, sessoesEmAberto: 2 })];
    expect(filtrarRecebimentosMensais(lista)).toHaveLength(1);
  });

  it('descarta quem paga por sessão e não teve sessão no mês', () => {
    expect(filtrarRecebimentosMensais([porSessao()])).toHaveLength(0);
  });

  it('mantém a cobrança mensal sempre', () => {
    const lista = [{ patient_id: 'm1', tipo_cobranca: 'mensal', dia_pagamento: 10, recebido: false }];
    expect(filtrarRecebimentosMensais(lista)).toHaveLength(1);
  });
});
