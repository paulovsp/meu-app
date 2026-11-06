// Entradas do mês: sessões futuras de horário fixo e a soma por modalidade.
jest.mock('../supabase', () => ({ supabase: {} }));
import {
  projetarOcorrenciasFuturas, valorEntradaDoMes, sessoesEntradaDoMes, totalEntradasDoMes,
} from '../database';

const terca = { patient_id: 'p1', day_of_week: 2, start_time: '10:00', recorrencia_tipo: 'semanal' };

describe('projetarOcorrenciasFuturas', () => {
  // Novembro de 2026: terças são 3, 10, 17 e 24.
  test('conta só as terças a partir de hoje', () => {
    const r = projetarOcorrenciasFuturas({
      slots: [terca], ocupadas: new Set(), liberadas: new Set(), ano: 2026, mesIndex: 10, hoje: '2026-11-05',
    });
    expect(r).toEqual({ p1: 3 });
  });

  test('não conta data que já virou compromisso nem horário liberado', () => {
    const r = projetarOcorrenciasFuturas({
      slots: [terca],
      ocupadas: new Set(['2026-11-10|10:00']),
      liberadas: new Set(['2026-11-17|10:00']),
      ano: 2026, mesIndex: 10, hoje: '2026-11-05',
    });
    expect(r).toEqual({ p1: 1 });
  });

  test('mês que já passou não projeta nada', () => {
    const r = projetarOcorrenciasFuturas({
      slots: [terca], ocupadas: new Set(), liberadas: new Set(), ano: 2026, mesIndex: 9, hoje: '2026-11-05',
    });
    expect(r).toEqual({});
  });

  test('horário avulso só vale na própria data', () => {
    const avulso = { ...terca, recorrencia_tipo: 'avulso', data_avulsa: '2026-11-24' };
    const r = projetarOcorrenciasFuturas({
      slots: [avulso], ocupadas: new Set(), liberadas: new Set(), ano: 2026, mesIndex: 10, hoje: '2026-11-05',
    });
    expect(r).toEqual({ p1: 1 });
  });
});

describe('valor das Entradas', () => {
  const mensal = { tipo_cobranca: 'mensal', valorPrevisto: 800, sessoesMes: 4 };
  const porSessao = {
    tipo_cobranca: 'por_sessao', valorPrevisto: 200, valorFuturo: 400, sessoesCobraveis: 1, sessoesFuturas: 2,
  };

  test('por sessão soma o feito e o que vai ser feito', () => {
    expect(valorEntradaDoMes(porSessao)).toBe(600);
    expect(sessoesEntradaDoMes(porSessao)).toBe(3);
  });

  test('mensal usa o previsto da competência', () => {
    expect(valorEntradaDoMes(mensal)).toBe(800);
    expect(sessoesEntradaDoMes(mensal)).toBe(4);
  });

  test('o total junta as duas modalidades', () => {
    expect(totalEntradasDoMes([mensal, porSessao])).toBe(1400);
  });
});
