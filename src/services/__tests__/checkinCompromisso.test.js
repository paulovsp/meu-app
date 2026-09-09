// A fila de check-in é conduzida por Alert. No Android um Alert some com o
// botão voltar sem chamar onPress nenhum, e cada elo desta cadeia governa
// ou uma fila ou uma Promise que alguém está esperando — descarte silencioso
// aqui significa fila morta no meio ou `await` pendurado pra sempre. Estes
// testes existem pra ninguém reintroduzir isso sem perceber.
const botoesApertados = [];

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn((titulo, mensagem, botoes, opcoes) => {
      botoesApertados.push({ titulo, botoes, opcoes });
    }),
  },
}));
jest.mock('../database', () => ({
  updateAppointmentStatus: jest.fn(() => Promise.resolve()),
  parsePreco: jest.fn(() => 0),
  converterParaBRL: jest.fn(() => Promise.resolve(0)),
  confirmarPagamentoSessao: jest.fn(() => Promise.resolve()),
  marcarPresencaParticipante: jest.fn(() => Promise.resolve()),
}));
jest.mock('../fiscalAutomatico', () => ({ dispararFiscalPorSessao: jest.fn() }));
jest.mock('../erros', () => ({ mensagemDeErro: (e) => String(e) }));

const { Alert } = require('react-native');
const {
  perguntarCheckin, perguntarTipoNaoRealizada,
} = require('../checkinCompromisso');

const COMPROMISSO = {
  id: 'c1', date: '2026-09-09', patient_id: 'p1',
  patient_nome: 'Fulano', tipo: 'sessao_individual',
  patient_tipo_cobranca: 'mensal',
};

function ultimo() {
  return botoesApertados[botoesApertados.length - 1];
}
// Deixa a cadeia de onPress assincronos rodar ate o proximo Alert aparecer.
// Nao da pra dar await no proprio apertar(): o onPress de "Sim, foi
// realizada" espera a pergunta de pagamento, que so resolve quando alguem
// responde ELA -- dar await ali trava o teste, nao o codigo.
const escoar = () => new Promise((r) => setImmediate(r));

function apertar(texto) {
  const botao = ultimo().botoes.find((b) => b.text === texto);
  if (!botao) throw new Error(`Sem botão "${texto}" em "${ultimo().titulo}"`);
  return botao.onPress();
}

beforeEach(() => {
  botoesApertados.length = 0;
  Alert.alert.mockClear();
});

describe('nenhum alerta da fila pode sumir sozinho', () => {
  it('a pergunta de check-in não é descartável', () => {
    perguntarCheckin(COMPROMISSO, {});
    expect(ultimo().opcoes).toEqual({ cancelable: false });
  });

  it('o "cancelada ou falta?" também não', () => {
    perguntarTipoNaoRealizada(COMPROMISSO, jest.fn());
    expect(ultimo().opcoes).toEqual({ cancelable: false });
  });

  it('a pergunta de pagamento por sessão também não', async () => {
    perguntarCheckin({ ...COMPROMISSO, patient_tipo_cobranca: 'por_sessao' }, {});
    apertar('Sim, foi realizada');
    await escoar();
    const pagamento = botoesApertados.find((a) => a.titulo === 'Pagamento da sessão');
    expect(pagamento.opcoes).toEqual({ cancelable: false });
  });

  it('a presença de cada integrante do grupo também não', async () => {
    perguntarCheckin({
      ...COMPROMISSO, tipo: 'sessao_grupo',
      participantes: [{ id: 'i1', nome: 'Um' }, { id: 'i2', nome: 'Dois' }],
    }, {});
    apertar('Sim, foi realizada');
    await escoar();
    const presenca = botoesApertados.find((a) => a.titulo === 'Presença');
    expect(presenca.opcoes).toEqual({ cancelable: false });
  });
});

describe('"Fechar" fala só pela sessão que está na tela', () => {
  // O sinal que a Início usa pra decidir se continua a fila. Fechar informa
  // que ESTA não foi respondida — não que as outras devam ser engolidas.
  it('avisa que foi fechada, sem responder', () => {
    const aoConcluir = jest.fn();
    perguntarCheckin(COMPROMISSO, { aoConcluir });
    apertar('Fechar');
    expect(aoConcluir).toHaveBeenCalledWith({ fechado: true });
  });

  it('fechar o "cancelada ou falta?" também só fala por ela', () => {
    const aoConcluir = jest.fn();
    perguntarTipoNaoRealizada(COMPROMISSO, aoConcluir);
    apertar('Fechar');
    expect(aoConcluir).toHaveBeenCalledWith({ fechado: true });
  });

  it('responder não marca como fechada — a fila tem que seguir', async () => {
    const aoConcluir = jest.fn();
    perguntarCheckin(COMPROMISSO, { aoConcluir });
    await apertar('Sim, foi realizada');
    expect(aoConcluir).toHaveBeenCalledWith();
  });
});
