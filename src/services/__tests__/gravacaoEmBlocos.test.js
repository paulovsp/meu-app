// Envio da gravação em blocos. É a parte do app onde um erro custa uma
// sessão inteira gravada, então as regras que protegem o áudio estão
// travadas aqui: só o último bloco anuncia o total, bloco já aceito não é
// reenviado, e nenhum arquivo é apagado antes da gravação inteira passar.
jest.mock('expo-av', () => ({
  Audio: {
    AndroidOutputFormat: { MPEG_4: 2 },
    AndroidAudioEncoder: { AAC: 3 },
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    IOSAudioQuality: { HIGH: 96 },
    Recording: class {},
  },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../assinatura', () => ({ MENSAGEM_ASSINATURA_INATIVA: 'assinatura inativa' }));
jest.mock('../supabase', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'jwt-de-teste' } } })) },
  },
}));

const mockUploadAsync = jest.fn();
const mockDeleteAsync = jest.fn(async () => {});
jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args) => mockUploadAsync(...args),
  deleteAsync: (...args) => mockDeleteAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 1 },
}));

const {
  enviarGravacaoCompleta, enviarBlocoParaTranscricao,
  normalizarNivel, LIMIAR_SILENCIO_DBFS,
} = require('../gravacaoEmBlocos');
const { Platform } = require('react-native');

const ACEITO = { status: 200, body: '{"status":"processando"}' };

beforeEach(() => {
  mockUploadAsync.mockReset();
  mockDeleteAsync.mockReset();
  mockDeleteAsync.mockResolvedValue(undefined);
});

function cabecalhosDaChamada(n) {
  return mockUploadAsync.mock.calls[n][2].headers;
}

describe('enviarGravacaoCompleta', () => {
  it('numa gravação curta manda um bloco só, já com o total', async () => {
    mockUploadAsync.mockResolvedValue(ACEITO);
    const blocos = [{ uri: 'a.m4a', indice: 0, enviado: false }];

    await enviarGravacaoCompleta({ funcao: 'ia-transcrever', cabecalhos: { 'x-session-id': 's1' }, blocos });

    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(cabecalhosDaChamada(0)['x-bloco-indice']).toBe('0');
    expect(cabecalhosDaChamada(0)['x-bloco-total']).toBe('1');
  });

  // O total é o que avisa o servidor de que a gravação acabou. Se um bloco
  // do meio anunciasse um total, o webhook montaria o texto sem os blocos
  // que ainda estavam por vir.
  it('só o último bloco anuncia o total; os anteriores vão com 0', async () => {
    mockUploadAsync.mockResolvedValue(ACEITO);
    const blocos = [0, 1, 2].map((i) => ({ uri: `b${i}.m4a`, indice: i, enviado: false }));

    await enviarGravacaoCompleta({ funcao: 'ia-transcrever', cabecalhos: {}, blocos });

    expect(mockUploadAsync).toHaveBeenCalledTimes(3);
    expect(cabecalhosDaChamada(0)['x-bloco-total']).toBe('0');
    expect(cabecalhosDaChamada(1)['x-bloco-total']).toBe('0');
    expect(cabecalhosDaChamada(2)['x-bloco-total']).toBe('3');
  });

  // Blocos de 1h já sobem durante a gravação: no fim, reenviá-los cobraria
  // a transcrição de novo.
  it('não reenvia bloco que já tinha sido aceito', async () => {
    mockUploadAsync.mockResolvedValue(ACEITO);
    const blocos = [
      { uri: 'b0.m4a', indice: 0, enviado: true },
      { uri: 'b1.m4a', indice: 1, enviado: false },
    ];

    await enviarGravacaoCompleta({ funcao: 'ia-transcrever', cabecalhos: {}, blocos });

    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadAsync.mock.calls[0][1]).toBe('b1.m4a');
    expect(cabecalhosDaChamada(0)['x-bloco-total']).toBe('2');
  });

  it('apaga os arquivos só depois de a gravação inteira ser aceita', async () => {
    mockUploadAsync.mockResolvedValue(ACEITO);
    const blocos = [0, 1].map((i) => ({ uri: `b${i}.m4a`, indice: i, enviado: false }));

    await enviarGravacaoCompleta({ funcao: 'ia-transcrever', cabecalhos: {}, blocos });

    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsync.mock.calls.map((c) => c[0])).toEqual(['b0.m4a', 'b1.m4a']);
  });

  // Este era o furo antigo: o áudio era apagado logo depois do envio e uma
  // falha de rede virava perda total da sessão.
  it('se um bloco falha, nenhum arquivo é apagado e o que passou fica marcado', async () => {
    mockUploadAsync
      .mockResolvedValueOnce(ACEITO)
      .mockResolvedValueOnce({ status: 503, body: '{"error":"indisponível"}' });
    const blocos = [0, 1].map((i) => ({ uri: `b${i}.m4a`, indice: i, enviado: false }));

    await expect(
      enviarGravacaoCompleta({ funcao: 'ia-transcrever', cabecalhos: {}, blocos })
    ).rejects.toThrow('indisponível');

    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(blocos[0].enviado).toBe(true);
    expect(blocos[1].enviado).toBe(false);
  });
});

