// Gravação longa e envio pra transcrição — usado pela tela de Nova Sessão e
// pela de aula (FormularioCursoScreen), que gravavam com código duplicado.
//
// ─── Por que este módulo existe ──────────────────────────────────────────
// Investigação de 03/09/2026, a partir de gravações que voltavam vazias ou
// falhavam no envio. Três problemas de arquitetura, todos resolvidos aqui:
//
// 1. ENVIO. O áudio ia como texto base64 dentro de um JSON. Só ler o arquivo
//    e convertê-lo já consumia, medido: 10 min = 473ms, 38 min = 1859ms,
//    50 min = 2448ms — contra o teto de 2 SEGUNDOS de CPU por requisição da
//    Supabase. Gravação longa era matematicamente impossível de enviar.
//    Agora o arquivo sobe como binário puro, em streaming, sem passar por
//    JS em nenhum dos dois lados.
//
// 2. GRAVAÇÃO LONGA. Um .m4a só é finalizado quando a gravação para: uma
//    aula de 4h num arquivo único vira lixo irrecuperável se o app for morto
//    no minuto 200. Acima de 1h a gravação passa a ser feita em BLOCOS de
//    1h, cada um fechado e enviado enquanto a gravação continua — perde-se
//    no máximo o bloco corrente. Até 1h continua sendo um arquivo só (é o
//    caso de um bloco só, pelo mesmo caminho de código).
//
// 3. ÁUDIO EM SILÊNCIO. Quando outro app usava o microfone em modo de
//    chamada, o Android não bloqueava a nossa gravação: ele a SILENCIAVA. O
//    arquivo saía com a duração certa e sem uma palavra.
//
//    Resolvido em 05/09/2026 virando o jogo: a gravação agora usa a fonte
//    `voice_communication`, que o Android trata como privacy sensitive por
//    padrão — e uma captura privacy sensitive impede qualquer captura
//    concorrente. Ou seja, é o outro app que passa a não conseguir gravar
//    enquanto uma sessão está sendo gravada aqui, e não o contrário. É o
//    mesmo mecanismo que o Zoom usa.
//
//    A medição de nível continua, como rede de segurança: nada disso vale
//    contra uma ligação telefônica, que toma o microfone de todo mundo.
//
// ─── Quem cria o gravador ────────────────────────────────────────────────
// O objeto `AudioRecorder` do expo-audio vem de fora (hook `useAudioRecorder`
// na tela) porque é ele que amarra o ciclo de vida do recurso nativo ao da
// tela. Este módulo cuida só do que fazer com ele: blocos, nível, envio.
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { MENSAGEM_ASSINATURA_INATIVA } from './assinatura';

/**
 * Como a sessão é capturada.
 *
 * `audioSource: 'voice_communication'` é a decisão central aqui. Além de
 * garantir exclusividade do microfone (ver item 3 do cabeçalho), ela liga a
 * cadeia de voz do Android: supressão de ruído e ganho automático. Os dois
 * ajudam justamente o caso difícil — a voz do analisante, que numa sessão
 * online chega pelo alto-falante de outro aparelho, do outro lado da mesa.
 * O cancelamento de eco da mesma cadeia fica praticamente inerte, porque
 * este celular não está reproduzindo áudio nenhum durante a gravação: sem
 * sinal de referência, não há o que o eco cancele — e portanto não há o
 * risco de a voz distante ser confundida com eco e suprimida.
 *
 * `sampleRate: 16000` não é perda: a cadeia de voz do Android opera em
 * 16 kHz, e é essa também a taxa em que os modelos de transcrição
 * trabalham. Gravar a 22050 obrigava a uma reamostragem para 16 kHz em
 * algum ponto do caminho, com perda e sem ganho nenhum. Gravando direto na
 * taxa final, o áudio chega íntegro e o arquivo fica ~27% menor — o que
 * também torna o envio mais confiável.
 *
 * 64 kbps em mono a 16 kHz é bem acima do necessário pra fala: sobra
 * margem, e o custo em bytes é irrelevante.
 *
 * `isMeteringEnabled` é o que faz `getStatus()` trazer `metering` (dBFS) —
 * sem isso não dá pra detectar silêncio.
 */
export const RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    audioSource: 'voice_communication',
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'aac ',
    audioQuality: 96,
  },
};

/** Acima disso a gravação vira blocos. Abaixo, continua arquivo único —
 *  o usuário pediu explicitamente pra não fragmentar sessão comum. */
export const DURACAO_BLOCO_MS = 60 * 60 * 1000;

