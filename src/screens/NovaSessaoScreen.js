import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, FlatList, TextInput, Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { listarPacientes, addSession, updateSession, substituirNomePorCodinome } from '../services/database';

// ── Groq Whisper para transcrição ──────────────────────
const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || '';
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

const STEPS = {
  SELECT_PATIENT:  0,
  SELECT_TYPE:     1,
  SELECT_PLATFORM: 2,
  RECORDING:       3,
  REVIEW:          4,
};

const PLATFORMS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    color: '#25D366',
    url: 'whatsapp://',
    instrucaoVivavoz: 'Ative o viva-voz 🔊 assim que a chamada conectar.',
  },
  {
    id: 'meet',
    label: 'Google Meet',
    icon: '📹',
    color: '#00897B',
    url: 'https://meet.google.com',
    instrucaoVivavoz: 'No Meet, toque em ⋮ → Alto-falante para ativar o viva-voz.',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    icon: '🎥',
    color: '#2D8CFF',
    url: 'zoomus://',
    instrucaoVivavoz: 'No Zoom, toque em "Alto-falante" 🔊 na barra inferior.',
  },
  {
    id: 'telefone',
    label: 'Telefone',
    icon: '📞',
    color: '#E67E22',
    url: 'tel:',
    instrucaoVivavoz: 'Durante a chamada, toque em "Viva-voz" 🔊 na tela do telefone.',
  },
];

