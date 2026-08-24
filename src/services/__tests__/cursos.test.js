// Só a parte pura de cursos.js (carga horária derivada e término da aula) —
// o resto do módulo fala com o Supabase e é coberto pelos testes manuais.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {}, functions: {} } }));
jest.mock('../despesas', () => ({
  adicionarDespesa: jest.fn(), editarDespesa: jest.fn(), removerDespesa: jest.fn(),
}));
jest.mock('../assinatura', () => ({ MENSAGEM_ASSINATURA_INATIVA: '' }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));

const { calcularCargaHoraria, terminoDerivadoDaAula } = require('../cursos');

describe('calcularCargaHoraria', () => {
  it('converte aulas x minutos em horas', () => {
    expect(calcularCargaHoraria(12, 90)).toBe(18);   // 12 x 1h30 = 18h
    expect(calcularCargaHoraria(4, 60)).toBe(4);
  });

  it('arredonda em 2 casas em vez de deixar dízima', () => {
    expect(calcularCargaHoraria(3, 50)).toBe(2.5);
    expect(calcularCargaHoraria(1, 50)).toBe(0.83);
  });

  it('aceita os valores como texto (é o que vem do TextInput)', () => {
    expect(calcularCargaHoraria('12', '90')).toBe(18);
  });

  it('devolve null quando falta um dos dois, pra não gravar 0 por engano', () => {
    expect(calcularCargaHoraria(null, 90)).toBeNull();
    expect(calcularCargaHoraria(12, null)).toBeNull();
    expect(calcularCargaHoraria('', '')).toBeNull();
    expect(calcularCargaHoraria(0, 90)).toBeNull();
    expect(calcularCargaHoraria(12, -30)).toBeNull();
  });
});

describe('terminoDerivadoDaAula', () => {
  it('soma a duração da aula ao horário de início', () => {
    expect(terminoDerivadoDaAula('19:30', 90)).toBe('21:00');
  });

  it('funciona com o horário ainda sem formatar ("1930")', () => {
    expect(terminoDerivadoDaAula('1930', 90)).toBe('21:00');
  });

  it('devolve null sem duração de aula', () => {
    expect(terminoDerivadoDaAula('19:30', null)).toBeNull();
    expect(terminoDerivadoDaAula('19:30', 0)).toBeNull();
  });
});