/**
 * Nível de entrada (dBFS) abaixo do qual não está entrando som NENHUM.
 *
 * Bem baixo de propósito. Silêncio numa sessão de análise é normal e pode
 * durar minutos — o alarme não pode disparar em pausa de conversa. O que
 * ele detecta é outra coisa: quando o microfone é tomado por outro app, o
 * Android entrega zeros absolutos, e o nível vai pro fundo da escala (-160).
 * Nem o ruído de fundo do próprio microfone chega perto de -90; uma sala
 * "em silêncio" ainda mede algo entre -60 e -40.
 */
export const LIMIAR_SILENCIO_DBFS = -90;

/** Quantas leituras seguidas abaixo do limiar até avisar. Uma leitura por
 *  segundo, então 20 = 20 segundos sem sinal nenhum. */
export const LEITURAS_ATE_ALERTA_SILENCIO = 20;

/**
 * Nível de entrada na escala dBFS, com -160 como "nada".
 *
 * Aqui existia uma correção só pro Android: o expo-av calculava o nível com
 * logaritmo NATURAL (`20 * Math.log(x)`, AVAManager.java) onde a fórmula de
 * dBFS pede log na base 10, e o valor saía ~2,3x mais negativo. O expo-audio
 * calcula certo — `20 * log10(amplitude / 32767)`, AudioRecorder.kt:70 — e a
 * correção precisou sair junto com a troca de motor, senão o limiar de
 * silêncio passaria a errar por esse mesmo fator, agora ao contrário.
 */
export function normalizarNivel(metering) {
  if (typeof metering !== 'number' || Number.isNaN(metering)) return -160;
  return metering <= -160 ? -160 : metering;
}

/**
 * Gravador que se divide em blocos sozinho quando passa de 1h.
 *
 * - `aoFecharBloco(uri, indice)`: chamado quando um bloco de 1h fecha e a
 *   gravação continua no bloco seguinte. Não é chamado no bloco final —
 *   esse volta em `parar()`.
 * - `aoDetectarSilencio()`: chamado uma única vez por gravação, quando o
 *   nível de entrada fica no chão tempo demais.
 * - `aoMedirNivel(dbfs)`: nível de entrada a cada segundo, pro medidor
 *   visual da tela.
 */
