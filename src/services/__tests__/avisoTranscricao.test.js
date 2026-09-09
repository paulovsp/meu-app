jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(),
}));
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {} } }));

const { resumirTranscricoes } = require('../avisoTranscricao');

describe('resumirTranscricoes', () => {
  it('uma pronta fala no singular', () => {
    expect(resumirTranscricoes([{ nome: 'Ana', falhou: false }])).toEqual({
      titulo: 'Transcrição pronta',
      mensagem: 'Pronta: Ana',
    });
  });

  it('uma falha não se disfarça de pronta', () => {
    expect(resumirTranscricoes([{ nome: 'Ana', falhou: true }])).toEqual({
      titulo: 'Uma transcrição falhou',
      mensagem: 'Falhou: Ana',
    });
  });

  it('prontas e falhas aparecem separadas, não somadas', () => {
    const r = resumirTranscricoes([
      { nome: 'Ana', falhou: false },
      { nome: 'Beto', falhou: true },
      { nome: 'Caio', falhou: false },
    ]);
    expect(r.titulo).toBe('3 transcrições');
    expect(r.mensagem).toBe('Prontas: Ana, Caio\nFalhou: Beto');
  });

  it('só falhas não inventa uma linha de prontas vazia', () => {
    const r = resumirTranscricoes([
      { nome: 'Ana', falhou: true },
      { nome: 'Beto', falhou: true },
    ]);
    expect(r.mensagem).toBe('Falharam: Ana, Beto');
  });
});
