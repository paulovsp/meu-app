import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, FlatList, TextInput, Linking,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  listarPacientes, addSession, updateSession,
  parseTranscriptToTurns,
  saveTranscriptTurns,
} from '../services/database';
import { getStatusAutorizacao } from '../services/autorizacaoGravacao';
import { supabase } from '../services/supabase';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

// ─── Opções de gravação ────────────────────────────────────────
const RECORDING_OPTIONS = {
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

// ─── Steps ─────────────────────────────────────────────────────
const STEPS = {
  SELECT_PATIENT: 0,
  SELECT_TYPE: 1,
  SELECT_PLATFORM: 2,
  RECORDING: 3,
  REVIEW: 4,
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

  // ─── Refs ─────────────────────────────────────────────────
  const recordingRef = useRef(new Audio.Recording());
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
  }, []);

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
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
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
      console.warn('Notificação:', err.message);
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
      try { await recordingRef.current.stopAndUnloadAsync(); } catch (_) {}
      recordingRef.current = new Audio.Recording();

      await recordingRef.current.prepareToRecordAsync(RECORDING_OPTIONS);
      await recordingRef.current.startAsync();
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
  // Assíncrona: a chamada só dispara o pedido de transcrição (upload +
  // submit na AssemblyAI) e volta — não espera o texto pronto. O resultado
  // chega depois via webhook (`ia-transcrever-webhook`), que atualiza a
  // sessão e manda um push. Ver DetalheSessaoScreen.js para o estado
  // "processando".
  async function transcreverArquivo(uri, sessionId) {
    const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const { data, error } = await supabase.functions.invoke('ia-transcrever', {
      body: { audioBase64, sessionId },
    });

    if (error) {
      let mensagem = error.message;
      let creditosInsuficientes = false;
      let assinaturaInativa = false;
      try {
        const corpo = await error.context?.json();
        if (corpo?.error) mensagem = corpo.error;
        creditosInsuficientes = !!corpo?.creditosInsuficientes;
        assinaturaInativa = !!corpo?.assinaturaInativa;
      } catch (_) {}
      if (assinaturaInativa) throw new Error(MENSAGEM_ASSINATURA_INATIVA);
      if (creditosInsuficientes) {
        throw new Error('Créditos de IA insuficientes para transcrever. Fale com o administrador da conta.');
      }
      throw new Error(mensagem);
    }
    if (data?.error) throw new Error(data.error);
  }

  // ─── Encerrar e transcrever ───────────────────────────────
  async function encerrarETranscrever() {
    if (!recordingRef.current._isDoneRecording === false) return;

    clearInterval(timerRef.current);
    const duracao = tempo;
    setDuracaoFinal(duracao);
    setGravando(false);
    setTranscrevendo(true);
    setProgressoTranscricao('Preparando áudio...');

    await removerNotificacaoGravacao();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      if (!uri) throw new Error('URI do áudio não encontrado após gravação.');

      setProgressoTranscricao('Salvando sessão...');
      const sid = await addSession(paciente.id, tipo, plataforma?.id || null, null, appointmentId);
      sessionIdRef.current = sid;

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

      setProgressoTranscricao('Enviando para transcrição...');
      await transcreverArquivo(uri, sid);

      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (_) {}

      setTranscricaoAssincrona(true);
    } catch (err) {
      Alert.alert(
        'Erro ao enviar para transcrição',
        err.message + '\n\nVocê pode digitar manualmente na próxima tela.',
      );
      setTranscricaoAssincrona(false);
    } finally {
      setTranscrevendo(false);
      setProgressoTranscricao('');
      setStep(STEPS.REVIEW);
      recordingRef.current = new Audio.Recording();
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
      const sid = sessionIdRef.current || await addSession(paciente.id, tipo, plataforma?.id || null, null, appointmentId);

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
            onPress={() => { setPlataforma(p); setStep(STEPS.RECORDING); }}
          >
            <Ionicons name={p.icon} size={24} color="#FFFFFF" style={s.typeBtnIcon} />
            <Text style={s.typeBtnText}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.SELECT_TYPE)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 3: Gravação ──────────────────────────────────────
  if (step === STEPS.RECORDING) {
    return (
      <SafeAreaView style={s.safeArea} edges={['bottom']}>
        <CabecalhoTela titulo="Nova Sessão" onVoltar={() => setStep(isOnline ? STEPS.SELECT_PLATFORM : STEPS.SELECT_TYPE)} />
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
          ) : (
            <View style={s.gravandoBox}>
              <Text style={s.gravandoTimer}>⏱ {formatarTempo(tempo)}</Text>
              <Text style={s.gravandoInfo}>Gravando o ambiente — mantenha o celular próximo.</Text>
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