export function criarGravadorEmBlocos({ recorder, aoFecharBloco, aoDetectarSilencio, aoMedirNivel } = {}) {
  // `gravando` marca que o recorder está com um bloco aberto. Antes existia
  // um objeto Recording por bloco (expo-av só permitia um por vez); o
  // expo-audio reaproveita o mesmo recorder, gerando um arquivo novo a cada
  // prepareToRecordAsync (AudioRecorder.kt:235, nome com UUID).
  let gravando = false;
  let indice = 0;
  let timerBloco = null;
  let timerNivel = null;
  let parando = false;
  // A troca de bloco fecha um arquivo e abre outro: por algumas centenas de
  // milissegundos não há captação. Sem esta marca, `estaGravando()` leria
  // essa janela como "a gravação morreu" e dispararia alarme falso.
  let trocandoBloco = false;
  let leiturasEmSilencio = 0;
  let silencioJaAvisado = false;

  function observarNivel() {
    if (!gravando) return;
    let status;
    try {
      status = recorder.getStatus();
    } catch (_) {
      return;
    }
    if (!status?.isRecording || typeof status.metering !== 'number') return;
    const nivel = normalizarNivel(status.metering);
    if (aoMedirNivel) aoMedirNivel(nivel);
    if (silencioJaAvisado) return;
    if (nivel <= LIMIAR_SILENCIO_DBFS) {
      leiturasEmSilencio += 1;
      if (leiturasEmSilencio >= LEITURAS_ATE_ALERTA_SILENCIO) {
        silencioJaAvisado = true;
        if (aoDetectarSilencio) aoDetectarSilencio();
      }
    } else {
      leiturasEmSilencio = 0;
    }
  }

  /**
   * Com `voice_communication`, o Android passa a preferir o caminho de voz —
   * e se houver um fone Bluetooth pareado, isso pode rotear a captação pelo
   * SCO do fone, que é mono e de banda estreita. Péssimo pra uma sala com
   * duas pessoas. Quando existe o microfone do próprio aparelho na lista, é
   * ele que a gente escolhe.
   *
   * Best-effort de propósito: em aparelho onde a seleção de entrada não
   * funciona, a gravação segue no caminho padrão em vez de falhar.
   */
  function preferirMicrofoneDoAparelho() {
    try {
      const entradas = recorder.getAvailableInputs?.() || [];
      const embutido = entradas.find((e) => /built|embutid|interno/i.test(`${e.type} ${e.name}`));
      if (embutido) recorder.setInput(embutido.uid);
    } catch (_) {}
  }

  async function abrirBloco() {
    await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
    preferirMicrofoneDoAparelho();
    try {
      recorder.record();
    } catch (err) {
      // Preparado e não iniciado prende o recorder nativo: o próximo preparo
      // falharia com AlreadyPrepared, e nem recarregar o JS resolveria.
      try { await recorder.stop(); } catch (_) {}
      throw err;
    }
    gravando = true;
    clearTimeout(timerBloco);
    timerBloco = setTimeout(() => { trocarDeBloco().catch(() => {}); }, DURACAO_BLOCO_MS);
  }

  /** Fecha o bloco atual e devolve o arquivo dele. O `uri` tem que ser lido
   *  ANTES do próximo `prepareToRecordAsync`, que gera um arquivo novo. */
  async function fecharBloco() {
    await recorder.stop();
    gravando = false;
    return recorder.uri || null;
  }

  // Fecha o bloco atual e abre o seguinte. Só existe UM MediaRecorder nativo,
  // então não dá pra sobrepor os dois: a lacuna é o tempo de fechar e
  // reabrir (algumas centenas de milissegundos, uma vez por hora).
  async function trocarDeBloco() {
    if (parando || !gravando) return;
    const indiceFechado = indice;
    trocandoBloco = true;
    let uri;
    try {
      uri = await fecharBloco();
      indice += 1;
      await abrirBloco();
    } finally {
      trocandoBloco = false;
    }
    if (uri && aoFecharBloco) await aoFecharBloco(uri, indiceFechado);
  }

  return {
    async iniciar() {
      parando = false;
      indice = 0;
      leiturasEmSilencio = 0;
      silencioJaAvisado = false;
      await abrirBloco();
      // O nível vem de `getStatus()` a cada segundo. O expo-av empurrava
      // isso por callback; no expo-audio quem lê é a gente, o que também
      // deixa a leitura sob nosso controle na troca de bloco.
      clearInterval(timerNivel);
      timerNivel = setInterval(observarNivel, 1000);
    },

    /** Encerra a gravação e devolve o último bloco. `total` já é o número
     *  definitivo de blocos da gravação inteira. */
    async parar() {
      parando = true;
      clearTimeout(timerBloco);
      clearInterval(timerNivel);
      if (!gravando) return { uri: null, indice, total: indice + 1 };
      const uri = await fecharBloco();
      return { uri, indice, total: indice + 1 };
    },

    /** A gravação nativa ainda está de pé?
     *
     *  Serve pra conferir quando o app volta do segundo plano: se o Android
     *  tirou o microfone no meio (foreground service derrubado, outro app
     *  tomando o microfone), é melhor avisar na hora do que devolver uma
     *  transcrição vazia no fim da sessão. Devolve `true` durante o
     *  encerramento e a troca de bloco — nenhum dos dois é falha. */
    async estaGravando() {
      if (parando || trocandoBloco) return true;
      if (!gravando) return false;
      try {
        return !!recorder.getStatus()?.isRecording;
      } catch (_) {
        return false;
      }
    },

    /** Libera o MediaRecorder nativo sem se importar com o resultado — pra
     *  desmontagem de tela. Sem isso o recorder fica preparado a nível
     *  nativo e a PRÓXIMA gravação falha na hora de preparar
     *  (AudioRecorderAlreadyPreparedException), que nem recarregar o JS
     *  resolve, porque o estado preso é nativo. */
    async liberar() {
      parando = true;
      clearTimeout(timerBloco);
      clearInterval(timerNivel);
      // Para SEMPRE, mesmo sem `gravando`: um bloco que chegou a ser
      // preparado e não iniciado também deixa o recorder nativo preso.
      try { await recorder.stop(); } catch (_) {}
      gravando = false;
    },
  };
}

/**
 * Sobe um bloco de áudio pra Edge Function de transcrição.
 *
 * Vai como binário puro em streaming (`BINARY_CONTENT`), não como base64
 * dentro de JSON — ver o item 1 do cabeçalho deste arquivo. Como não passa
 * pelo client do Supabase, os cabeçalhos de autenticação são montados aqui.
 *
 * `total` é 0 enquanto a gravação está em andamento (ainda não se sabe
 * quantos blocos serão) e traz o número real no último bloco enviado.
 */
