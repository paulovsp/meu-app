// A grade é da profissional: só horário livre pode sair dela. É esta regra
// que decide se excluir um horário apaga (livre) ou só desocupa (ocupado).
jest.mock('../supabase', () => ({ supabase: {} }));
import { slotEstaOcupado } from '../database';

describe('slotEstaOcupado', () => {
  test('horário com analisante está ocupado', () => {
    expect(slotEstaOcupado({ patient_id: 'p1', tipo: 'sessao_individual' })).toBe(true);
  });

  test('grupo e "outros" ocupam mesmo sem analisante', () => {
    expect(slotEstaOcupado({ patient_id: null, tipo: 'sessao_grupo' })).toBe(true);
    expect(slotEstaOcupado({ patient_id: null, tipo: 'supervisao_grupo' })).toBe(true);
    expect(slotEstaOcupado({ patient_id: null, tipo: 'outros' })).toBe(true);
  });

  test('horário sem ninguém é livre', () => {
    expect(slotEstaOcupado({ patient_id: null, tipo: 'sessao_individual' })).toBe(false);
    expect(slotEstaOcupado({ patient_id: null, tipo: 'supervisao_individual' })).toBe(false);
  });
});
