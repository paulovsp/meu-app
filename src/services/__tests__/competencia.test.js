// A qual mês uma cobrança se refere, e em que dia vence.
//
// Testado porque é o que decide em QUE MÊS o dinheiro aparece. Até
// 05/09/2026 o app somava sempre as sessões do mesmo mês da cobrança —
// então, para quem recebe no começo do mês (a maioria), o valor exibido era
// o do mês errado.
const {
  mesDeCompetencia, mesDeCobranca, diaDeVencimento, rotuloCompetencia,
  sessaoEhCobravel, sessaoContaComoPrevista, MODOS_DIA_PAGAMENTO,
} = require('../competencia');

describe('mesDeCompetencia', () => {
  // Quem recebe dia 5 de outubro está cobrando as sessões de setembro.
  it('dia fixo e quinto dia útil cobram o mês anterior', () => {
    expect(mesDeCompetencia(2026, 9, 'dia_fixo')).toEqual({ ano: 2026, mes: 8 });
    expect(mesDeCompetencia(2026, 9, 'quinto_dia_util')).toEqual({ ano: 2026, mes: 8 });
  });

  // Quem recebe no último dia do mês está cobrando o mês que acaba ali.
  it('último dia e última sessão cobram o próprio mês', () => {
    expect(mesDeCompetencia(2026, 9, 'ultimo_dia')).toEqual({ ano: 2026, mes: 9 });
    expect(mesDeCompetencia(2026, 9, 'ultima_sessao')).toEqual({ ano: 2026, mes: 9 });
  });

  it('vira o ano corretamente em janeiro', () => {
    expect(mesDeCompetencia(2026, 0, 'dia_fixo')).toEqual({ ano: 2025, mes: 11 });
  });

  it('modo desconhecido cai no comportamento de dia fixo', () => {
    expect(mesDeCompetencia(2026, 5, 'inventado')).toEqual({ ano: 2026, mes: 4 });
    expect(mesDeCompetencia(2026, 5, undefined)).toEqual({ ano: 2026, mes: 4 });
  });
});

describe('mesDeCobranca', () => {
  it('é o inverso de mesDeCompetencia', () => {
    const { ano, mes } = mesDeCobranca(2026, 8, 'dia_fixo');
    expect({ ano, mes }).toEqual({ ano: 2026, mes: 9 });
    expect(mesDeCompetencia(ano, mes, 'dia_fixo')).toEqual({ ano: 2026, mes: 8 });
  });

  it('vira o ano corretamente em dezembro', () => {
    expect(mesDeCobranca(2026, 11, 'dia_fixo')).toEqual({ ano: 2027, mes: 0 });
  });
});

describe('diaDeVencimento', () => {
  it('usa o dia informado no modo fixo', () => {
    expect(diaDeVencimento(2026, 9, { diaPagamento: 10, diaPagamentoModo: 'dia_fixo' })).toBe(10);
  });

  // Dia 31 em mês de 30 não pode sumir da conta.
  it('encaixa dia fixo maior que o mês no último dia real', () => {
    expect(diaDeVencimento(2026, 3, { diaPagamento: 31, diaPagamentoModo: 'dia_fixo' })).toBe(30);
    expect(diaDeVencimento(2026, 1, { diaPagamento: 31, diaPagamentoModo: 'dia_fixo' })).toBe(28);
  });

  it('acha o último dia do mês', () => {
    expect(diaDeVencimento(2026, 9, { diaPagamentoModo: 'ultimo_dia' })).toBe(31);
    expect(diaDeVencimento(2026, 3, { diaPagamentoModo: 'ultimo_dia' })).toBe(30);
  });

  // Setembro/2026 começa numa terça: 1,2,3,4 e 7 são os cinco primeiros
  // dias úteis — o fim de semana (5 e 6) não conta.
  it('conta o quinto dia útil pulando fim de semana', () => {
    expect(diaDeVencimento(2026, 8, { diaPagamentoModo: 'quinto_dia_util' })).toBe(7);
  });

  it('usa a data da última sessão quando o modo é esse', () => {
    expect(diaDeVencimento(2026, 9, {
      diaPagamentoModo: 'ultima_sessao', dataUltimaSessao: '2026-10-28',
    })).toBe(28);
  });

  // Mês sem sessão nenhuma: cai no último dia, que é o mais próximo do que
  // o modo significa — nunca some da lista.
  it('sem sessão no mês, última sessão cai no último dia', () => {
    expect(diaDeVencimento(2026, 9, { diaPagamentoModo: 'ultima_sessao' })).toBe(31);
  });
});

describe('quais sessões entram na conta', () => {
  it('cobra realizada e falta, nunca cancelada', () => {
    expect(sessaoEhCobravel('realizado')).toBe(true);
    expect(sessaoEhCobravel('nao_realizado')).toBe(true);
    expect(sessaoEhCobravel('cancelado')).toBe(false);
  });

  // Agendada ainda não é cobrança, mas continua na previsão: a sessão está
  // de pé até alguém dizer o contrário.
  it('agendada conta como prevista, não como cobrável', () => {
    expect(sessaoContaComoPrevista('agendado')).toBe(true);
    expect(sessaoEhCobravel('agendado')).toBe(false);
  });

  it('cancelada não entra nem na previsão', () => {
    expect(sessaoContaComoPrevista('cancelado')).toBe(false);
  });
});

describe('rotuloCompetencia', () => {
  it('diz a que mês a cobrança se refere', () => {
    expect(rotuloCompetencia('dia_fixo')).toBe('mês anterior');
    expect(rotuloCompetencia('ultimo_dia')).toBe('mês corrente');
  });

  it('todos os modos oferecidos têm rótulo e regra', () => {
    MODOS_DIA_PAGAMENTO.forEach((m) => {
      expect(typeof m.label).toBe('string');
      expect(typeof m.mesAnterior).toBe('boolean');
    });
  });
});
