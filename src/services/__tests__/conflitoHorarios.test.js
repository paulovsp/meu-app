// Conflito entre horários da Disponibilidade.
//
// Testado porque o bug era invisível e permanente: até 05/09/2026 o conflito
// olhava SÓ o `day_of_week`, então um horário avulso criado numa terça de
// duas semanas atrás bloqueava toda terça naquele intervalo, pra sempre. E
// apagar o compromisso na Agenda não adiantava — "apagar só este horário"
// grava em `horarios_liberados` e não toca em `availability_slots`.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const { recorrenciasPodemColidir, slotAtivoNaData } = require('../database');

const HOJE = '2026-09-05';
const semanal = { recorrencia_tipo: 'semanal' };
const avulso = (data) => ({ recorrencia_tipo: 'avulso', data_avulsa: data });

describe('recorrenciasPodemColidir', () => {
  it('dois recorrentes no mesmo dia sempre podem colidir', () => {
    expect(recorrenciasPodemColidir(semanal, semanal, HOJE)).toBe(true);
  });

  // O caso relatado.
  it('avulso de data que já passou não bloqueia horário novo', () => {
    expect(recorrenciasPodemColidir(semanal, avulso('2026-08-25'), HOJE)).toBe(false);
    expect(recorrenciasPodemColidir(avulso('2026-08-25'), semanal, HOJE)).toBe(false);
  });

  it('avulso de hoje ou do futuro colide com o recorrente daquele dia', () => {
    expect(recorrenciasPodemColidir(semanal, avulso(HOJE), HOJE)).toBe(true);
    expect(recorrenciasPodemColidir(semanal, avulso('2026-09-19'), HOJE)).toBe(true);
  });

  it('dois avulsos só colidem na mesma data, e só se ela não passou', () => {
    expect(recorrenciasPodemColidir(avulso('2026-09-19'), avulso('2026-09-19'), HOJE)).toBe(true);
    expect(recorrenciasPodemColidir(avulso('2026-09-19'), avulso('2026-09-26'), HOJE)).toBe(false);
    expect(recorrenciasPodemColidir(avulso('2026-08-01'), avulso('2026-08-01'), HOJE)).toBe(false);
  });

  // Quinzenal/personalizada: o avulso futuro só conflita se cair numa semana
  // ativa do ciclo — mesma regra que a Agenda já usa pra desenhar o dia.
  it('avulso futuro respeita o ciclo do quinzenal', () => {
    const quinzenal = {
      recorrencia_tipo: 'quinzenal',
      recorrencia_data_referencia: '2026-09-05',
      recorrencia_semanas_ativas: [1, 3],
    };
    expect(slotAtivoNaData(quinzenal, '2026-09-19')).toBe(true);
    expect(recorrenciasPodemColidir(avulso('2026-09-19'), quinzenal, HOJE)).toBe(true);
    expect(slotAtivoNaData(quinzenal, '2026-09-12')).toBe(false);
    expect(recorrenciasPodemColidir(avulso('2026-09-12'), quinzenal, HOJE)).toBe(false);
  });

  // Horário antigo, gravado antes da migration 0045, não tem recorrencia_tipo.
  it('slot sem recorrência gravada continua sendo tratado como semanal', () => {
    expect(recorrenciasPodemColidir({}, avulso('2026-09-19'), HOJE)).toBe(true);
    expect(recorrenciasPodemColidir({}, avulso('2026-08-25'), HOJE)).toBe(false);
  });

  it('avulso sem data gravada conflita, por segurança', () => {
    expect(recorrenciasPodemColidir({ recorrencia_tipo: 'avulso' }, semanal, HOJE)).toBe(true);
  });
});
