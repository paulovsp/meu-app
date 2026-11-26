// O recado das férias do analista: preenche as datas e varia por dia.
jest.mock('react-native-svg', () => ({}));
const { recadoDeFerias, RECADOS_DE_FERIAS } = require('../../components/AvisoFerias');

const ferias = { data_inicio: '2027-01-04', data_fim: '2027-01-31' };

describe('recadoDeFerias', () => {
  it('preenche fim e volta sem deixar marcador', () => {
    for (let d = 1; d <= RECADOS_DE_FERIAS.length; d += 1) {
      const r = recadoDeFerias(ferias, new Date(2027, 0, d));
      expect(r.texto).not.toMatch(/\{fim\}|\{volta\}/);
      expect(r.texto).toMatch(/31\/01|01\/02/);
    }
  });

  it('a volta é o dia seguinte ao fim, virando o mês', () => {
    const textos = Array.from({ length: 8 }, (_, i) => recadoDeFerias(ferias, new Date(2027, 0, i + 1)).texto);
    expect(textos.some((t) => t.includes('01/02'))).toBe(true);
  });

  it('muda de um dia para o outro', () => {
    const a = recadoDeFerias(ferias, new Date(2027, 0, 5)).titulo;
    const b = recadoDeFerias(ferias, new Date(2027, 0, 6)).titulo;
    expect(a).not.toBe(b);
  });
});
