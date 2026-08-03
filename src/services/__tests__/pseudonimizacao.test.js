import { criarPseudonimizador, MARCADOR_ANALISANTE } from '../pseudonimizacao';

describe('pseudonimizacao', () => {
  test('substitui o nome completo (composto)', () => {
    const { redigir } = criarPseudonimizador({ nome: 'João da Silva Ramos' });
    expect(redigir('Histórico de João da Silva Ramos, sessão de hoje.')).toBe(
      `Histórico de ${MARCADOR_ANALISANTE}, sessão de hoje.`
    );
  });

  test('casa nome com acento em qualquer variação de caixa', () => {
    const { redigir } = criarPseudonimizador({ nome: 'João' });
    expect(redigir('joão chegou atrasado.')).toBe(`${MARCADOR_ANALISANTE} chegou atrasado.`);
    expect(redigir('JOÃO chegou atrasado.')).toBe(`${MARCADOR_ANALISANTE} chegou atrasado.`);
    expect(redigir('Joao chegou atrasado.')).toBe(`${MARCADOR_ANALISANTE} chegou atrasado.`);
  });

  test('substitui o primeiro nome isolado no meio de uma frase', () => {
    const { redigir } = criarPseudonimizador({ nome: 'Maria Fernanda Costa' });
    expect(redigir('ela disse que Maria não veio ontem.')).toBe(
      `ela disse que ${MARCADOR_ANALISANTE} não veio ontem.`
    );
  });

  test('substitui também os sobrenomes isolados', () => {
    const { redigir } = criarPseudonimizador({ nome: 'Maria Fernanda Costa' });
    expect(redigir('a família Costa mencionou o ocorrido.')).toBe(
      `a família ${MARCADOR_ANALISANTE} mencionou o ocorrido.`
    );
  });

  test('ida e volta: redigir → restaurar produz o texto original (nome completo)', () => {
    const { redigir, restaurar } = criarPseudonimizador({ nome: 'João da Silva Ramos' });
    const original = 'Histórico de João da Silva Ramos, sessão de hoje.';
    expect(restaurar(redigir(original))).toBe(original);
  });

  test('não substitui nomes de terceiros nem partes com menos de 3 letras', () => {
    const { redigir } = criarPseudonimizador({ nome: 'Zé Bo' });
    expect(redigir('zé foi ao mercado, bo ficou em casa')).toBe(
      'zé foi ao mercado, bo ficou em casa'
    );
  });

  test('sem paciente/nome, não faz nada (e não quebra)', () => {
    const { redigir, restaurar } = criarPseudonimizador(null);
    expect(redigir('joão não deveria sumir aqui')).toBe('joão não deveria sumir aqui');
    expect(restaurar(`${MARCADOR_ANALISANTE} continua marcador`)).toBe(
      `${MARCADOR_ANALISANTE} continua marcador`
    );
  });

  test('múltiplas ocorrências do nome no mesmo texto são todas substituídas', () => {
    const { redigir } = criarPseudonimizador({ nome: 'Ana' });
    expect(redigir('Ana chegou. Depois ana saiu. ANA voltou.')).toBe(
      `${MARCADOR_ANALISANTE} chegou. Depois ${MARCADOR_ANALISANTE} saiu. ${MARCADOR_ANALISANTE} voltou.`
    );
  });
});
