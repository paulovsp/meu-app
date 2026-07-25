const {
  validarSchemaRubrica,
  codigosNucleos,
  nucleoDiagonalDe,
  getRubricaSemente,
} = require('../rubricas');

describe('rubricas — schema', () => {
  test('a rubrica semente (config/nucleos/rubricas.v1.json) é válida', () => {
    const rubrica = getRubricaSemente();
    const { valido, erros } = validarSchemaRubrica(rubrica);
    expect(erros).toEqual([]);
    expect(valido).toBe(true);
  });

  test('rubrica semente tem os 4 núcleos com indicadores', () => {
    const rubrica = getRubricaSemente();
    for (const chave of ['bem', 'mal', 'mau', 'bom']) {
      expect(rubrica.nucleos[chave]).toBeDefined();
      expect(rubrica.nucleos[chave].indicadores.length).toBeGreaterThan(0);
    }
  });

  test('rubrica semente tem as 4 instâncias, cada uma com 3 núcleos e fantasma', () => {
    const rubrica = getRubricaSemente();
    for (const chave of ['ego', 'id', 'superego', 'superid']) {
      const inst = rubrica.instancias[chave];
      expect(inst.nucleos).toHaveLength(3);
      expect(inst.fantasma_exclui).toBeTruthy();
    }
  });

  test('rejeita rubrica sem núcleo obrigatório', () => {
    const rubrica = JSON.parse(JSON.stringify(getRubricaSemente()));
    delete rubrica.nucleos.bom;
    const { valido, erros } = validarSchemaRubrica(rubrica);
    expect(valido).toBe(false);
    expect(erros.some((e) => e.includes('bom'))).toBe(true);
  });

  test('rejeita rubrica sem indicadores em um núcleo', () => {
    const rubrica = JSON.parse(JSON.stringify(getRubricaSemente()));
    rubrica.nucleos.mal.indicadores = [];
    const { valido, erros } = validarSchemaRubrica(rubrica);
    expect(valido).toBe(false);
    expect(erros.some((e) => e.includes('mal'))).toBe(true);
  });

  test('rejeita null/undefined/objeto vazio', () => {
    expect(validarSchemaRubrica(null).valido).toBe(false);
    expect(validarSchemaRubrica(undefined).valido).toBe(false);
    expect(validarSchemaRubrica({}).valido).toBe(false);
  });
});

describe('rubricas — topologia', () => {
  test('codigosNucleos devolve os 4 núcleos + eu_nuclear por padrão', () => {
    expect(codigosNucleos()).toEqual(['bem', 'mal', 'mau', 'bom', 'eu_nuclear']);
  });

  test('codigosNucleos sem eu_nuclear quando pedido', () => {
    expect(codigosNucleos(false)).toEqual(['bem', 'mal', 'mau', 'bom']);
  });

  test('diagonal de bem é bom, e vice-versa', () => {
    expect(nucleoDiagonalDe('bem')).toBe('bom');
    expect(nucleoDiagonalDe('bom')).toBe('bem');
  });

  test('diagonal de mal é mau, e vice-versa', () => {
    expect(nucleoDiagonalDe('mal')).toBe('mau');
    expect(nucleoDiagonalDe('mau')).toBe('mal');
  });

  test('eu_nuclear não tem diagonal', () => {
    expect(nucleoDiagonalDe('eu_nuclear')).toBeNull();
  });
});