export async function enviarBlocoParaTranscricao({ funcao, uri, cabecalhos = {}, indice = 0, total = 1 }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre de novo para enviar a gravação.');

  const resposta = await FileSystem.uploadAsync(`${SUPABASE_URL}/functions/v1/${funcao}`, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/octet-stream',
      'x-bloco-indice': String(indice),
      'x-bloco-total': String(total),
      ...cabecalhos,
    },
  });

  let corpo = {};
  try { corpo = JSON.parse(resposta.body || '{}'); } catch (_) {}

  if (resposta.status >= 400 || corpo?.error) {
    if (corpo?.assinaturaInativa) throw new Error(MENSAGEM_ASSINATURA_INATIVA);
    if (corpo?.creditosInsuficientes) {
      throw new Error('Créditos de IA insuficientes para transcrever. Fale com o administrador da conta.');
    }
    throw new Error(corpo?.error || `Falha ao enviar o áudio (erro ${resposta.status}).`);
  }
}

/**
 * Envia todos os blocos que ainda não foram aceitos, em ordem, e só então
 * apaga os arquivos.
 *
 * `blocos` é a lista viva da tela ({ uri, indice, enviado }) — cada item é
 * marcado como enviado assim que é aceito, então uma nova tentativa depois
 * de uma falha não reenvia o que já passou. O arquivo de um bloco NUNCA é
 * apagado antes de a gravação inteira ter sido aceita: era exatamente esse
 * o furo que fazia uma gravação boa virar perda total quando o envio falhava.
 */
export async function enviarGravacaoCompleta({ funcao, cabecalhos, blocos }) {
  const total = blocos.length;
  for (const bloco of blocos) {
    if (bloco.enviado) continue;
    await enviarBlocoParaTranscricao({
      funcao,
      uri: bloco.uri,
      cabecalhos,
      indice: bloco.indice,
      // Só o último bloco carrega o total definitivo: é ele que avisa o
      // servidor de que a gravação acabou e quantos blocos esperar.
      total: bloco.indice === total - 1 ? total : 0,
    });
    bloco.enviado = true;
  }
  await apagarBlocos(blocos);
}

/** Apaga os arquivos de áudio do cache. Chamada depois do envio aceito e
 *  também quando a pessoa desiste e escolhe digitar à mão — em nenhum
 *  caminho o áudio fica largado. */
export async function apagarBlocos(blocos) {
  for (const bloco of blocos) {
    try { await FileSystem.deleteAsync(bloco.uri, { idempotent: true }); } catch (_) {}
  }
}

/** Teto do arquivo importado. Bem abaixo do limite da AssemblyAI (2,2 GB):
 *  o gargalo aqui é a Edge Function que repassa os bytes, não ela. */
export const TAMANHO_MAXIMO_IMPORTACAO_BYTES = 1024 ** 3;

/**
 * Deixa a pessoa escolher um áudio já existente no aparelho (gravado por
 * outro app, recebido de alguém, exportado de uma chamada) em vez de gravar
 * na hora. Devolve `null` se ela desistir.
 *
 * `copyToCacheDirectory` fica ligado de propósito: o que é enviado — e
 * apagado depois — é uma CÓPIA no cache do app, nunca o arquivo original da
 * pessoa.
 */
export async function escolherArquivoDeAudio() {
  const resultado = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (resultado.canceled || !resultado.assets?.length) return null;

  const arquivo = resultado.assets[0];
  // Arquivo importado vai inteiro, num bloco só — diferente da gravação
  // feita aqui, que já sai partida de hora em hora. Barra antes de começar,
  // com o que fazer, em vez de deixar o envio morrer no meio.
  if (Number(arquivo.size) > TAMANHO_MAXIMO_IMPORTACAO_BYTES) {
    const tamanhoGB = (Number(arquivo.size) / 1024 ** 3).toFixed(1);
    throw new Error(
      `Este arquivo tem ${tamanhoGB} GB e é grande demais para enviar de uma vez `
      + '(o limite é 1 GB). Converta o áudio para um formato mais leve, como '
      + 'M4A ou MP3, ou divida-o em partes e importe uma de cada vez.'
    );
  }
  return arquivo;
}

export const MENSAGEM_SILENCIO = (
  'Não está entrando som no microfone. Isso costuma acontecer quando outro '
  + 'app está em chamada no mesmo aparelho (Google Meet, Zoom, WhatsApp): o '
  + 'Android dá o microfone pra chamada e a gravação sai muda, mesmo '
  + 'parecendo normal.\n\nEncerre a chamada neste aparelho e grave de novo, '
  + 'ou faça a chamada em outro dispositivo.'
);
