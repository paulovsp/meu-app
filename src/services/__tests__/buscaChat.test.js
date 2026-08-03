// Testes de integração da pseudonimização em buscaChat.js — diferente de
// pseudonimizacao.test.js (que testa o algoritmo de redigir/restaurar em
// isolamento), estes cobrem a FIAÇÃO: que montarContextoPaciente e
// chamarBuscaChat realmente aplicam redigir/restaurar antes de qualquer
// coisa sair pro DeepSeek, e não deixam o nome vazar por nenhum caminho
// (cabeçalho, corpo do histórico clínico, ou mensagens do chat).
jest.mock('../database', () => ({
  getSessions: jest.fn(),
  getRecords: jest.fn(),
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const { getSessions, getRecords } = require('../database');
const { supabase } = require('../supabase');
const { montarContextoPaciente, chamarBuscaChat } = require('../buscaChat');

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
