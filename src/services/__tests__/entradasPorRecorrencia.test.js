// Entradas (Financeiro) x tipo de recorrência do horário.
//
// Por que existe: o total mensal de Entradas é `preço da sessão ×
// contarOcorrenciasAtivasNoMes`. Se essa contagem ignorasse a recorrência,
// um horário quinzenal apareceria valendo o dobro e um avulso valeria o mês
// inteiro — erro que não aparece na tela como erro, só como um número
// plausível e errado. Cada tipo de recorrência que a Disponibilidade sabe
// criar está coberto aqui.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const { contarOcorrenciasAtivasNoMes, slotAtivoNaData } = require('../database');

// Setembro de 2026: terças caem em 1, 8, 15, 22 e 29 (cinco terças).
const ANO = 2026;
const SETEMBRO = 8; // mesIndex base zero
const TERCA = 2;

describe('contarOcorrenciasAtivasNoMes', () => {
  it('semanal conta todas as ocorrências do dia da semana no mês', () => {
    const slot = { day_of_week: TERCA, recorrencia_tipo: 'semanal' };
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(5);
  });

  it('horário antigo, sem recorrência gravada, é tratado como semanal', () => {
    const slot = { day_of_week: TERCA };
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(5);
  });

  it('quinzenal conta uma terça sim, uma não', () => {
    const slot = {
      day_of_week: TERCA,
      recorrencia_tipo: 'quinzenal',
      recorrencia_data_referencia: '2026-09-01',
      recorrencia_semanas_ativas: [1, 3],
    };
    // 01 e 15 e 29 (semanas 1 e 3 do ciclo de 4).
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(3);
  });

  it('personalizada conta só as semanas marcadas do ciclo', () => {
    const slot = {
      day_of_week: TERCA,
      recorrencia_tipo: 'personalizada',
      recorrencia_data_referencia: '2026-09-01',
      recorrencia_semanas_ativas: [2],
    };
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(1);
  });

  it('avulso conta exatamente uma vez, no mês da sua data', () => {
    const slot = { day_of_week: TERCA, recorrencia_tipo: 'avulso', data_avulsa: '2026-09-15' };
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(1);
    // Outubro: nenhuma.
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, 9)).toBe(0);
  });

  it('avulso não vaza pro dia da semana inteiro', () => {
    const slot = { day_of_week: TERCA, recorrencia_tipo: 'avulso', data_avulsa: '2026-09-15' };
    expect(slotAtivoNaData(slot, '2026-09-15')).toBe(true);
    expect(slotAtivoNaData(slot, '2026-09-22')).toBe(false);
  });

  it('nada acontece antes da data de referência do ciclo', () => {
    const slot = {
      day_of_week: TERCA,
      recorrencia_tipo: 'quinzenal',
      recorrencia_data_referencia: '2026-10-06',
      recorrencia_semanas_ativas: [1, 3],
    };
    expect(contarOcorrenciasAtivasNoMes(slot, ANO, SETEMBRO)).toBe(0);
  });
});
