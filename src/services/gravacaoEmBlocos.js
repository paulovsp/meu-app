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
// 3. ÁUDIO EM SILÊNCIO. Quando outro app está usando o microfone em modo de
//    chamada (Google Meet, WhatsApp — `VOICE_COMMUNICATION`, que o Android
//    trata como privilegiado), o sistema NÃO bloqueia a nossa gravação: ele
//    a silencia. O arquivo sai com a duração certa e sem uma palavra. Foi
//    isso que aconteceu nas gravações que voltaram em branco. Não há como
//    impedir pelo app — mas dá pra MEDIR o nível de entrada e avisar na
//    hora, em vez da pessoa descobrir depois que perdeu a sessão.
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { MENSAGEM_ASSINATURA_INATIVA } from './assinatura';

// `isMeteringEnabled` é o que faz o status da gravação trazer `metering`
// (nível de entrada em dBFS) — sem isso não dá pra detectar silêncio.
export const RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
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
 * Põe a leitura de nível na mesma escala nos dois sistemas.
 *
 * O iOS entrega dBFS de verdade. O Android, não: expo-av calcula
 * `20 * Math.log(amplitude / 32767)` (AVAManager.java) — logaritmo NATURAL,
 * onde a fórmula de dBFS pede log na base 10. O resultado sai ~2,3x mais
 * negativo do que deveria: 10% da escala, que é -20 dBFS, aparece como -46.
 * Sem corrigir isso, qualquer limiar acerta num sistema e erra no outro.
 *
 * -160 é o valor que os dois usam pra "nada", e passa direto.
 */
export function normalizarNivel(metering) {
  if (metering <= -160) return -160;
  return Platform.OS === 'android' ? metering / Math.LN10 : metering;
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
export function criarGravadorEmBlocos({ aoFecharBloco, aoDetectarSilencio, aoMedirNivel } = {}) {
  let gravacao = null;
  let indice = 0;
  let timerBloco = null;
  let parando = false;
  let leiturasEmSilencio = 0;
  let silencioJaAvisado = false;

  function observarNivel(status) {
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

  async function abrirBloco() {
    gravacao = new Audio.Recording();
    gravacao.setProgressUpdateInterval(1000);
    gravacao.setOnRecordingStatusUpdate(observarNivel);
    await gravacao.prepareToRecordAsync(RECORDING_OPTIONS);
    await gravacao.startAsync();
    clearTimeout(timerBloco);
    timerBloco = setTimeout(() => { trocarDeBloco().catch(() => {}); }, DURACAO_BLOCO_MS);
  }

  // Fecha o bloco atual e abre o seguinte. Só existe UM MediaRecorder nativo,
  // então não dá pra sobrepor os dois: a lacuna é o tempo de fechar e
  // reabrir (algumas centenas de milissegundos, uma vez por hora).
  async function trocarDeBloco() {
    if (parando || !gravacao) return;
    const fechando = gravacao;
    const indiceFechado = indice;
    gravacao = null;
    await fechando.stopAndUnloadAsync();
    const uri = fechando.getURI();
    indice += 1;
    await abrirBloco();
    if (uri && aoFecharBloco) await aoFecharBloco(uri, indiceFechado);
  }

  return {
    async iniciar() {
      parando = false;
      indice = 0;
      leiturasEmSilencio = 0;
      silencioJaAvisado = false;
      await abrirBloco();
    },

    /** Encerra a gravação e devolve o último bloco. `total` já é o número
     *  definitivo de blocos da gravação inteira. */
    async parar() {
      parando = true;
      clearTimeout(timerBloco);
      if (!gravacao) return { uri: null, indice, total: indice + 1 };
      const fechando = gravacao;
      gravacao = null;
      await fechando.stopAndUnloadAsync();
      return { uri: fechando.getURI(), indice, total: indice + 1 };
    },

    /** Libera o MediaRecorder nativo sem se importar com o resultado — pra
     *  desmontagem de tela. Sem isso o expo-av deixa a sessão de áudio presa
     *  e a PRÓXIMA gravação falha com "Only one Recording object can be
     *  prepared at a given time", que nem recarregar o JS resolve. */
    async liberar() {
      parando = true;
      clearTimeout(timerBloco);
      try { await gravacao?.stopAndUnloadAsync(); } catch (_) {}
      gravacao = null;
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
