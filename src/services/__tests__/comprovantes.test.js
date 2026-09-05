// Conferência de comprovante do WhatsApp contra o previsto no Recebíveis.
//
// Testado porque é o que a profissional lê antes de marcar dinheiro como
// recebido. Um "confere" errado aqui vira pagamento dado como pago que não
// foi — e ninguém vai atrás de uma dívida que o app diz não existir.
const {
  compararValores, cruzarComprovantesComRecebimentos, rotuloConferencia,
} = require('../comprovantes');

describe('compararValores', () => {
  it('bate quando o valor lido é o previsto', () => {
    expect(compararValores(450, 450)).toBe('confere');
  });

  // Centavo de diferença é arredondamento do OCR, não outro pagamento.
  it('tolera diferença de centavos', () => {
    expect(compararValores(450.01, 450)).toBe('confere');
    expect(compararValores(449.99, 450)).toBe('confere');
  });

  it('acusa divergência de verdade', () => {
    expect(compararValores(45, 450)).toBe('divergente');
    expect(compararValores(450, 45)).toBe('divergente');
    expect(compararValores(400, 450)).toBe('divergente');
  });

  // Sem valor legível, o certo é dizer que não dá pra conferir — nunca
  // deixar passar como se conferisse.
  it('não inventa conferência sem valor', () => {
    expect(compararValores(null, 450)).toBe('sem_valor');
    expect(compararValores(0, 450)).toBe('sem_valor');
    expect(compararValores(450, null)).toBe('sem_valor');
    expect(compararValores(undefined, undefined)).toBe('sem_valor');
    expect(compararValores(NaN, 450)).toBe('sem_valor');
  });
});

describe('cruzarComprovantesComRecebimentos', () => {
  const recebimentos = [
    { patient_id: 'p1', nome: 'Ana', valorPrevisto: 450, recebido: false },
    { patient_id: 'p2', nome: 'Bruno', valorPrevisto: 300, recebido: true },
  ];

  it('liga o comprovante ao recebimento do mês e conclui a conferência', () => {
    const [item] = cruzarComprovantesComRecebimentos(
      [{ id: 'c1', patient_id: 'p1', valor_detectado: 450 }], recebimentos,
    );
    expect(item.valorPrevisto).toBe(450);
    expect(item.jaRecebido).toBe(false);
    expect(item.conferencia).toBe('confere');
  });

  it('avisa quando aquele mês já está quitado', () => {
    const [item] = cruzarComprovantesComRecebimentos(
      [{ id: 'c2', patient_id: 'p2', valor_detectado: 300 }], recebimentos,
    );
    expect(item.jaRecebido).toBe(true);
    expect(rotuloConferencia(item)).toBe('Este mês já está marcado como recebido');
  });

  // Some-lo seria pior que mostrá-lo: a pessoa mandou o comprovante e
  // ninguém veria.
  it('mantém na lista o comprovante sem analisante identificado', () => {
    const [item] = cruzarComprovantesComRecebimentos(
      [{ id: 'c3', patient_id: null, valor_detectado: 450, telefone_remetente: '5511999' }], recebimentos,
    );
    expect(item.recebimento).toBeNull();
    expect(rotuloConferencia(item)).toBe('Analisante não identificado');
  });

  // Analisante existe, mas não tem cobrança mensal naquele mês (por sessão,
  // paralisado). Não pode dizer "confere" sem ter com o que comparar.
  it('não conclui conferência quando não há previsto no mês', () => {
    const [item] = cruzarComprovantesComRecebimentos(
      [{ id: 'c4', patient_id: 'p9', valor_detectado: 450 }], recebimentos,
    );
    expect(item.valorPrevisto).toBeNull();
    expect(item.conferencia).toBe('sem_valor');
    expect(rotuloConferencia(item)).toBe('Não foi possível ler o valor');
  });

  it('aguenta listas vazias', () => {
    expect(cruzarComprovantesComRecebimentos(null, null)).toEqual([]);
    expect(cruzarComprovantesComRecebimentos([], [])).toEqual([]);
  });
});
