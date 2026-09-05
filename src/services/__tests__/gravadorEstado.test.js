// Ciclo de vida do gravador em blocos, agora sobre o recorder do expo-audio.
//
// Duas coisas travadas aqui:
//
// 1. `estaGravando()` — a checagem que a tela faz quando o app volta do
//    segundo plano, pra descobrir se o Android derrubou a captação enquanto
//    ninguém estava olhando. O que precisa estar certo é o CONTRÁRIO do
//    óbvio: não dar alarme falso. A troca de bloco fecha um arquivo e abre
//    outro, e sem a marca `trocandoBloco` essa janela seria lida como "a
//    gravação morreu" — a psicanalista veria "gravação interrompida" no meio
//    de uma sessão que está gravando normalmente.
//
// 2. A troca de bloco tem que ler o `uri` do arquivo ANTES de preparar o
//    seguinte: o expo-audio gera um nome novo a cada `prepareToRecordAsync`,
//    então ler depois devolveria o arquivo errado — e o bloco de uma hora de
//    sessão iria embora.
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../assinatura', () => ({ MENSAGEM_ASSINATURA_INATIVA: 'assinatura inativa' }));
jest.mock('../supabase', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  supabase: { auth: { getSession: jest.fn() } },
}));
jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: jest.fn(),
  deleteAsync: jest.fn(async () => {}),
  FileSystemUploadType: { BINARY_CONTENT: 1 },
}));

const { criarGravadorEmBlocos, DURACAO_BLOCO_MS } = require('../gravacaoEmBlocos');

/** Dublê do AudioRecorder do expo-audio: mesmo contrato que o módulo usa. */
function criarRecorderFalso() {
  let preparado = 0;
  const r = {
    uri: null,
    gravando: false,
    entradas: [],
    entradaEscolhida: null,
    pausaAoParar: null,
    async prepareToRecordAsync() {
      preparado += 1;
      r.uri = `file://bloco-${preparado}.m4a`;
    },
    record() { r.gravando = true; },
    async stop() {
      if (r.pausaAoParar) await r.pausaAoParar;
      r.gravando = false;
    },
    getStatus() {
      return { canRecord: true, isRecording: r.gravando, metering: -20, url: r.uri };
    },
    getAvailableInputs() { return r.entradas; },
    setInput(uid) { r.entradaEscolhida = uid; },
  };
  return r;
}

describe('estaGravando', () => {
  it('é true com a gravação em andamento', async () => {
    const recorder = criarRecorderFalso();
    const g = criarGravadorEmBlocos({ recorder });
    await g.iniciar();
    expect(await g.estaGravando()).toBe(true);
    await g.parar();
  });

  // O caso que interessa: o Android matou a captação por fora.
  it('é false quando a captação nativa parou sozinha', async () => {
    const recorder = criarRecorderFalso();
    const g = criarGravadorEmBlocos({ recorder });
    await g.iniciar();
    recorder.gravando = false;
    expect(await g.estaGravando()).toBe(false);
    await g.liberar();
  });

  it('é false antes de começar', async () => {
    const g = criarGravadorEmBlocos({ recorder: criarRecorderFalso() });
    expect(await g.estaGravando()).toBe(false);
  });

  it('é true durante o encerramento, que não é falha', async () => {
    const g = criarGravadorEmBlocos({ recorder: criarRecorderFalso() });
    await g.iniciar();
    await g.parar();
    expect(await g.estaGravando()).toBe(true);
  });
});

describe('troca de bloco', () => {
  // O callback de 1h é capturado e chamado à mão — senão o teste precisaria
  // esperar uma hora de relógio.
  function capturarTimerDeBloco() {
    const agendados = [];
    const real = global.setTimeout;
    global.setTimeout = (fn, ms) => {
      if (ms === DURACAO_BLOCO_MS) { agendados.push(fn); return agendados.length; }
      return real(fn, ms);
    };
    return { agendados, restaurar: () => { global.setTimeout = real; } };
  }

  // O callback do timer não devolve promessa (ele engole a rejeição, de
  // propósito, pra uma falha na troca não derrubar a gravação inteira).
  // Então o jeito de esperar a troca terminar é drenar a fila.
  const drenar = () => new Promise((r) => setTimeout(r, 0));

  it('entrega o arquivo do bloco fechado, não o do bloco novo', async () => {
    const { agendados, restaurar } = capturarTimerDeBloco();
    const recorder = criarRecorderFalso();
    const fechados = [];
    const g = criarGravadorEmBlocos({
      recorder,
      aoFecharBloco: async (uri, indice) => { fechados.push({ uri, indice }); },
    });
    try {
      await g.iniciar();
      agendados[0]();
      await drenar();

      expect(fechados).toEqual([{ uri: 'file://bloco-1.m4a', indice: 0 }]);
      const final = await g.parar();
      expect(final).toEqual({ uri: 'file://bloco-2.m4a', indice: 1, total: 2 });
    } finally {
      await g.liberar();
      restaurar();
    }
  });

  it('não dá alarme falso na janela entre fechar e reabrir', async () => {
    const { agendados, restaurar } = capturarTimerDeBloco();
    const recorder = criarRecorderFalso();
    const g = criarGravadorEmBlocos({ recorder, aoFecharBloco: async () => {} });
    try {
      await g.iniciar();

      let soltar;
      recorder.pausaAoParar = new Promise((r) => { soltar = r; });
      agendados[0]();
      await Promise.resolve();

      expect(await g.estaGravando()).toBe(true);

      recorder.pausaAoParar = null;
      soltar();
      await drenar();
      expect(await g.estaGravando()).toBe(true);
    } finally {
      await g.liberar();
      restaurar();
    }
  });
});

describe('escolha do microfone', () => {
  // Com `voice_communication`, o Android tende a rotear a captação pelo SCO
  // de um fone Bluetooth pareado — mono, banda estreita, péssimo pra uma
  // sala com duas pessoas. O gravador força o microfone do aparelho.
  it('prefere o microfone do próprio aparelho quando ele existe', async () => {
    const recorder = criarRecorderFalso();
    recorder.entradas = [
      { uid: 'bt-1', name: 'Fone JBL', type: 'Bluetooth' },
      { uid: 'mic-1', name: 'Microfone', type: 'Built-in Microphone' },
    ];
    const g = criarGravadorEmBlocos({ recorder });
    await g.iniciar();
    expect(recorder.entradaEscolhida).toBe('mic-1');
    await g.liberar();
  });

  it('não escolhe nada quando o aparelho não lista entradas', async () => {
    const recorder = criarRecorderFalso();
    const g = criarGravadorEmBlocos({ recorder });
    await g.iniciar();
    expect(recorder.entradaEscolhida).toBeNull();
    await g.liberar();
  });
});
