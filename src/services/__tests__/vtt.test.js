// Conversão da legenda WebVTT do Zoom para os turnos "A:"/"P:" do app.
//
// Testado de verdade porque é a peça que estraga a transcrição EM SILÊNCIO:
// um erro aqui não derruba nada, só entrega a sessão com as falas trocadas
// ou picadas — e ninguém percebe até ler o prontuário.
const { vttParaTurnos } = require('../../../supabase/functions/_shared/vtt.ts');

const VTT_ZOOM = `WEBVTT

1
00:00:02.100 --> 00:00:05.400
Paulo Pimentel: Bom dia, como você está hoje?

2
00:00:06.000 --> 00:00:09.200
Maria Souza: Estou um pouco ansiosa.

3
00:00:09.300 --> 00:00:12.000
Maria Souza: Não dormi direito essa semana.

4
00:00:12.500 --> 00:00:14.000
Paulo Pimentel: Conte-me mais sobre isso.
`;

describe('vttParaTurnos', () => {
  it('separa analista e analisante pelo nome de quem abriu a reunião', () => {
    const turnos = vttParaTurnos(VTT_ZOOM, 'Paulo Pimentel');
    const linhas = turnos.split('\n');
    expect(linhas[0]).toBe('A: Bom dia, como você está hoje?');
    expect(linhas[2]).toBe('A: Conte-me mais sobre isso.');
    expect(linhas[1].startsWith('P: ')).toBe(true);
  });

  // O VTT quebra por tempo, não por turno de conversa. Sem juntar, uma
  // sessão de 50 min sairia em centenas de linhas de meia frase cada.
  it('junta falas seguidas da mesma pessoa numa linha só', () => {
    const turnos = vttParaTurnos(VTT_ZOOM, 'Paulo Pimentel');
    expect(turnos.split('\n')).toHaveLength(3);
    expect(turnos).toContain('P: Estou um pouco ansiosa. Não dormi direito essa semana.');
  });

  it('ignora cabeçalho, numeração e linhas de tempo', () => {
    const turnos = vttParaTurnos(VTT_ZOOM, 'Paulo Pimentel');
    expect(turnos).not.toContain('WEBVTT');
    expect(turnos).not.toContain('-->');
    expect(turnos).not.toMatch(/^\d+$/m);
  });

  // Se o nome do anfitrião não vier (ou não bater), é melhor tudo virar "P:"
  // e a pessoa corrigir na tela do que perder a transcrição inteira.
  it('sem nome do anfitrião, não inventa quem é o analista', () => {
    const turnos = vttParaTurnos(VTT_ZOOM, null);
    expect(turnos.split('\n').every((l) => l.startsWith('P: '))).toBe(true);
  });

  it('compara o nome sem depender de caixa ou espaços', () => {
    const turnos = vttParaTurnos(VTT_ZOOM, '  paulo pimentel ');
    expect(turnos.split('\n')[0]).toBe('A: Bom dia, como você está hoje?');
  });

  it('aguenta fala sem nome e VTT vazio sem quebrar', () => {
    expect(vttParaTurnos('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nfala solta\n', 'X'))
      .toBe('P: fala solta');
    expect(vttParaTurnos('', 'X')).toBe('');
    expect(vttParaTurnos(null, 'X')).toBe('');
  });

  // Horário dito dentro da fala ("às 14:30") não pode ser confundido com o
  // prefixo de quem falou.
  it('não confunde horário no meio da fala com nome de locutor', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nMaria Souza: cheguei às 14:30 ontem\n';
    expect(vttParaTurnos(vtt, 'Paulo Pimentel')).toBe('P: cheguei às 14:30 ontem');
  });
});
