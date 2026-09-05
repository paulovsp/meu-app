import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, FlatList, TextInput, Linking,
  Platform, KeyboardAvoidingView, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import MedidorDeEntrada from '../components/MedidorDeEntrada';
import { Audio } from 'expo-av';
// @notifee/react-native foi arquivado pela Invertase em 07/04/2026 — trocado
// pelo fork mantido react-native-notify-kit (mesmo autor original recomenda
// no README do projeto arquivado). API 100% compatível — só o caminho do
// import muda; classe Java do foreground service continua sendo
// app.notifee.core.ForegroundService (confirmado no pacote), então o plugin
// plugins/withForegroundServiceMicrophone.js não precisou mudar nada.
import notifee, { AndroidImportance, AndroidForegroundServiceType } from 'react-native-notify-kit';
import { Ionicons } from '@expo/vector-icons';
import {
  listarPacientes, addSession, updateSession,
  parseTranscriptToTurns,
  saveTranscriptTurns,
} from '../services/database';
import { getStatusAutorizacao } from '../services/autorizacaoGravacao';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import {
  criarGravadorEmBlocos, enviarBlocoParaTranscricao, enviarGravacaoCompleta,
  apagarBlocos, escolherArquivoDeAudio, MENSAGEM_SILENCIO,
} from '../services/gravacaoEmBlocos';
import {
  getIntegracaoMeet, integracaoUtilizavel, criarSalaMeet,
} from '../services/videochamada';

// ─── Steps ─────────────────────────────────────────────────────
const STEPS = {
  SELECT_PATIENT: 0,
  SELECT_TYPE: 1,
  SELECT_PLATFORM: 2,
  RECORDING: 3,
  REVIEW: 4,
  // Sessão pelo Meet: sem gravação nenhuma no aparelho — o app cria a sala e
  // o texto vem pronto do Google depois. Ver src/services/videochamada.js.
  MEET: 5,
};

const PLATFORMS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: 'logo-whatsapp',
    color: '#25D366',
    url: 'whatsapp://',
    instrucaoVivavoz: 'Ative o viva-voz assim que a chamada conectar.',
  },
  {
    id: 'meet',
    label: 'Google Meet',
    icon: 'videocam-outline',
    color: '#447362',
    url: 'https://meet.google.com',
    instrucaoVivavoz: 'No Meet, toque em ⋮ → Alto-falante para ativar o viva-voz.',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    icon: 'desktop-outline',
    color: '#4D6B88',
    url: 'zoomus://',
    instrucaoVivavoz: 'No Zoom, toque em "Alto-falante" na barra inferior.',
  },
  {
    id: 'telefone',
    label: 'Telefone',
    icon: 'call-outline',
    color: '#875B50',
    url: 'tel:',
    instrucaoVivavoz: 'Durante a chamada, toque em "Viva-voz" na tela do telefone.',
  },
];

