// Horário "temporariamente livre": analisante que vem 1, 2 ou 3 vezes no
// ciclo de 4 semanas. Nas semanas que não são dele, a Agenda mostra o
// horário em amarelo, livre pra marcar outra coisa só naquela data.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const { horariosTemporariamenteLivres } = require('../database');

// 2026-11-02 é segunda-feira (day_of_week 1).
const quinzenal = {
  id: 'q1', day_of_week: 1, start_time: '10:00', end_time: '10:50',
  patient_id: 'p1', patient_name: 'Ana',
  recorrencia_tipo: 'quinzenal', recorrencia_data_referencia: '2026-11-02',
  recorrencia_semanas_ativas: [1, 3],
};
const umaVezNoCiclo = {
  ...quinzenal, id: 'm1', start_time: '11:00', recorrencia_tipo: 'personalizada',
  recorrencia_semanas_ativas: [1],
};

describe('horariosTemporariamenteLivres', () => {
  it('na semana de sessão o horário não é temporariamente livre', () => {
    expect(horariosTemporariamenteLivres([quinzenal], '2026-11-02')).toEqual([]);
    expect(horariosTemporariamenteLivres([quinzenal], '2026-11-16')).toEqual([]);
  });

  it('na semana sem sessão aparece como temporariamente livre', () => {
    expect(horariosTemporariamenteLivres([quinzenal], '2026-11-09').map((s) => s.id)).toEqual(['q1']);
  });

  it('uma vez no ciclo: livre nas outras 3 semanas', () => {
    const datas = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
    const livres = datas.map((d) => horariosTemporariamenteLivres([umaVezNoCiclo], d).length);
    expect(livres).toEqual([0, 1, 1, 1, 0]);
  });

  it('antes da 1ª sessão não mostra nada', () => {
    expect(horariosTemporariamenteLivres([quinzenal], '2026-10-26')).toEqual([]);
  });

  it('outro dia da semana não mostra nada', () => {
    expect(horariosTemporariamenteLivres([quinzenal], '2026-11-10')).toEqual([]);
  });

  it('horário semanal nunca fica temporariamente livre', () => {
    const semanal = { ...quinzenal, recorrencia_tipo: 'semanal' };
    expect(horariosTemporariamenteLivres([semanal], '2026-11-09')).toEqual([]);
  });

  it('horário sem analisante não vira aviso de folga', () => {
    const vazio = { ...quinzenal, patient_id: null };
    expect(horariosTemporariamenteLivres([vazio], '2026-11-09')).toEqual([]);
  });

  it('dois quinzenais que se revezam no mesmo horário: nenhum fica livre', () => {
    const outro = { ...quinzenal, id: 'q2', patient_id: 'p2', recorrencia_semanas_ativas: [2, 4] };
    expect(horariosTemporariamenteLivres([quinzenal, outro], '2026-11-09')).toEqual([]);
    expect(horariosTemporariamenteLivres([quinzenal, outro], '2026-11-02')).toEqual([]);
  });

  it('se já marcou outra coisa nesse horário, não mostra o amarelo', () => {
    const compromisso = { date: '2026-11-09', start_time: '10:00' };
    expect(horariosTemporariamenteLivres([quinzenal], '2026-11-09', [compromisso])).toEqual([]);
  });
});