// O Android calcula o nível com logaritmo NATURAL onde dBFS pede base 10
// (expo-av, AVManager.java) — sem corrigir, o mesmo limiar acerta num
// sistema e erra no outro. É a diferença entre avisar que o microfone está
// mudo e deixar a pessoa gravar 50 minutos de silêncio sem saber.
describe('normalizarNivel', () => {
  const sistemaOriginal = Platform.OS;
  afterEach(() => { Platform.OS = sistemaOriginal; });

  it('no Android, converte a escala de log natural pra dBFS de verdade', () => {
    Platform.OS = 'android';
    // 10% da escala: dBFS real -20, mas o expo-av entrega 20*ln(0.1) = -46.
    expect(normalizarNivel(-46.05)).toBeCloseTo(-20, 1);
    // 1% da escala: dBFS real -40, entregue como -92.
    expect(normalizarNivel(-92.1)).toBeCloseTo(-40, 1);
    expect(normalizarNivel(0)).toBe(0);
  });

  it('no iOS, deixa passar — já é dBFS de verdade', () => {
    Platform.OS = 'ios';
    expect(normalizarNivel(-20)).toBe(-20);
    expect(normalizarNivel(-40)).toBe(-40);
  });

  it('trata o fundo da escala (-160) como silêncio nos dois sistemas', () => {
    Platform.OS = 'android';
    expect(normalizarNivel(-160)).toBe(-160);
    Platform.OS = 'ios';
    expect(normalizarNivel(-160)).toBe(-160);
  });

  // As duas pontas que o alarme precisa separar: microfone tomado por outro
  // app (zeros absolutos) x silêncio real numa sessão de análise, que pode
  // durar minutos e não pode disparar alarme nenhum.
  it('só o microfone mudo cai abaixo do limiar; sala em silêncio não', () => {
    Platform.OS = 'android';
    expect(normalizarNivel(-160)).toBeLessThan(LIMIAR_SILENCIO_DBFS);
    // Sala quieta, amplitude ~100/32767: 20*ln(0.00305) = -116 na escala do
    // Android, -50 dBFS de verdade.
    expect(normalizarNivel(-116)).toBeGreaterThan(LIMIAR_SILENCIO_DBFS);
  });
});

describe('enviarBlocoParaTranscricao', () => {
  it('sobe o arquivo como binário, autenticado, sem passar por base64', async () => {
    mockUploadAsync.mockResolvedValue(ACEITO);

    await enviarBlocoParaTranscricao({
      funcao: 'ia-transcrever', uri: 'a.m4a', cabecalhos: { 'x-session-id': 's1' },
    });

    const [url, uri, opcoes] = mockUploadAsync.mock.calls[0];
    expect(url).toBe('https://exemplo.supabase.co/functions/v1/ia-transcrever');
    expect(uri).toBe('a.m4a');
    expect(opcoes.uploadType).toBe(1); // BINARY_CONTENT
    expect(opcoes.headers.Authorization).toBe('Bearer jwt-de-teste');
    expect(opcoes.headers['Content-Type']).toBe('application/octet-stream');
    expect(opcoes.headers['x-session-id']).toBe('s1');
  });

  it('traduz falta de crédito e assinatura inativa em mensagem pra pessoa', async () => {
    mockUploadAsync.mockResolvedValue({ status: 402, body: '{"creditosInsuficientes":true}' });
    await expect(enviarBlocoParaTranscricao({ funcao: 'ia-transcrever', uri: 'a.m4a' }))
      .rejects.toThrow(/Créditos de IA insuficientes/);

    mockUploadAsync.mockResolvedValue({ status: 403, body: '{"assinaturaInativa":true}' });
    await expect(enviarBlocoParaTranscricao({ funcao: 'ia-transcrever', uri: 'a.m4a' }))
      .rejects.toThrow('assinatura inativa');
  });

  // A Edge Function pode responder 200 com corpo vazio ou HTML de proxy —
  // não pode explodir com erro de JSON em cima da pessoa.
  it('não quebra quando a resposta não é JSON', async () => {
    mockUploadAsync.mockResolvedValue({ status: 200, body: '' });
    await expect(enviarBlocoParaTranscricao({ funcao: 'ia-transcrever', uri: 'a.m4a' }))
      .resolves.toBeUndefined();

    mockUploadAsync.mockResolvedValue({ status: 500, body: '<html>erro</html>' });
    await expect(enviarBlocoParaTranscricao({ funcao: 'ia-transcrever', uri: 'a.m4a' }))
      .rejects.toThrow(/erro 500/);
  });
});