// ─── introdução descritiva fixa da transcrição ────────────────────────────
// Prefixada ao texto salvo em `transcript` (não aos turnos usados na
// visualização em conversa) para dar contexto explícito — analisante,
// modalidade, data e duração — ajudando a IA do Buscador Dr.Sig a entender
// do que se trata cada sessão ao pesquisar nas transcrições.
function formatarDataExtenso(data) {
  const dataFmt = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaFmt = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dataFmt} às ${horaFmt}`;
}

function gerarIntroducaoSessao({ tipo, plataforma, pacienteNome, data, duracaoFormatada }) {
  const modalidade = tipo === 'online'
    ? `sessão online${plataforma?.label ? ` via ${plataforma.label}` : ''}`
    : 'sessão presencial';
  const nome = pacienteNome || 'analisante não identificado';
  const duracaoTexto = duracaoFormatada ? `, com duração de ${duracaoFormatada}` : '';
  return (
    `Transcrição de ${modalidade}, referente ao analisante ${nome}, realizada em ` +
    `${formatarDataExtenso(data)}${duracaoTexto}. Este documento contém a transcrição ` +
    `literal da conversa entre analista e analisante durante o atendimento.`
  );
}

export default function NovaSessaoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const prePatientId = route?.params?.patientId || null;
  // Presente quando a sessão nasce de um compromisso da Agenda (ver
  // DetalheCompromissoScreen.js `iniciarSessao`) — liga a sessão ao
  // compromisso pra tela "Sessões sem relato" conseguir cruzar os dois.
  const appointmentId = route?.params?.appointmentId || null;

  useBloqueioAssinatura(navigation);

  // ─── Estados ──────────────────────────────────────────────
  const [step, setStep] = useState(STEPS.SELECT_PATIENT);
  const [pacientes, setPacientes] = useState([]);
  const [paciente, setPaciente] = useState(null);
  const [tipo, setTipo] = useState(null);
  const [plataforma, setPlataforma] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [preparandoGravacao, setPreparandoGravacao] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [progressoTranscricao, setProgressoTranscricao] = useState('');
  const [transcricao, setTranscricao] = useState('');
  // true = transcrição assíncrona disparada com sucesso (aguarda webhook /
  // push); false = falhou o disparo, cai pro fallback de digitar manualmente.
  const [transcricaoAssincrona, setTranscricaoAssincrona] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracaoFinal, setDuracaoFinal] = useState(0);
  const [autorizacaoStatus, setAutorizacaoStatus] = useState(null);
  const gravacaoAutorizada = autorizacaoStatus === 'autorizada';
  // Nível de entrada do microfone em dBFS, pro medidor ao vivo. `null`
  // enquanto nenhuma leitura chegou.
  const [nivelEntrada, setNivelEntrada] = useState(null);
  // true quando sobrou bloco de áudio sem enviar: habilita "tentar de novo"
  // em vez de a gravação virar perda total.
  const [podeReenviar, setPodeReenviar] = useState(false);
  // Conexão com o Google Meet. `null` = ainda carregando; o resto da tela usa
  // `meetDisponivel` pra decidir entre a sessão pelo Meet (sem gravação) e o
  // caminho antigo, por microfone.
  const [integracaoMeet, setIntegracaoMeet] = useState(null);
  const [salaMeet, setSalaMeet] = useState(null);
  const [criandoSala, setCriandoSala] = useState(false);
  const meetDisponivel = integracaoUtilizavel(integracaoMeet);

  // ─── Refs ─────────────────────────────────────────────────
  const gravadorRef = useRef(null);
  // Blocos da gravação atual ({ uri, indice, enviado }). Os arquivos só são
  // apagados quando a gravação INTEIRA foi aceita pelo servidor.
  const blocosRef = useRef([]);
  const timerRef = useRef(null);
  const notificationIdRef = useRef(null);
  const sessionIdRef = useRef(null);

  // ─── Efeitos ──────────────────────────────────────────────
  useEffect(() => {
    async function carregar() {
      try {
        const lista = await listarPacientes();
        setPacientes(lista);
        if (prePatientId) {
          const p = lista.find(x => x.id === prePatientId);
          if (p) { setPaciente(p); setStep(STEPS.SELECT_TYPE); }
        }
      } catch (e) {
        Alert.alert('Erro ao carregar analisantes', mensagemDeErro(e));
      }
    }
    carregar();
    // Lido uma vez, na abertura: decide o fluxo da sessão online antes de a
    // pessoa escolher a plataforma, pra ela nunca descobrir que não dá
    // depois da sessão feita.
    getIntegracaoMeet().then(setIntegracaoMeet).catch(() => setIntegracaoMeet(null));
  }, []);

  // Trava QUALQUER forma de sair da tela (seta do cabeçalho — que muda
  // `step` internamente, não passa por aqui —, gesto de voltar do iOS,
  // botão físico/gesto de voltar do Android) enquanto a sessão anterior
  // ainda está sendo salva/enviada. Sem isso, dava pra sair no meio do
  // envio e voltar (ou abrir outra sessão), disparando uma segunda
  // gravação por cima da que ainda estava sendo finalizada — ver o
  // comentário em iniciarGravacao().
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!transcrevendo) return;
      e.preventDefault();
      Alert.alert(
        'Aguarde',
        'A sessão ainda está sendo salva e enviada para transcrição. Sair agora arrisca corromper a gravação — aguarde terminar.'
      );
    });
    return unsubscribe;
  }, [navigation, transcrevendo]);

  // ─── Autorização de gravação: exigida antes de gravar ─────
  useEffect(() => {
    if (!paciente) { setAutorizacaoStatus(null); return; }
    let ativo = true;
    getStatusAutorizacao(paciente.id).then((autorizacao) => {
      if (ativo) setAutorizacaoStatus(autorizacao?.status || null);
    });
    return () => { ativo = false; };
  }, [paciente]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      notifee.createChannel({
        id: 'gravacao',
        name: 'Gravação de Sessão',
        importance: AndroidImportance.LOW,
        sound: undefined,
      });
    }
    return () => {
      clearInterval(timerRef.current);
      // Libera a gravação nativa se a tela for fechada no meio de uma
      // gravação (ex: usuário navega pra trás). Sem isso, o expo-av mantém
      // a sessão de áudio "presa" a nível nativo, e a PRÓXIMA tentativa de
      // gravar (mesmo em uma tela nova) falha com "Only one Recording
      // object can be prepared at a given time" — só um reload de JS não
      // resolve, porque o estado preso é nativo, não do JavaScript.
      gravadorRef.current?.liberar().catch(() => {});
      // Encerra o foreground service se a tela for fechada com a gravação
      // ainda ativa — sem isso, a notificação/serviço fica "preso" mesmo
      // sem gravação nenhuma rolando.
      notifee.stopForegroundService().catch(() => {});
    };
  }, []);

  // ─── Helpers ──────────────────────────────────────────────
  function formatarTempo(seg) {
    const m = Math.floor(seg / 60).toString().padStart(2, '0');
    const s = (seg % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ─── Notificação / foreground service ──────────────────────
  // Um foreground service de verdade (via notifee) — não uma notificação
  // local cosmética — é o que impede o Android de suspender o processo e
  // interromper a gravação quando o app vai pra segundo plano ou a tela
  // desliga.
  async function mostrarNotificacaoGravacao() {
    try {
      await notifee.requestPermission();
      const id = await notifee.displayNotification({
        title: 'Gravando sessão',
        body: 'Sua sessão está sendo gravada em segundo plano.',
        android: {
          channelId: 'gravacao',
          asForegroundService: true,
          foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE],
          ongoing: true,
        },
      });
      notificationIdRef.current = id;
    } catch (err) {
      // Antes só um console.warn — ninguém vê isso em produção. Sem o
      // foreground service de verdade, o Android pode suspender o
      // microfone quando a tela apaga ou o app é minimizado: a gravação
      // "continua" (duração certa) mas fica sem fala nenhuma captada —
      // exatamente o sintoma relatado ("arquivo em branco" em gravações
      // longas). Avisa na hora, pra pessoa saber que precisa manter a
      // tela ligada e o app aberto até encerrar, em vez de descobrir só
      // depois que a transcrição voltou vazia.
      console.warn('Notificação:', err.message);
      Alert.alert(
        'Proteção em segundo plano indisponível',
        'Não foi possível ativar a notificação que mantém a gravação ativa com a tela apagada ou o app minimizado. Mantenha esta tela aberta e a tela do celular ligada até encerrar a sessão, para não arriscar perder o áudio.'
      );
    }
  }

  async function removerNotificacaoGravacao() {
    try {
      await notifee.stopForegroundService();
      if (notificationIdRef.current) {
        await notifee.cancelNotification(notificationIdRef.current);
        notificationIdRef.current = null;
      }
    } catch (_) {}
  }

  // ─── Gravação ─────────────────────────────────────────────
  async function iniciarGravacao() {
    // Trava de segurança contra o bug real reportado: com o header/gesto de
    // voltar do Android desprotegidos (ver useEffect de beforeRemove abaixo
    // e o onVoltar deste step), dava pra chegar de novo neste botão enquanto
    // a sessão anterior ainda estava sendo finalizada (encerrarETranscrever
    // ainda rodando em segundo plano). Começar aqui troca o gravador por
    // baixo daquele fluxo, que ainda está lendo o áudio — as duas gravações
    // brigam pelo único MediaRecorder nativo disponível, corrompendo o áudio
    // da primeira (arquivo com a duração certa, mas sem fala nenhuma) ou
    // derrubando com erro. Esta checagem é a defesa definitiva: mesmo que
    // algum caminho de UI escape das outras travas, aqui a segunda gravação
    // nunca chega a começar de verdade.
    if (transcrevendo) {
      Alert.alert(
        'Aguarde',
        'A sessão anterior ainda está sendo salva e enviada para transcrição. Aguarde terminar antes de iniciar uma nova gravação — começar agora arrisca corromper a gravação em andamento.'
      );
      return;
    }
    if (!gravacaoAutorizada) {
      Alert.alert('Autorização necessária', `${paciente?.nome} ainda não autorizou a gravação e transcrição das sessões.`);
      return;
    }
    setPreparandoGravacao(true);
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permissão negada', 'Precisamos de acesso ao microfone.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
      });

      // Garante que nenhuma gravação anterior ficou "presa" antes de
      // preparar uma nova — o expo-av só permite uma gravação ativa por
      // vez a nível nativo; tentar preparar sem liberar a anterior gera
      // o erro "Only one Recording object can be prepared at a given time".
      await gravadorRef.current?.liberar();

      blocosRef.current = [];
      setPodeReenviar(false);
      setNivelEntrada(null);
      gravadorRef.current = criarGravadorEmBlocos({
        aoFecharBloco: enviarBlocoFechado,
        aoMedirNivel: setNivelEntrada,
        aoDetectarSilencio: () => Alert.alert('Sem som no microfone', MENSAGEM_SILENCIO),
      });
      await gravadorRef.current.iniciar();

      setGravando(true);
      setTempo(0);
      timerRef.current = setInterval(() => setTempo(t => t + 1), 1000);
      await mostrarNotificacaoGravacao();
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível iniciar a gravação:\n' + err.message);
    } finally {
      setPreparandoGravacao(false);
    }
  }

  // ─── Transcrição via Edge Function (proxy da AssemblyAI + créditos de IA) ──
  // Assíncrona: o envio só dispara o pedido de transcrição (upload + submit
  // na AssemblyAI) e volta — não espera o texto pronto. O resultado chega
  // depois via webhook (`ia-transcrever-webhook`), que atualiza a sessão e
  // manda um push. Ver DetalheSessaoScreen.js para o estado "processando".

  /** A sessão precisa existir antes do primeiro envio de áudio. Numa
   *  gravação curta isso acontece só no fim, como sempre; numa que passa de
   *  1h, o primeiro bloco fecha antes disso e a sessão nasce ali. */
  async function garantirSessao() {
    if (sessionIdRef.current) return sessionIdRef.current;
    const sid = await addSession(paciente.id, tipo, plataforma?.id || null, null, appointmentId);
    sessionIdRef.current = sid;
    return sid;
  }

  /** Um bloco de 1h fechou e a gravação continua: sobe ele agora, em vez de
   *  deixar tudo pro fim. Se falhar, o arquivo fica guardado e vai junto na
   *  tentativa final — nunca se perde bloco por falha de rede no meio. */
  async function enviarBlocoFechado(uri, indice) {
    const bloco = { uri, indice, enviado: false };
    blocosRef.current.push(bloco);
    try {
      const sid = await garantirSessao();
      await enviarBlocoParaTranscricao({
        funcao: 'ia-transcrever',
        uri,
        cabecalhos: { 'x-session-id': sid },
        indice,
        total: 0, // a gravação ainda está rolando; o total vai no último
      });
      bloco.enviado = true;
    } catch (_) {}
  }

  /** Sobe todos os blocos ainda não aceitos e só então apaga os arquivos. */
  async function enviarTudo(sid) {
    setProgressoTranscricao(
      blocosRef.current.length > 1
        ? `Enviando ${blocosRef.current.length} blocos de áudio...`
        : 'Enviando para transcrição...'
    );
    await enviarGravacaoCompleta({
      funcao: 'ia-transcrever',
      cabecalhos: { 'x-session-id': sid },
      blocos: blocosRef.current,
    });
    blocosRef.current = [];
    setPodeReenviar(false);
    setTranscricaoAssincrona(true);
  }

  // ─── Encerrar e transcrever ───────────────────────────────
  async function encerrarETranscrever() {
    clearInterval(timerRef.current);
    const duracao = tempo;
    setDuracaoFinal(duracao);
    setGravando(false);
    setTranscrevendo(true);
    setProgressoTranscricao('Finalizando gravação...');

    await removerNotificacaoGravacao();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });

    try {
      const { uri, indice } = await gravadorRef.current.parar();
      if (!uri) throw new Error('O arquivo de áudio não foi encontrado após a gravação.');
      blocosRef.current.push({ uri, indice, enviado: false });

      setProgressoTranscricao('Salvando sessão...');
      const sid = await garantirSessao();

      const introducao = gerarIntroducaoSessao({
        tipo, plataforma, pacienteNome: paciente?.nome,
        data: new Date(), duracaoFormatada: duracao ? formatarTempo(duracao) : null,
      });
      await updateSession(sid, {
        transcript: introducao,
        audio_uri: null,
        category: null,
        duration_seconds: duracao || null,
      });

      await enviarTudo(sid);
    } catch (err) {
      // O áudio continua no aparelho — a próxima tela oferece tentar de novo
      // em vez de a gravação virar perda total.
      setPodeReenviar(blocosRef.current.length > 0);
      Alert.alert(
        'Erro ao enviar para transcrição',
        err.message + '\n\nO áudio não foi perdido: na próxima tela dá para tentar enviar de novo.',
      );
      setTranscricaoAssincrona(false);
    } finally {
      setTranscrevendo(false);
      setProgressoTranscricao('');
      setNivelEntrada(null);
      setStep(STEPS.REVIEW);
    }
  }

  /** Transcrever um áudio que já existe no aparelho, em vez de gravar na
   *  hora — sessão gravada por outro aparelho, gravação exportada de uma
   *  chamada, etc. Daqui pra frente é o mesmo caminho da gravação. */
  async function importarAudio() {
    if (!gravacaoAutorizada) {
      Alert.alert('Autorização necessária', `${paciente?.nome} ainda não autorizou a gravação e transcrição das sessões.`);
      return;
    }
    let arquivo;
    try {
      arquivo = await escolherArquivoDeAudio();
    } catch (err) {
      Alert.alert('Não dá para enviar este arquivo', err.message);
      return;
    }
    if (!arquivo) return;

    setTranscrevendo(true);
    setProgressoTranscricao('Salvando sessão...');
    try {
      blocosRef.current = [{ uri: arquivo.uri, indice: 0, enviado: false }];
      const sid = await garantirSessao();
      // Sem duração conhecida: o arquivo veio de fora, e o valor que vale
      // pra cobrança é o que a AssemblyAI mede no áudio de verdade.
      const introducao = gerarIntroducaoSessao({
        tipo, plataforma, pacienteNome: paciente?.nome,
        data: new Date(), duracaoFormatada: null,
      });
      await updateSession(sid, {
        transcript: introducao, audio_uri: null, category: null, duration_seconds: null,
      });
      await enviarTudo(sid);
    } catch (err) {
      setPodeReenviar(blocosRef.current.length > 0);
      Alert.alert('Erro ao enviar para transcrição', err.message);
      setTranscricaoAssincrona(false);
    } finally {
      setTranscrevendo(false);
      setProgressoTranscricao('');
      setStep(STEPS.REVIEW);
    }
  }

  // ─── Sessão pelo Google Meet ──────────────────────────────
  // Nada é gravado no aparelho: o app cria a sala, o Google transcreve, e o
  // texto chega depois (cron meet-buscar-transcricao). É o caminho que
  // resolve de vez o áudio mudo — sem microfone, não há disputa com a
  // chamada rodando no mesmo celular.
  async function iniciarSessaoMeet() {
    if (!gravacaoAutorizada) {
      Alert.alert(
        'Autorização necessária',
        `${paciente?.nome} ainda não autorizou a gravação e transcrição das sessões. `
        + 'O aviso do próprio Meet não substitui essa autorização.'
      );
      return;
    }
    setCriandoSala(true);
    try {
      const sid = await garantirSessao();
      const introducao = gerarIntroducaoSessao({
        tipo, plataforma, pacienteNome: paciente?.nome,
        data: new Date(), duracaoFormatada: null,
      });
      await updateSession(sid, {
        transcript: introducao, audio_uri: null, category: null, duration_seconds: null,
      });
      const sala = await criarSalaMeet(sid);
      setSalaMeet(sala);
    } catch (err) {
      // O servidor confere autorização, assinatura e plano — cada motivo tem
      // uma saída diferente, então não vale mostrar tudo como "deu erro".
      if (err.semAutorizacao) {
        Alert.alert('Autorização necessária', err.message);
      } else if (err.precisaConectar) {
        Alert.alert('Conta do Google desconectada', `${err.message}