export default function NewSessionScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const prePatientId = route?.params?.patientId || null;

  const [step, setStep]                   = useState(STEPS.SELECT_PATIENT);
  const [pacientes, setPacientes]         = useState([]);
  const [paciente, setPaciente]           = useState(null);
  const [tipo, setTipo]                   = useState(null);
  const [plataforma, setPlataforma]       = useState(null);
  const [gravando, setGravando]           = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [transcricao, setTranscricao]     = useState('');
  const [salvando, setSalvando]           = useState(false);
  const [tempo, setTempo]                 = useState(0);

  const recordingRef = useRef(null);
  const timerRef     = useRef(null);

  useEffect(() => {
    const lista = listarPacientes();
    setPacientes(lista);
    if (prePatientId) {
      const p = lista.find(x => x.id === prePatientId);
      if (p) { setPaciente(p); setStep(STEPS.SELECT_TYPE); }
    }
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  function formatarTempo(seg) {
    const m = Math.floor(seg / 60).toString().padStart(2, '0');
    const s = (seg % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async function iniciarGravacao() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão negada', 'Precisamos de acesso ao microfone.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setGravando(true);
      setTempo(0);
      timerRef.current = setInterval(() => setTempo(t => t + 1), 1000);
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível iniciar a gravação:\n' + err.message);
    }
  }

  async function encerrarETranscrever() {
    if (!recordingRef.current) return;
    clearInterval(timerRef.current);
    setGravando(false);
    setTranscrevendo(true);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!GROQ_API_KEY) {
        throw new Error('Chave do Groq não configurada. Verifique o arquivo .env');
      }

      const formData = new FormData();
      formData.append('file', { uri, type: 'audio/m4a', name: 'sessao.m4a' });
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'pt');
      formData.append('response_format', 'json');

      const response = await fetch(GROQ_WHISPER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      const texto = data?.text || '';

      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (_) {}

      // Busca paciente atualizado do banco antes de substituir
      const listaPacientes = listarPacientes();
      const pacienteAtualizado = listaPacientes.find(p => p.id === paciente?.id) || paciente;

      console.log('=== DEBUG CODINOME ===');
      console.log('Nome:', pacienteAtualizado?.nome);
      console.log('Codinome:', pacienteAtualizado?.codinome);
      console.log('Texto (início):', texto?.substring(0, 80));
      console.log('======================');

      const textoProtegido = substituirNomePorCodinome(
        texto,
        pacienteAtualizado?.nome,
        pacienteAtualizado?.codinome
      );

      setTranscricao(textoProtegido);
    } catch (err) {
      Alert.alert(
        'Erro na transcrição',
        err.message + '\n\nVocê pode digitar manualmente na próxima tela.',
      );
      setTranscricao('');
    } finally {
      setTranscrevendo(false);
      setStep(STEPS.REVIEW);
    }
  }

  async function salvarSessao() {
    if (!paciente) return;
    setSalvando(true);
    try {
      const sid = addSession(paciente.id, tipo, plataforma?.id || null);
      updateSession(sid, { transcript: transcricao, audio_uri: null });
      Alert.alert('✅ Sessão salva!', '', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Erro', err.message);
    } finally {
      setSalvando(false);
    }
  }

  // ── STEP 0: Selecionar paciente
  if (step === STEPS.SELECT_PATIENT) {
    return (
      <View style={s.container}>
        <Text style={s.header}>Nova Sessão</Text>
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
              {item.codinome
                ? <Text style={s.cardSub}>🔒 {item.codinome}</Text>
                : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>Nenhum analisante cadastrado.</Text>}
        />
      </View>
    );
  }

  // ── STEP 1: Presencial ou Online
  if (step === STEPS.SELECT_TYPE) {
    return (
      <View style={s.container}>
        <Text style={s.header}>Nova Sessão</Text>
        <Text style={s.sub}>Analisante: <Text style={s.bold}>{paciente?.nome}</Text></Text>
        <Text style={s.sub}>Tipo de sessão:</Text>

        <TouchableOpacity
          style={[s.typeBtn, { backgroundColor: '#2c7be5' }]}
          onPress={() => {
            setTipo('presencial');
            setPlataforma(null);
            setStep(STEPS.RECORDING);
          }}
        >
          <Text style={s.typeBtnIcon}>🏠</Text>
          <Text style={s.typeBtnText}>Presencial</Text>
          <Text style={s.typeBtnSub}>Gravação pelo microfone do celular</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.typeBtn, { backgroundColor: '#27ae60' }]}
          onPress={() => { setTipo('online'); setStep(STEPS.SELECT_PLATFORM); }}
        >
          <Text style={s.typeBtnIcon}>🌐</Text>
          <Text style={s.typeBtnText}>Online</Text>
          <Text style={s.typeBtnSub}>WhatsApp · Meet · Zoom · Telefone</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.SELECT_PATIENT)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── STEP 2: Escolher plataforma
  if (step === STEPS.SELECT_PLATFORM) {
    return (
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.header}>Sessão Online</Text>
        <Text style={s.sub}>Analisante: <Text style={s.bold}>{paciente?.nome}</Text></Text>
        <Text style={s.sub}>Via qual plataforma?</Text>

        {PLATFORMS.map(p => (
          <TouchableOpacity
            key={p.id}
            style={[s.platformBtn, { borderColor: p.color }]}
            onPress={() => {
              setPlataforma(p);
              setStep(STEPS.RECORDING);
            }}
          >
            <Text style={s.platformIcon}>{p.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.platformLabel, { color: p.color }]}>{p.label}</Text>
              <Text style={s.platformSub}>Toque para selecionar</Text>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.SELECT_TYPE)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── STEP 3: Gravação
  if (step === STEPS.RECORDING) {
    const isOnline = tipo === 'online';

    if (transcrevendo) {
      return (
        <View style={s.container}>
          <Text style={s.header}>Transcrevendo...</Text>
          <View style={s.centerBox}>
            <ActivityIndicator size="large" color="#2c7be5" />
            <Text style={s.transcrevendoText}>Enviando áudio para transcrição</Text>
            <Text style={s.transcrevendoSub}>
              Aguarde — pode levar alguns instantes{'\n'}dependendo da duração da sessão.
            </Text>
          </View>
        </View>
      );
    }

    if (!gravando) {
      return (
        <View style={s.container}>
          <Text style={s.header}>
            {isOnline ? `Sessão — ${plataforma?.label}` : 'Sessão Presencial'}
          </Text>
          <Text style={s.sub}>
            Analisante: <Text style={s.bold}>{paciente?.nome}</Text>
          </Text>

          <View style={s.infoBox}>
            <Text style={s.infoTitle}>📋 Como funciona:</Text>
            {isOnline ? (
              <>
                <Text style={s.infoStep}>1️⃣  Toque em <Text style={s.bold}>"Iniciar Gravação"</Text> abaixo.</Text>
                <Text style={s.infoStep}>2️⃣  O app abrirá o <Text style={s.bold}>{plataforma?.label}</Text> automaticamente.</Text>
                <Text style={s.infoStep}>3️⃣  Faça a chamada e ative o <Text style={s.bold}>viva-voz 🔊</Text></Text>
                <Text style={s.infoStep}>4️⃣  {plataforma?.instrucaoVivavoz}</Text>
                <Text style={s.infoStep}>5️⃣  Ao encerrar, <Text style={s.bold}>volte aqui</Text> e toque em <Text style={s.bold}>"Encerrar Sessão"</Text>.</Text>
              </>
            ) : (
              <>
                <Text style={s.infoStep}>1️⃣  Toque em <Text style={s.bold}>"Iniciar Gravação"</Text> abaixo.</Text>
                <Text style={s.infoStep}>2️⃣  Realize a sessão normalmente.</Text>
                <Text style={s.infoStep}>3️⃣  Ao terminar, toque em <Text style={s.bold}>"Encerrar Sessão"</Text>.</Text>
                <Text style={s.infoStep}>4️⃣  O áudio será transcrito automaticamente.</Text>
              </>
            )}
          </View>

          <TouchableOpacity
            style={s.btnIniciar}
            onPress={async () => {
              await iniciarGravacao();
              if (isOnline) {
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
            <Text style={s.btnIniciarText}>🎙️ Iniciar Gravação</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.btnVoltar}
            onPress={() => setStep(isOnline ? STEPS.SELECT_PLATFORM : STEPS.SELECT_TYPE)}
          >
            <Text style={s.btnVoltarText}>← Voltar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={s.container}>
        <Text style={s.header}>
          {isOnline ? `Gravando — ${plataforma?.label}` : 'Gravando — Presencial'}
        </Text>
        <Text style={s.sub}>
          Analisante: <Text style={s.bold}>{paciente?.nome}</Text>
        </Text>

        <View style={s.centerBox}>
          <View style={s.recordCircleActive}>
            <Text style={s.recordIcon}>🔴</Text>
          </View>
          <Text style={s.timer}>{formatarTempo(tempo)}</Text>

          {isOnline && (
            <View style={s.lembreteBox}>
              <Text style={s.lembreteText}>
                🔊 Mantenha o <Text style={s.bold}>viva-voz ativo</Text> no {plataforma?.label}
              </Text>
              <TouchableOpacity
                style={[s.btnReabrirApp, { borderColor: plataforma?.color }]}
                onPress={() => Linking.openURL(plataforma.url).catch(() => {})}
              >
                <Text style={[s.btnReabrirAppText, { color: plataforma?.color }]}>
                  {plataforma?.icon} Voltar ao {plataforma?.label}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {!isOnline && (
            <View style={s.lembreteBox}>
              <Text style={s.lembreteText}>
                🎙️ Gravando o ambiente — mantenha o celular próximo.
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={s.btnEncerrar} onPress={encerrarETranscrever}>
          <Text style={s.btnEncerrarText}>⏹  Encerrar Sessão e Transcrever</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── STEP 4: Revisão
  if (step === STEPS.REVIEW) {
    const labelTipo = tipo === 'presencial'
      ? 'Presencial'
      : `Online — ${plataforma?.label}`;

    return (
      <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
        <Text style={s.header}>Revisar Sessão</Text>
        <Text style={s.sub}>
          {paciente?.codinome || paciente?.nome} — <Text style={s.bold}>{labelTipo}</Text>
        </Text>

        <Text style={s.label}>Transcrição / Anotações:</Text>
        <TextInput
          style={s.textArea}
          value={transcricao}
          onChangeText={setTranscricao}
          multiline
          textAlignVertical="top"
          placeholder="A transcrição aparece aqui. Você pode editar ou digitar manualmente."
          placeholderTextColor="#aaa"
        />

        <TouchableOpacity style={s.btnSalvar} onPress={salvarSessao} disabled={salvando}>
          {salvando
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnSalvarText}>💾 Salvar Sessão</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.btnVoltar} onPress={() => setStep(STEPS.RECORDING)}>
          <Text style={s.btnVoltarText}>← Voltar</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  header:     { fontSize: 22, fontWeight: 'bold', color: '#2c3e50', marginTop: 10, marginBottom: 6 },
  sub:        { fontSize: 15, color: '#666', marginBottom: 14 },
  bold:       { fontWeight: 'bold', color: '#2c3e50' },
  label:      { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 8, marginTop: 10 },
  empty:      { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 15 },
  card:       { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  cardText:   { fontSize: 16, color: '#333' },
  cardSub:    { fontSize: 12, color: '#999', marginTop: 3 },
  typeBtn:    { borderRadius: 14, padding: 22, marginBottom: 16, alignItems: 'center', elevation: 2 },
  typeBtnIcon:{ fontSize: 34, marginBottom: 6 },
  typeBtnText:{ fontSize: 20, fontWeight: 'bold', color: '#fff' },
  typeBtnSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center' },
  platformBtn:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 2, padding: 18, marginBottom: 14 },
  platformIcon: { fontSize: 32, marginRight: 16 },
  platformLabel:{ fontSize: 18, fontWeight: 'bold' },
  platformSub:  { fontSize: 12, color: '#999', marginTop: 3 },
  infoBox:    { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 20, borderLeftWidth: 4, borderLeftColor: '#2c7be5' },
  infoTitle:  { fontSize: 15, fontWeight: 'bold', color: '#2c3e50', marginBottom: 12 },
  infoStep:   { fontSize: 14, color: '#444', marginBottom: 10, lineHeight: 22 },
  btnIniciar:     { backgroundColor: '#e74c3c', borderRadius: 14, paddingVertical: 18, alignItems: 'center', elevation: 3 },
  btnIniciarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  centerBox:        { alignItems: 'center', marginTop: 16, marginBottom: 20 },
  recordCircleActive: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#fdecea', borderWidth: 4, borderColor: '#e74c3c', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  recordIcon:       { fontSize: 56 },
  timer:            { fontSize: 48, fontWeight: 'bold', color: '#e74c3c', marginBottom: 16 },
  lembreteBox:      { backgroundColor: '#E8F5E9', borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: '#27ae60', alignSelf: 'stretch', marginHorizontal: 4 },
  lembreteText:     { fontSize: 14, color: '#1B5E20', lineHeight: 22, textAlign: 'center' },
  btnReabrirApp:    { borderWidth: 2, borderRadius: 10, padding: 10, marginTop: 12, alignItems: 'center' },
  btnReabrirAppText:{ fontSize: 14, fontWeight: 'bold' },
  btnEncerrar:      { backgroundColor: '#2c3e50', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginTop: 8, elevation: 3 },
  btnEncerrarText:  { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  transcrevendoText:{ fontSize: 17, fontWeight: '600', color: '#2c3e50', marginTop: 24, textAlign: 'center' },
  transcrevendoSub: { fontSize: 13, color: '#999', marginTop: 10, textAlign: 'center', lineHeight: 22 },
  textArea:   { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: '#333', borderWidth: 1, borderColor: '#ddd', minHeight: 300 },
  btnSalvar:  { backgroundColor: '#2c7be5', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20, elevation: 2 },
  btnSalvarText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnVoltar:     { alignItems: 'center', marginTop: 16, padding: 10 },
  btnVoltarText: { color: '#7f8c8d', fontSize: 15 },
});