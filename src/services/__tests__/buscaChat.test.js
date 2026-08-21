// Testes de integração da pseudonimização em buscaChat.js — diferente de
// pseudonimizacao.test.js (que testa o algoritmo de redigir/restaurar em
// isolamento), estes cobrem a FIAÇÃO: que montarContextoPaciente e
// chamarBuscaChat realmente aplicam redigir/restaurar antes de qualquer
// coisa sair pro DeepSeek, e não deixam o nome vazar por nenhum caminho
// (cabeçalho, corpo do histórico clínico, ou mensagens do chat).
jest.mock('../database', () => ({
  getSessions: jest.fn(),
  getRecords: jest.fn(),
  listarPacientes: jest.fn(),
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const { getSessions, getRecords, listarPacientes } = require('../database');
const { supabase } = require('../supabase');
const { montarContextoPaciente, chamarBuscaChat, identificarPacienteNaPergunta } = require('../buscaChat');

const paciente = {
  id: 'p1',
  nome: 'Maria Aparecida Souza',
  nascimento: '1990-05-20',
  data_inicio: '2023-01-10',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('montarContextoPaciente', () => {
  it('nunca inclui o nome real nem a data de nascimento — só [ANALISANTE] e idade', async () => {
    getSessions.mockResolvedValue([
      { date: '2026-07-20', type: 'presencial', transcript: 'A: Como você está, Maria?\nP: Estou ansiosa, doutor.' },
    ]);
    getRecords.mockResolvedValue([
      { date: '2026-07-15', type: 'estudo', title: 'Anotação', content: '<p>Maria mencionou episódios de insônia.</p>' },
    ]);

    const contexto = await montarContextoPaciente(paciente);

    expect(contexto).not.toMatch(/maria/i);
    expect(contexto).not.toMatch(/1990/);
    expect(contexto).not.toMatch(/Nascimento/);
    expect(contexto).toContain('[ANALISANTE]');
    expect(contexto).toMatch(/Idade: \d+ anos/);
  });
});

describe('montarContextoPaciente — envia todo o histórico, sem seleção por relevância', () => {
  it('inclui uma sessão bem antiga mesmo com dezenas de sessões recentes na frente — sem corte de quantidade', async () => {
    // 40 sessões recentes + 1 sessão antiga sem nenhuma palavra em comum
    // com as outras — decisão deliberada de não selecionar/truncar por
    // relevância: a ferramenta manda o máximo de acesso ao material, não
    // "economiza" adivinhando o que parece relevante pra pergunta.
    const sessoesRecentes = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-0${(i % 9) + 1}-01`,
      type: 'presencial',
      transcript: `A: Sessão número ${i}.\nP: Ok.`,
    }));
    getSessions.mockResolvedValue([
      ...sessoesRecentes,
      { date: '2018-03-10', type: 'presencial', transcript: 'A: Sessão antiquíssima.\nP: Sim.' },
    ]);
    getRecords.mockResolvedValue([]);

    const contexto = await montarContextoPaciente(paciente);

    expect(contexto).toMatch(/antiquíssima/i);
  });
});

describe('identificarPacienteNaPergunta (item 11 — nome com acento)', () => {
  it('acha o analisante mesmo quando a pergunta digita o nome sem o acento que o cadastro tem', async () => {
    listarPacientes.mockResolvedValue([{ id: 'x1', nome: 'João Amélio Simões' }]);
    const achado = await identificarPacienteNaPergunta('como está o joao hoje?');
    expect(achado?.id).toBe('x1');
  });

  it('acha o analisante mesmo quando o cadastro tem acento e a pergunta também, com grafias diferentes', async () => {
    listarPacientes.mockResolvedValue([{ id: 'x2', nome: 'Amelia' }]);
    const achado = await identificarPacienteNaPergunta('como a amélia está indo?');
    expect(achado?.id).toBe('x2');
  });

  it('retorna ambíguo (não escolhe nenhum) quando dois analisantes têm o mesmo primeiro nome', async () => {
    listarPacientes.mockResolvedValue([
      { id: 'a1', nome: 'Ana Silva' },
      { id: 'a2', nome: 'Ana Costa' },
    ]);
    const achado = await identificarPacienteNaPergunta('como a ana está?');
    expect(achado?.ambiguo).toBe(true);
    expect(achado?.candidatos).toHaveLength(2);
  });

  it('nome completo desambigua entre dois analisantes de mesmo primeiro nome', async () => {
    listarPacientes.mockResolvedValue([
      { id: 'a1', nome: 'Ana Silva' },
      { id: 'a2', nome: 'Ana Costa' },
    ]);
    const achado = await identificarPacienteNaPergunta('como a ana silva está?');
    expect(achado?.id).toBe('a1');
  });

  it('retorna null quando nenhum analisante bate com a pergunta', async () => {
    listarPacientes.mockResolvedValue([{ id: 'x1', nome: 'Carlos' }]);
    const achado = await identificarPacienteNaPergunta('como estão as coisas em geral?');
    expect(achado).toBeNull();
  });
});

describe('chamarBuscaChat', () => {
  it('redige o nome digitado na própria pergunta antes de mandar pro DeepSeek, e restaura na resposta', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { resposta: '[ANALISANTE] relatou melhora na última sessão, mas ainda apresenta ansiedade.', custo: 0.00021 },
      error: null,
    });

    const contexto = '`Histórico de [ANALISANTE] (mais recentes primeiro):\nIdade: 35 anos\n  [20/07/2026] Sessão: A: [ANALISANTE], como você está?';
    const historico = [{ role: 'user', content: 'Como está a Maria hoje?' }];

    const resultado = await chamarBuscaChat(contexto, historico, paciente);

    const payloadEnviado = supabase.functions.invoke.mock.calls[0][1].body;
    const mensagemUsuario = payloadEnviado.mensagens.find((m) => m.role === 'user');

    expect(mensagemUsuario.content).not.toMatch(/maria/i);
    expect(mensagemUsuario.content).toContain('[ANALISANTE]');
    expect(resultado.texto).toContain('Maria Aparecida Souza');
    expect(resultado.texto).not.toContain('[ANALISANTE]');
  });
});