Perfil → Sessões online pelo Google Meet.`);
        setIntegracaoMeet(null);
      } else if (err.semTranscricaoAutomatica) {
        Alert.alert(
          'Plano sem transcrição automática',
          `${err.message}

Você pode fazer a sessão normalmente e gravar pelo aparelho — de preferência com a chamada em outro dispositivo.`
        );
        setIntegracaoMeet(null);
        setStep(STEPS.RECORDING);
      } else {
        Alert.alert('Erro ao criar a sala', mensagemDeErro(err));
      }
    } finally {
      setCriandoSala(false);
    }
  }

  async function compartilharLinkMeet() {
    if (!salaMeet?.meetingUri) return;
    try {
      await Share.share({
        message: `Link da nossa sessão: ${salaMeet.meetingUri}`,
      });
    } catch (_) {}
  }

  /** "Tentar novamente" da tela de revisão: reenvia só o que ainda não foi
   *  aceito (cada bloco guarda se já passou). */
  async function tentarEnviarDeNovo() {
    setTranscrevendo(true);
    try {
      const sid = await garantirSessao();
      await enviarTudo(sid);
    } catch (err) {
      Alert.alert('Ainda não foi', mensagemDeErro(err));
    } finally {
      setTranscrevendo(false);
      setProgressoTranscricao('');
    }
  }

  // ─── Salvar ───────────────────────────────────────────────
  async function salvarSessao() {
    if (!paciente) return;
    if (!transcricao.trim()) {
      Alert.alert('Atenção', 'A transcrição está vazia. Deseja salvar mesmo assim?', [
        { text: 'Não', style: 'cancel' },
        { text: 'Sim', onPress: () => salvarSessaoConfirmado() },
      ]);
      return;
    }
    await salvarSessaoConfirmado();
  }

  async function salvarSessaoConfirmado() {
    setSalvando(true);
    try {
      // A sessão já foi criada em encerrarETranscrever (precisa existir
      // antes de disparar a transcrição) — aqui só atualiza com o texto
      // digitado manualmente (fallback de quando o disparo assíncrono falha).
      const sid = await garantirSessao();

      const introducao = gerarIntroducaoSessao({
        tipo,
        plataforma,
        pacienteNome: paciente?.nome,
        data: new Date(),
        duracaoFormatada: duracaoFinal ? formatarTempo(duracaoFinal) : null,
      });
      const transcriptFinal = transcricao.trim()
        ? `${introducao}\n\n${transcricao.trim()}`
        : introducao;

      await updateSession(sid, {
        transcript: transcriptFinal,
        audio_uri: null,
        category: null,
        duration_seconds: duracaoFinal || null,
      });

      // Parse e salva os turnos
      const turns = parseTranscriptToTurns(transcricao);
      if (turns.length > 0) {
        await saveTranscriptTurns(sid, turns);
      }

      // A pessoa optou por digitar em vez de tentar o envio de novo: o áudio
      // não serve mais pra nada e não pode ficar largado no aparelho.
      await apagarBlocos(blocosRef.current);
      blocosRef.current = [];

      Alert.alert('Sessão salva!', '', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  // ─── Preview de turnos ────────────────────────────────────
  // Calcula contagem de turnos por falante para exibir no painel
  function calcularContagem(texto) {
    const turns = parseTranscriptToTurns(texto);
    const contagem = turns.reduce((acc, t) => {
      acc[t.speaker] = (acc[t.speaker] || 0) + 1;
      return acc;
    }, {});
    return { turns, contagem };
  }

  const { turns: turnsPreview, contagem } = calcularContagem(transcricao);

  const isOnline = tipo === 'online';

  // ── STEP 0: Selecionar paciente ───────────────────────────
  if (step === STEPS.SELECT_PATIENT) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Nova Sessão" onVoltar={() => navigation.goBack()} />
        <View style={s.container}>
        <Text style={s.sub}>Selecione o analisante:</Text>
        <FlatList
          data={pacientes}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              onPress={() => { setPaciente(item); setStep(STEPS.SELECT_TYPE); }}
            >
              <Text style={s.cardText}>{item.nome}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>Nenhum analisante cadastrado.</Text>}
        />
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 1: Presencial ou Online ──────────────────────────
  if (step === STEPS.SELECT_TYPE) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Nova Sessão" onVoltar={() => setStep(STEPS.SELECT_PATIENT)} />
        <View style={s.container}>
        <Text style={s.sub}>Analisante: <Text style={s.bold}>{paciente?.nome}</Text></Text>
        <Text style={s.sub}>Tipo de sessão:</Text>

        <TouchableOpacity
          style={[s.typeBtn, { backgroundColor: '#497363' }]}
          onPress={() => { setTipo('presencial'); setPlataforma(null); setStep(STEPS.RECORDING); }}
        >
          <Ionicons name="home-outline" size={26} color="#FFFFFF" style={s.typeBtnIcon} />
          <Text style={s.typeBtnText}>Presencial</Text>
          <Text style={s.typeBtnSub}>Gravação pelo microfone do celular</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.typeBtn, { backgroundColor: '#44745B' }]}
          onPress={() => { setTipo('online'); setStep(STEPS.SELECT_PLATFORM); }}
        >
          <Ionicons name="globe-outline" size={26} color="#FFFFFF" style={s.typeBtnIcon} />
          <Text style={s.typeBtnText}>Online</Text>
          <Text style={s.typeBtnSub}>Via WhatsApp, Meet, Zoom ou Telefone</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.SELECT_PATIENT)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 2: Selecionar plataforma ─────────────────────────
  if (step === STEPS.SELECT_PLATFORM) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Nova Sessão" onVoltar={() => setStep(STEPS.SELECT_TYPE)} />
        <View style={s.container}>
        <Text style={s.sub}>Plataforma da chamada:</Text>
        {PLATFORMS.map(p => (
          <TouchableOpacity
            key={p.id}
            style={[s.typeBtn, { backgroundColor: p.color }]}
            onPress={() => {
              setPlataforma(p);
              // Meet com conta conectada e plano que transcreve: caminho sem
              // gravação nenhuma. Qualquer outro caso segue por microfone.
              setStep(p.id === 'meet' && meetDisponivel ? STEPS.MEET : STEPS.RECORDING);
            }}
          >
            <Ionicons name={p.icon} size={24} color="#FFFFFF" style={s.typeBtnIcon} />
            <Text style={s.typeBtnText}>{p.label}</Text>
            {p.id === 'meet' && meetDisponivel && (
              <Text style={s.typeBtnSub}>Transcrição automática, sem gravar pelo aparelho</Text>
            )}
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.SELECT_TYPE)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 5: Sessão pelo Google Meet ───────────────────────
  if (step === STEPS.MEET) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Sessão pelo Meet" onVoltar={() => setStep(STEPS.SELECT_PLATFORM)} />
        <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={s.sub}>
            Analisante: <Text style={s.bold}>{paciente?.nome}</Text>
          </Text>

          {!gravacaoAutorizada ? (
            <View style={s.bloqueioAutorizacao}>
              <Ionicons name="shield-checkmark-outline" size={40} color="#A9A299" />
              <Text style={s.bloqueioAutorizacaoTitulo}>Autorização necessária</Text>
              <Text style={s.bloqueioAutorizacaoTexto}>
                {`${paciente?.nome} precisa autorizar a gravação e transcrição das sessões pelo app antes de você iniciar. O aviso do próprio Meet não substitui essa autorização.`}
              </Text>
              <TouchableOpacity
                style={s.btnIrParaAutorizacao}
                onPress={() => navigation.navigate('PatientDetail', { paciente })}
              >
                <Text style={s.btnIrParaAutorizacaoTexto}>Ir para autorização</Text>
              </TouchableOpacity>
            </View>
          ) : !salaMeet ? (
            <>
              <View style={s.infoBox}>
                <Text style={s.infoStep}>O app cria a sala e a transcrição já vem ligada.</Text>
                <Text style={s.infoStep}>Você envia o link para {paciente?.nome} e faz a chamada normalmente.</Text>
                <Text style={s.infoStep}>Ao terminar, é só encerrar a chamada no Meet.</Text>
                <Text style={s.infoStep}>A transcrição chega sozinha, com aviso — sem gastar créditos de IA.</Text>
                <View style={s.infoBoxFooter}>
                  <Text style={s.infoBoxFooterText}>
Nada é gravado por este aparelho, então não há risco de áudio mudo por disputa de microfone.
</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[s.btnIniciar, criandoSala && { opacity: 0.7 }]}
                onPress={iniciarSessaoMeet}
                disabled={criandoSala}
              >
                {criandoSala
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.btnIniciarText}>Criar sala e iniciar sessão</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.salaBox}>
                <Text style={s.salaTitulo}>Sala criada</Text>
                <Text style={s.salaLink} selectable>{salaMeet.meetingUri}</Text>
                <Text style={s.salaAviso}>
                  Envie este link para {paciente?.nome}. A transcrição começa
                  automaticamente quando a chamada iniciar.
                </Text>
              </View>

              <TouchableOpacity style={s.btnIniciar} onPress={compartilharLinkMeet}>
                <Text style={s.btnIniciarText}>Enviar link ao analisante</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.btnImportar}
                onPress={() => Linking.openURL(salaMeet.meetingUri).catch(() => {})}
              >
                <Ionicons name="videocam-outline" size={17} color="#497363" />
                <Text style={s.btnImportarTexto}>Entrar na chamada</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.btnSalvar} onPress={() => navigation.goBack()}>
                <Text style={s.btnSalvarText}>Concluir</Text>
              </TouchableOpacity>
              <Text style={s.salaRodape}>
                Você pode fechar o app. Assim que a chamada terminar e o Google
                gerar o texto, a transcrição aparece na sessão e você recebe um
                aviso.
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── STEP 3: Gravação ──────────────────────────────────────
  if (step === STEPS.RECORDING) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela
          titulo="Nova Sessão"
          onVoltar={() => {
            // Diferente da navegação entre telas (bloqueada pelo listener
            // beforeRemove acima), isto só troca `step` dentro do MESMO
            // componente montado — precisa da mesma trava aqui também.
            if (transcrevendo) {
              Alert.alert(
                'Aguarde',
                'A sessão ainda está sendo salva e enviada para transcrição. Aguarde terminar antes de voltar.'
              );
              return;
            }
            setStep(isOnline ? STEPS.SELECT_PLATFORM : STEPS.SELECT_TYPE);
          }}
        />
        <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={s.sub}>
            Analisante: <Text style={s.bold}>{paciente?.nome}</Text>
          </Text>
          {plataforma && (
            <Text style={s.sub}>
              Plataforma: <Text style={s.bold}>{plataforma.label}</Text>
            </Text>
          )}

          <View style={s.infoBox}>
            {isOnline ? (
              <>
                <Text style={s.infoStep}>Toque em<Text style={s.bold}>"Iniciar Gravação"</Text> abaixo.</Text>
                <Text style={s.infoStep}>O app abrirá o<Text style={s.bold}>{plataforma?.label}</Text> automaticamente.</Text>
                <Text style={s.infoStep}>Faça a chamada e ative o<Text style={s.bold}>viva-voz</Text></Text>
                <Text style={s.infoStep}>4.  {plataforma?.instrucaoVivavoz}</Text>
                <Text style={s.infoStep}>Ao encerrar,<Text style={s.bold}>volte aqui</Text> e toque em <Text style={s.bold}>"Encerrar Sessão"</Text>.</Text>
              </>
            ) : (
              <>
                <Text style={s.infoStep}>Toque em<Text style={s.bold}>"Iniciar Gravação"</Text> abaixo.</Text>
                <Text style={s.infoStep}>Realize a sessão normalmente.</Text>
                <Text style={s.infoStep}>Ao terminar, toque em<Text style={s.bold}>"Encerrar Sessão"</Text>.</Text>
                <Text style={s.infoStep}>O áudio será transcrito automaticamente.</Text>
              </>
            )}
            <View style={s.infoBoxFooter}>
              <Text style={s.infoBoxFooterText}>
Você pode bloquear a tela ou usar outros apps — a gravação continua.
</Text>
            </View>
            {/* O Android entrega o microfone pro app que está em chamada e
                silencia o nosso: a gravação sai com a duração certa e sem
                fala nenhuma. Não tem conserto pelo app — só avisar antes. */}
            {isOnline && (
              <View style={s.avisoMesmoAparelho}>
                <Text style={s.avisoMesmoAparelhoTexto}>
                  Faça a chamada em OUTRO aparelho. Se ela acontecer neste
                  mesmo celular, o Android dá o microfone para o app da
                  chamada e a gravação sai muda.
                  {plataforma?.id === 'meet' ? ' Conectando sua conta do Google (Perfil → Sessões online pelo Google Meet), o Meet transcreve sozinho e esse problema deixa de existir.' : ''}
                </Text>
              </View>
            )}
          </View>

          {transcrevendo ? (
            // Sem isso, assim que a gravação parava (gravando vira false já
            // no início de encerrarETranscrever, antes do upload terminar),
            // o botão "Iniciar Gravação" reaparecia enquanto o áudio ainda
            // estava subindo — parecia que nada tinha acontecido, e tocar
            // nele de novo trocava o objeto de gravação por baixo do
            // processo ainda em andamento, arriscando perder o áudio já
            // gravado. Este bloco tem que vir ANTES de checar `gravando`.
            <View style={s.gravandoBox}>
              <ActivityIndicator size="large" color="#975451" />
              <Text style={[s.gravandoInfo, { marginTop: 10 }]}>{progressoTranscricao || 'Processando...'}</Text>
            </View>
          ) : !gravando && !gravacaoAutorizada ? (
            <View style={s.bloqueioAutorizacao}>
              <Ionicons name="shield-checkmark-outline" size={40} color="#A9A299" />
              <Text style={s.bloqueioAutorizacaoTitulo}>Autorização necessária</Text>
              <Text style={s.bloqueioAutorizacaoTexto}>
                {autorizacaoStatus === 'pendente'
                  ? `${paciente?.nome} ainda não confirmou a autorização enviada por e-mail.`
                  : autorizacaoStatus === 'negada'
                  ? `${paciente?.nome} não autorizou a gravação e transcrição das sessões.`
                  : `Antes de gravar, ${paciente?.nome} precisa autorizar a gravação e transcrição das sessões pelo e-mail.`}
              </Text>
              <TouchableOpacity
                style={s.btnIrParaAutorizacao}
                onPress={() => navigation.navigate('PatientDetail', { paciente })}
              >
                <Text style={s.btnIrParaAutorizacaoTexto}>Ir para autorização</Text>
              </TouchableOpacity>
            </View>
          ) : !gravando ? (
            <TouchableOpacity
              style={[s.btnIniciar, preparandoGravacao && { opacity: 0.7 }]}
              disabled={preparandoGravacao}
              onPress={async () => {
                await iniciarGravacao();
                if (isOnline && plataforma?.url) {
                  try {
                    await Linking.openURL(plataforma.url);
                  } catch {
                    Alert.alert(
                      'Atenção',
                      `Abra o ${plataforma.label} manualmente, ative o viva-voz e realize a chamada.\n\nVolte aqui para encerrar quando terminar.`
                    );
                  }
                }
              }}
            >
              {preparandoGravacao
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnIniciarText}>Iniciar Gravação</Text>}
            </TouchableOpacity>
          ) : null}

          {!gravando && !transcrevendo && gravacaoAutorizada && (
            <TouchableOpacity style={s.btnImportar} onPress={importarAudio}>
              <Ionicons name="folder-open-outline" size={17} color="#497363" />
              <Text style={s.btnImportarTexto}>Transcrever um áudio já gravado</Text>
            </TouchableOpacity>
          )}

          {gravando && (
            <View style={s.gravandoBox}>
              <Text style={s.gravandoTimer}>⏱ {formatarTempo(tempo)}</Text>
              <Text style={s.gravandoInfo}>Gravando o ambiente — mantenha o celular próximo.</Text>
              <MedidorDeEntrada nivel={nivelEntrada} />
            </View>
          )}

          {gravando && (
            <TouchableOpacity style={s.btnEncerrar} onPress={encerrarETranscrever} disabled={transcrevendo}>
              <Text style={s.btnEncerrarText}>⏹ Encerrar Sessão e Transcrever</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.btnVoltar, transcrevendo && { opacity: 0.5 }]}
            onPress={() => setStep(isOnline ? STEPS.SELECT_PLATFORM : STEPS.SELECT_TYPE)}
            disabled={transcrevendo}
          >
            <Text style={s.btnVoltarText}>← Voltar</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── STEP 4: Revisão / transcrição ─────────────────────────
  if (step === STEPS.REVIEW && transcricaoAssincrona) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Nova Sessão" onVoltar={() => navigation.goBack()} />
        <View style={[s.container, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="mic-outline" size={40} color="#497363" style={{ marginBottom: 16 }} />
          <Text style={s.header}>Transcrição em andamento</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>
            A sessão com <Text style={s.bold}>{paciente?.nome}</Text> foi salva.
            Você vai receber um aviso assim que a transcrição estiver pronta.
          </Text>
          <TouchableOpacity
            style={[s.btnSalvar, { marginTop: 24, alignSelf: 'stretch' }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={s.btnSalvarText}>Concluir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === STEPS.REVIEW) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Revisar Transcrição" onVoltar={() => setStep(STEPS.RECORDING)} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.sub}>
            Analisante: <Text style={s.bold}>{paciente?.nome}</Text>
            {duracaoFinal > 0 && (
              <Text style={{ color: '#8C857B', fontSize: 13 }}>
                {' '}· Duração: {formatarTempo(duracaoFinal)}
              </Text>
            )}
          </Text>

          {/* ── Envio falhou, mas o áudio continua no aparelho ── */}
          {podeReenviar && !transcrevendo && (
            <View style={s.reenvioBox}>
              <Text style={s.reenvioTitulo}>A gravação não foi enviada</Text>
              <Text style={s.reenvioTexto}>
                O áudio está guardado no aparelho e não foi perdido. Tente
                enviar de novo — ou digite abaixo, e aí o áudio é descartado
                ao salvar.
              </Text>
              <TouchableOpacity style={s.btnReenviar} onPress={tentarEnviarDeNovo}>
                <Text style={s.btnReenviarTexto}>Tentar enviar de novo</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Instrução sobre prefixos ── */}
          <View style={s.instrucaoBox}>
            <Text style={s.instrucaoTitulo}>Revise os falantes</Text>
            <Text style={s.instrucaoTexto}>
              O texto foi pré-formatado com{' '}
              <Text style={s.instrucaoDestaque}>A:</Text> em cada linha.{'\n'}
              Troque para{' '}
              <Text style={s.instrucaoDestaque}>P:</Text> nas falas do{' '}
              <Text style={s.instrucaoDestaque}>analisante</Text>.
            </Text>
            <View style={s.instrucaoExemplo}>
              <Text style={s.instrucaoExemploTitulo}>Formato correto:</Text>
              <Text style={s.instrucaoExemploTexto}>
                A: Bom dia, como você está?{'\n'}
                P: Estou um pouco ansioso.{'\n'}
                A: Conte-me mais...
              </Text>
            </View>
          </View>

          {transcrevendo ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color="#497363" />
              <Text style={s.loadingText}>{progressoTranscricao || 'Transcrevendo áudio...'}</Text>
            </View>
          ) : (
            <TextInput
              style={s.textArea}
              multiline
              value={transcricao}
              onChangeText={setTranscricao}
              placeholder={'A: [fala do analista]\nP: [fala do analisante]\nA: ...'}
              placeholderTextColor="#DDD6CA"
            />
          )}

          {/* ── Preview de turnos detectados ── */}
          <View style={s.turnPreviewBox}>
            <Text style={s.turnPreviewTitulo}>
              Turnos detectados: {turnsPreview.length}
            </Text>
            {turnsPreview.length > 0 ? (
              <Text style={s.turnPreviewSub}>
                Analista: {contagem['analyst'] || 0} turno{(contagem['analyst'] || 0) !== 1 ? 's' : ''}
                {'   '}
                Analisante: {contagem['analysand'] || 0} turno{(contagem['analysand'] || 0) !== 1 ? 's' : ''}
              </Text>
            ) : transcricao.trim() ? (
              <Text style={s.turnPreviewWarn}>
Nenhum prefixo A: ou P: encontrado. Adicione os prefixos para organizar por falante.
</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[s.btnSalvar, (salvando || transcrevendo) && { opacity: 0.6 }]}
            onPress={salvarSessao}
            disabled={salvando || transcrevendo}
          >
            {salvando
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnSalvarText}>Salvar Sessão</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.RECORDING)}>
            <Text style={s.btnVoltarText}>← Voltar</Text>
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return null;
}

// ─── Estilos ────────────────────────────────────────────────────
const s = StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: '#F7F5F0' },
  container:       { flex: 1, backgroundColor: '#F7F5F0', padding: 20 },
  header:          { fontSize: 24, fontWeight: '500', color: '#302C28', marginBottom: 8, marginTop: 20 },
  sub: { fontSize: 15, color: '#756E66', marginBottom: 12, lineHeight: 22 },
  bold:            { fontWeight: '500', color: '#302C28' },
  card:            { backgroundColor: '#FDFCFA', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#EAE5DC', elevation: 2 },
  cardText: { fontSize: 16, fontWeight: '600', color: '#302C28', lineHeight: 23 },
  cardSub: { fontSize: 13, color: '#8C857B', marginTop: 4, lineHeight: 19 },
  empty: { textAlign: 'center', color: '#A9A299', marginTop: 40, fontSize: 15, lineHeight: 22 },

  typeBtn:         { borderRadius: 14, padding: 20, marginBottom: 14, alignItems: 'center', elevation: 3 },
  typeBtnIcon:     { marginBottom: 6 },
  typeBtnText:     { fontSize: 18, fontWeight: '500', color: '#fff' },
  typeBtnSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center', lineHeight: 19 },

  infoBox:         { backgroundColor: '#E3EAF1', borderRadius: 12, padding: 16, marginBottom: 20 },
  infoStep:        { fontSize: 14, color: '#302C28', marginBottom: 8, lineHeight: 22 },
  infoBoxFooter:   { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E3EAF1' },
  infoBoxFooterText: { fontSize: 12, color: '#756E66', textAlign: 'center', fontStyle: 'italic', lineHeight: 17 },

  avisoMesmoAparelho: { backgroundColor: '#F7E7E6', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#E5CBC9' },
  avisoMesmoAparelhoTexto: { fontSize: 12.5, color: '#7A5250', lineHeight: 19 },

  salaBox: { backgroundColor: '#E2EFE8', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#C3DFCF' },
  salaTitulo: { fontSize: 14, fontWeight: '700', color: '#44745B', marginBottom: 8, lineHeight: 20 },
  salaLink: { fontSize: 15, color: '#2F5B47', fontWeight: '600', lineHeight: 22, marginBottom: 8 },
  salaAviso: { fontSize: 13, color: '#4E6B5C', lineHeight: 19 },
  salaRodape: { fontSize: 12.5, color: '#8C857B', lineHeight: 19, textAlign: 'center', marginTop: 12 },

  btnImportar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15, marginBottom: 14,
    borderWidth: 1, borderColor: '#C6D6CE', backgroundColor: '#FDFCFA',
  },
  btnImportarTexto: { color: '#497363', fontSize: 15, fontWeight: '600', lineHeight: 22 },

  reenvioBox:    { backgroundColor: '#F7E7E6', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E5CBC9' },
  reenvioTitulo: { fontSize: 14, fontWeight: '600', color: '#975451', marginBottom: 6, lineHeight: 20 },
  reenvioTexto:  { fontSize: 13, color: '#7A5250', lineHeight: 20, marginBottom: 10 },
  btnReenviar:   { backgroundColor: '#975451', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnReenviarTexto: { color: '#fff', fontSize: 15, fontWeight: '600' },

  instrucaoBox:      { backgroundColor: '#F2E9DC', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E3D5BC' },
  instrucaoTitulo: { fontSize: 14, fontWeight: '500', color: '#7D6540', marginBottom: 6, lineHeight: 20 },
  instrucaoTexto:    { fontSize: 13, color: '#6B5A3A', lineHeight: 20, marginBottom: 8 },
  instrucaoDestaque: { fontWeight: '500', color: '#7D6540' },
  instrucaoExemplo:  { backgroundColor: '#F2E9DC', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: '#7D6540' },
  instrucaoExemploTitulo: { fontSize: 11, fontWeight: '500', color: '#7D6540', marginBottom: 4, textTransform: 'uppercase', lineHeight: 16 },
  instrucaoExemploTexto:  { fontSize: 13, color: '#6B5A3A', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 20 },

  turnPreviewBox:   { backgroundColor: '#E2EFE8', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#C3DFCF' },
  turnPreviewTitulo: { fontSize: 14, fontWeight: '500', color: '#44745B', marginBottom: 4, lineHeight: 20 },
  turnPreviewSub:   { fontSize: 13, color: '#44745B', lineHeight: 20 },
  turnPreviewWarn: { fontSize: 12, color: '#975451', marginTop: 4, fontStyle: 'italic', lineHeight: 17 },

  btnIniciar:      { backgroundColor: '#497363', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 14, elevation: 3 },
  btnIniciarText:  { color: '#fff', fontSize: 17, fontWeight: '500' },
  gravandoBox:     { backgroundColor: '#F1E4E3', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: '#E3C9C7' },
  gravandoTimer:   { fontSize: 36, fontWeight: '500', color: '#975451', marginBottom: 6 },
  gravandoInfo: { fontSize: 13, color: '#975451', textAlign: 'center', lineHeight: 19 },

  bloqueioAutorizacao: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 24, alignItems: 'center',
    marginBottom: 14, borderWidth: 1, borderColor: '#EAE5DC', gap: 8,
  },
  bloqueioAutorizacaoTitulo: { fontSize: 16, fontWeight: '500', color: '#302C28', lineHeight: 23 },
  bloqueioAutorizacaoTexto: { fontSize: 13, color: '#756E66', textAlign: 'center', lineHeight: 19 },
  btnIrParaAutorizacao: {
    backgroundColor: '#497363', borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 20, marginTop: 8,
  },
  btnIrParaAutorizacaoTexto: { color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20 },
  btnEncerrar:     { backgroundColor: '#975451', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 14, elevation: 3 },
  btnEncerrarText: { color: '#fff', fontSize: 17, fontWeight: '500' },
  btnVoltar:       { alignItems: 'center', padding: 14, marginTop: 4 },
  btnVoltarText: { color: '#497363', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  loadingBox:      { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 16, fontSize: 15, color: '#756E66', lineHeight: 22 },
  textArea:        { backgroundColor: '#FDFCFA', borderRadius: 12, padding: 16, fontSize: 15, color: '#4E4941', minHeight: 220, textAlignVertical: 'top', borderWidth: 1, borderColor: '#DDD6CA', marginBottom: 16, lineHeight: 22, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  btnSalvar:       { backgroundColor: '#44745B', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 14, elevation: 3 },
  btnSalvarText:   { color: '#fff', fontSize: 17, fontWeight: '500' },
});