// Testes de integração da pseudonimização em buscaChat.js — diferente de
// pseudonimizacao.test.js (que testa o algoritmo de redigir/restaurar em
// isolamento), estes cobrem a FIAÇÃO: que montarContextoSelecionados e
// chamarBuscaChat realmente aplicam redigir/restaurar antes de qualquer
// coisa sair pro DeepSeek, com marcadores indexados por pessoa acumulados
// na sessão de redação da janela, e que o histórico de mensagens da
// conversa é de fato reenviado a cada chamada (memória dentro da janela).
jest.mock('../database', () => ({
  getSessions: jest.fn(),
  getRecords: jest.fn(),
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const { getSessions, getRecords } = require('../database');
const { supabase } = require('../supabase');
const {
  montarContextoSelecionados, chamarBuscaChat, estimarCustoResposta, criarSessaoRedacao,
} = require('../buscaChat');

const maria = {
  id: 'p1',
  nome: 'Maria Aparecida Souza',
  nascimento: '1990-05-20',
  data_inicio: '2023-01-10',
};
const joao = {
  id: 'p2',
  nome: 'João Pereira Lima',
  nascimento: '1985-02-11',
  data_inicio: '2022-06-01',
  eh_supervisionando: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('montarContextoSelecionados — uma pessoa', () => {
  it('nunca inclui o nome real nem a data de nascimento — só [PESSOA 1] e idade', async () => {
    getSessions.mockResolvedValue([
      { date: '2026-07-20', type: 'presencial', transcript: 'A: Como você está, Maria?\nP: Estou ansiosa, doutor.' },
    ]);
    getRecords.mockResolvedValue([
      { date: '2026-07-15', type: 'estudo', title: 'Anotação', content: '<p>Maria mencionou episódios de insônia.</p>' },
    ]);

    const { contexto } = await montarContextoSelecionados([maria], criarSessaoRedacao());

    expect(contexto).not.toMatch(/maria/i);
    expect(contexto).not.toMatch(/1990/);
    expect(contexto).not.toMatch(/Nascimento/);
    expect(contexto).toContain('[PESSOA 1]');
    expect(contexto).toMatch(/Idade: \d+ anos/);
  });

  it('inclui uma sessão bem antiga mesmo com dezenas de sessões recentes na frente — sem corte de quantidade', async () => {
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

    const { contexto } = await montarContextoSelecionados([maria], criarSessaoRedacao());

    expect(contexto).toMatch(/antiquíssima/i);
  });
});

describe('montarContextoSelecionados — múltiplas pessoas', () => {
  it('usa marcador indexado por pessoa e restaura cada nome no lugar certo', async () => {
    getSessions.mockImplementation(async (id) => (
      id === 'p1'
        ? [{ date: '2026-07-20', type: 'presencial', transcript: 'Maria falou sobre o trabalho.' }]
        : [{ date: '2026-07-18', type: 'online', transcript: 'João comentou sobre um caso supervisionado.' }]
    ));
    getRecords.mockResolvedValue([]);

    const sessaoRedacao = criarSessaoRedacao();
    const { contexto } = await montarContextoSelecionados([maria, joao], sessaoRedacao);

    expect(contexto).toContain('[PESSOA 1]');
    expect(contexto).toContain('[PESSOA 2]');
    expect(contexto).not.toMatch(/maria/i);
    expect(contexto).not.toMatch(/joão|joao/i);

    const respostaBruta = '[PESSOA 1] apresenta melhora, enquanto [PESSOA 2] trouxe uma questão técnica.';
    expect(sessaoRedacao.restaurar(respostaBruta)).toBe(
      'Maria Aparecida Souza apresenta melhora, enquanto João Pereira Lima trouxe uma questão técnica.'
    );
  });
});

describe('criarSessaoRedacao — memória entre perguntas da mesma janela', () => {
  it('continua protegendo o nome de uma pessoa já mencionada mesmo se ela for desmarcada depois', async () => {
    getSessions.mockResolvedValue([]);
    getRecords.mockResolvedValue([]);

    const sessaoRedacao = criarSessaoRedacao();
    await montarContextoSelecionados([maria, joao], sessaoRedacao);

    // segunda pergunta: só a Maria continua selecionada, João foi desmarcado,
    // mas o histórico da conversa ainda cita o nome dele numa mensagem antiga
    const mensagemAntiga = 'João comentou algo parecido antes.';
    expect(sessaoRedacao.redigir(mensagemAntiga)).toBe('[PESSOA 2] comentou algo parecido antes.');
  });
});

describe('chamarBuscaChat', () => {
  it('reenvia o histórico inteiro da conversa (memória dentro da janela) e restaura o nome na resposta', async () => {
    getSessions.mockResolvedValue([]);
    getRecords.mockResolvedValue([]);
    supabase.functions.invoke.mockResolvedValue({
      data: { resposta: '[PESSOA 1] relatou melhora na última sessão, mas ainda apresenta ansiedade.', custo: 0.00021 },
      error: null,
    });

    const sessaoRedacao = criarSessaoRedacao();
    const { contexto } = await montarContextoSelecionados([maria], sessaoRedacao);
    const historico = [
      { role: 'user', content: 'Como está a Maria hoje?' },
      { role: 'assistant', content: 'Maria Aparecida Souza segue estável.' },
      { role: 'user', content: 'E na sessão anterior, como ela estava?' },
    ];

    const resultado = await chamarBuscaChat(historico, contexto, sessaoRedacao);

    const payloadEnviado = supabase.functions.invoke.mock.calls[0][1].body;
    expect(payloadEnviado.mensagens).toHaveLength(4); // system + 3 do histórico
    const mensagensUsuario = payloadEnviado.mensagens.filter((m) => m.role !== 'system');

    for (const m of mensagensUsuario) {
      expect(m.content).not.toMatch(/maria/i);
    }
    expect(mensagensUsuario[0].content).toContain('[PESSOA 1]');
    expect(resultado.texto).toContain('Maria Aparecida Souza');
    expect(resultado.texto).not.toContain('[PESSOA 1]');
  });
});

describe('estimarCustoResposta', () => {
  it('cresce com o tamanho do histórico da conversa', () => {
    const custoPequeno = estimarCustoResposta({ contexto: 'abc', historico: [{ content: 'oi' }] });
    const custoGrande = estimarCustoResposta({
      contexto: 'abc',
      historico: [{ content: 'a'.repeat(10000) }, { content: 'oi' }],
    });
    expect(custoGrande).toBeGreaterThan(custoPequeno);
  });
});
