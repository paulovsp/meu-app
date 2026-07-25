const { validarItemObjetivo, CATEGORIAS_OBJETIVO } = require('../perfilObjetivo');

describe('validarItemObjetivo', () => {
  const textoOriginal = 'Ela disse que dorme muito mal desde que começou o novo emprego.';

  test('aceita item cujo trecho existe literalmente e categoria é válida', () => {
    const item = validarItemObjetivo(
      { trecho_literal: 'dorme muito mal', categoria: 'sono' },
      textoOriginal
    );
    expect(item).toEqual({ trecho_literal: 'dorme muito mal', categoria: 'sono' });
  });

  test('descarta trecho que não existe no texto original', () => {
    const item = validarItemObjetivo(
      { trecho_literal: 'come muito bem todos os dias', categoria: 'alimentacao' },
      textoOriginal
    );
    expect(item).toBeNull();
  });

  test('descarta categoria inválida', () => {
    const item = validarItemObjetivo(
      { trecho_literal: 'dorme muito mal', categoria: 'humor' },
      textoOriginal
    );
    expect(item).toBeNull();
  });

  test('as 4 categorias esperadas estão definidas', () => {
    expect(CATEGORIAS_OBJETIVO.map((c) => c.chave).sort()).toEqual([
      'alimentacao', 'medicina', 'movimento', 'sono',
    ]);
  });
});
