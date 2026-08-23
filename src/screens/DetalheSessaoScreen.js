import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator,
  Switch, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAudioPlayer, AudioModule } from 'expo-audio';
import {
  getSessionById, getPatientById, getTranscriptTurns, saveTranscriptTurns,
  parseTranscriptToTurns, salvarTranscricaoManual,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';

// O parágrafo de introdução (analisante/modalidade/data/duração), gerado em
// NovaSessaoScreen.js, nunca tem quebra de linha própria — a PRIMEIRA linha
// em branco em `transcript` sempre separa introdução de diálogo. Usado só
// pra reconstruir os turnos por falante a partir do texto puro, sem incluir
// a introdução como se fosse fala de alguém.
function extrairDialogo(transcriptCompleto) {
  const idx = (transcriptCompleto || '').indexOf('\n\n');
  return idx === -1 ? (transcriptCompleto || '') : transcriptCompleto.slice(idx + 2);
}

export default function DetalheSessaoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  // Duas formas de chegar aqui: navegação normal (já traz `sessao` +
  // `pacienteNome` prontos) ou toque numa notificação push (só
  // `sessionId` — busca tudo no mount, ver useEffect abaixo).
  const { sessionId: sessionIdParam } = route.params;

  const [sessao, setSessao]                   = useState(route.params.sessao || null);
  const [pacienteNome, setPacienteNome]       = useState(route.params.pacienteNome || '');
  const [carregandoSessao, setCarregandoSessao] = useState(!route.params.sessao);
  const [tocando, setTocando]                 = useState(false);
  const [carregandoAudio, setCarregandoAudio] = useState(false);
  const [turns, setTurns]                     = useState([]);
  const [exibirTurns, setExibirTurns]         = useState(true);
  const [loadingTurns, setLoadingTurns]       = useState(false);
  const [atualizando, setAtualizando]         = useState(false);
  const [editandoManual, setEditandoManual]   = useState(false);
  const [textoManual, setTextoManual]         = useState('');
  const [salvandoManual, setSalvandoManual]   = useState(false);

  const player = useAudioPlayer(sessao?.audio_uri ? { uri: sessao.audio_uri } : null);

  useEffect(() => {
    if (route.params.sessao) return;
    (async () => {
      try {
        const fresh = await getSessionById(sessionIdParam);
        if (!fresh) {
          Alert.alert('Sessão não encontrada', '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
          return;
        }
        setSessao(fresh);
        if (!route.params.pacienteNome) {
          const paciente = await getPatientById(fresh.patient_id);
          setPacienteNome(paciente?.nome || '');
        }
      } catch (e) {
        Alert.alert('Erro ao abrir sessão', mensagemDeErro(e), [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } finally {
        setCarregandoSessao(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (sessao?.id) carregarTurns();
  }, [sessao?.id]);

  useEffect(() => {
    return () => { try { player.pause(); } catch (_) {} };
  }, []);

  async function carregarTurns() {
    setLoadingTurns(true);
    try {
      const loaded = await getTranscriptTurns(sessao.id);
      setTurns(loaded);
      setExibirTurns(loaded.length > 0);
    } catch (e) {
      console.warn('Erro ao carregar turnos:', e.message);
      setTurns([]);
    } finally {
      setLoadingTurns(false);
    }
  }

  // Reforço pro caso do push não chegar (ou a pessoa abrir a sessão antes
  // dele) — reconsulta a sessão e, se a transcrição já concluiu, também
  // organiza os turnos por falante (a webhook só grava `transcript`; os
  // turnos são derivados daqui, na primeira vez que a sessão é aberta,
  // igual ao que já acontecia pro fluxo manual antigo).
  async function atualizarSessao() {
    setAtualizando(true);
    try {
      const fresh = await getSessionById(sessao.id);
      if (!fresh) return;
      setSessao(fresh);
      if (fresh.transcricao_status === 'concluida') {
        const turnsExistentes = await getTranscriptTurns(sessao.id);
        if (turnsExistentes.length === 0) {
          const dialogo = extrairDialogo(fresh.transcript);
          const turnsParsed = parseTranscriptToTurns(dialogo);
          if (turnsParsed.length > 0) {
            await saveTranscriptTurns(sessao.id, turnsParsed);
            setTurns(turnsParsed);
            setExibirTurns(true);
            return;
          }
        }
      }
      await carregarTurns();
    } catch (e) {
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
    } finally {
      setAtualizando(false);
    }
  }

  async function salvarManual() {
    setSalvandoManual(true);
    try {
      await salvarTranscricaoManual(sessao.id, textoManual);
      const dialogo = extrairDialogo(textoManual);
      const turnsParsed = parseTranscriptToTurns(dialogo);
      if (turnsParsed.length > 0) {
        await saveTranscriptTurns(sessao.id, turnsParsed);
      }
      setSessao({ ...sessao, transcript: textoManual, transcricao_status: null });
      setEditandoManual(false);
      await carregarTurns();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvandoManual(false);
    }
  }

  function formatarData(dataStr) {
    if (!dataStr) return 'Data não informada';
    try {
      return new Date(dataStr).toLocaleDateString('pt-BR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return dataStr; }
  }

  async function tocarPausar() {
    if (!sessao.audio_uri) return;
    try {
      setCarregandoAudio(true);
      await AudioModule.setAudioModeAsync({ playsInSilentMode: true });
      if (tocando) {
        player.pause();
        setTocando(false);
      } else {
        player.play();
        setTocando(true);
      }
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível reproduzir o áudio.\n\n' + e.message);
    } finally {
      setCarregandoAudio(false);
    }
  }

  function pararAudio() {
    try {
      player.pause();
      player.seekTo(0);
      setTocando(false);
    } catch (_) {}
  }

  if (carregandoSessao || !sessao) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#4D6B88" />
        </View>
      </SafeAreaView>
    );
  }

  const labelTipo = sessao.type === 'presencial'
    ? 'Presencial'
    : `Online${sessao.online_platform ? ' · ' + sessao.online_platform : ''}`;

  const badgeStyle = sessao.type === 'presencial'
    ? styles.badgePresencial
    : styles.badgeOnline;

  // ─── Renderiza turnos como conversa ───────────────────
  function renderTurnos() {
    if (loadingTurns) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#4D6B88" />
          <Text style={styles.loadingText}>Carregando turnos...</Text>
        </View>
      );
    }

    if (turns.length === 0) {
      return (
        <View style={styles.semTurnos}>
          <Ionicons name="document-text-outline" size={30} color="#A9A299" style={styles.semTurnosIcon} />
          <Text style={styles.semTurnosText}>
            Esta sessão não possui turnos organizados por falante.
          </Text>
          <Text style={styles.semTurnosSub}>
            Na próxima vez, use os prefixos A: e P: ao revisar a transcrição.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.turnosContainer}>
        {turns.map((turn, idx) => (
          <View
            key={idx}
            style={[
              styles.turnoBubble,
              turn.speaker === 'analyst' ? styles.turnoAnalista : styles.turnoAnalisante,
            ]}
          >
            <View style={styles.turnoHeader}>
              <View style={[
                styles.turnoBadge,
                turn.speaker === 'analyst' ? styles.turnoBadgeAnalista : styles.turnoBadgeAnalisante,
              ]}>
                <Text style={styles.turnoBadgeText}>
                  {turn.speaker === 'analyst' ? 'Analista' : 'Analisante'}
                </Text>
              </View>
              <Text style={styles.turnoIndex}>#{idx + 1}</Text>
            </View>
            <Text style={styles.turnoTexto}>{turn.text}</Text>
          </View>
        ))}
      </View>
    );
  }

  // ─── Renderiza transcrição bruta ──────────────────────
  function renderTranscricaoBruta() {
    if (!sessao.transcript || !sessao.transcript.trim()) {
      return (
        <View style={styles.semTranscricao}>
          <Text style={styles.semTranscricaoText}>Nenhuma transcrição nesta sessão.</Text>
        </View>
      );
    }
    return (
      <Text style={styles.transcricaoTexto}>{sessao.transcript}</Text>
    );
  }

  // ─── Estado: transcrição assíncrona em andamento ───────
  function renderTranscricaoProcessando() {
    return (
      <View style={styles.statusBox}>
        <Ionicons name="mic-outline" size={30} color="#497363" style={styles.statusIcon} />
        <Text style={styles.statusText}>Transcrevendo... você será avisada quando terminar.</Text>
        <TouchableOpacity style={styles.btnAtualizar} onPress={atualizarSessao} disabled={atualizando}>
          {atualizando
            ? <ActivityIndicator color="#4D6B88" />
            : <Text style={styles.btnAtualizarText}>Atualizar</Text>
          }
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Estado: transcrição assíncrona falhou ─────────────
  function renderTranscricaoErro() {
    if (editandoManual) {
      return (
        <View>
          <TextInput
            style={styles.textAreaManual}
            multiline
            value={textoManual}
            onChangeText={setTextoManual}
            placeholder={'A: [fala do analista]\nP: [fala do analisante]\nA: ...'}
            placeholderTextColor="#DDD6CA"
          />
          <TouchableOpacity
            style={[styles.btnAtualizar, styles.btnSalvarManual, salvandoManual && { opacity: 0.6 }]}
            onPress={salvarManual}
            disabled={salvandoManual}
          >
            {salvandoManual
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnSalvarManualText}>Salvar transcrição</Text>
            }
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.statusBox}>
        <Ionicons name="alert-circle-outline" size={30} color="#975451" style={styles.statusIcon} />
        <Text style={styles.statusText}>Não foi possível transcrever esta sessão.</Text>
        <TouchableOpacity
          style={styles.btnAtualizar}
          onPress={() => { setTextoManual(sessao.transcript || ''); setEditandoManual(true); }}
        >
          <Text style={styles.btnAtualizarText}>Digitar manualmente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes da Sessão</Text>
        <View style={{ width: 70 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Info card */}
        <View style={styles.infoCard}>
          <Text style={styles.pacienteNome}>{pacienteNome}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, badgeStyle]}>
              <Text style={styles.badgeText}>{labelTipo}</Text>
            </View>
            {turns.length > 0 && (
              <View style={[styles.badge, styles.badgeTurns]}>
                <Text style={styles.badgeTurnsText}>
                  {turns.length} turno{turns.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {sessao.duration_seconds ? (
              <View style={[styles.badge, styles.badgeDuracao]}>
                <Text style={styles.badgeDuracaoText}>
                  ⏱ {Math.floor(sessao.duration_seconds / 60)}min
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.data}>{formatarData(sessao.date)}</Text>
        </View>

        {/* Áudio — o app nunca guarda o arquivo de áudio (é apagado do
            aparelho assim que a transcrição é confirmada), então este
            bloco só aparece nos raros casos em que audio_uri exista;
            sem aviso de "sem áudio" quando não existir (é sempre o caso). */}
        {sessao.audio_uri && (
          <View style={[styles.audioCard, { marginTop: 16 }]}>
            <Text style={styles.secaoTitulo}>Áudio da Sessão</Text>
            <View style={styles.playerRow}>
              <TouchableOpacity
                style={[styles.btnPlay, tocando && styles.btnPause]}
                onPress={tocarPausar}
                disabled={carregandoAudio}
              >
                {carregandoAudio
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnPlayText}>{tocando ? '⏸ Pausar' : '▶ Reproduzir'}</Text>
                }
              </TouchableOpacity>
              {tocando && (
                <TouchableOpacity style={styles.btnStop} onPress={pararAudio}>
                  <Text style={styles.btnStopText}>⏹</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ⚠️ NOVO: Transcrição com toggle */}
        <View style={[styles.transcricaoCard, { marginTop: 16 }]}>
          <View style={styles.transcricaoHeader}>
            <Text style={styles.secaoTitulo}>
              {sessao.transcricao_status === 'processando'
                ? 'Transcrevendo...'
                : sessao.transcricao_status === 'erro'
                ? 'Transcrição'
                : exibirTurns && turns.length > 0
                ? 'Turnos por Falante'
                : 'Transcrição / Anotações'}
            </Text>
            {sessao.transcricao_status !== 'processando' && sessao.transcricao_status !== 'erro' && turns.length > 0 && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>
                  {exibirTurns ? 'Turnos' : 'Bruto'}
                </Text>
                <Switch
                  value={exibirTurns}
                  onValueChange={setExibirTurns}
                  trackColor={{ false: '#DDD6CA', true: '#4D6B88' }}
                  thumbColor="#fff"
                />
              </View>
            )}
          </View>

          {sessao.transcricao_status === 'processando'
            ? renderTranscricaoProcessando()
            : sessao.transcricao_status === 'erro'
            ? renderTranscricaoErro()
            : exibirTurns && turns.length > 0
            ? renderTurnos()
            : renderTranscricaoBruta()}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#F7F5F0' },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FDFCFA', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EAE5DC' },
  backBtn:            { width: 70 },
  backBtnText: { color: '#4D6B88', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  headerTitle:        { fontSize: 17, fontWeight: '500', color: '#302C28' },
  scroll:             { padding: 16 },

  infoCard:           { backgroundColor: '#FDFCFA', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#EAE5DC', elevation: 2 },
  pacienteNome:       { fontSize: 20, fontWeight: '500', color: '#302C28', marginBottom: 10 },
  badgeRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  badge:              { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  badgePresencial:    { backgroundColor: '#E3EAF1' },
  badgeOnline:        { backgroundColor: '#E3EAF1' },
  badgeText: { fontSize: 14, fontWeight: '600', color: '#302C28', lineHeight: 20 },

  // ⚠️ NOVOS badges
  badgeTurns:         { backgroundColor: '#E2EFE8' },
  badgeTurnsText: { fontSize: 13, fontWeight: '600', color: '#44745B', lineHeight: 19 },
  badgeDuracao:       { backgroundColor: '#F2E9DC' },
  badgeDuracaoText: { fontSize: 13, fontWeight: '600', color: '#7D6540', lineHeight: 19 },

  data:               { fontSize: 14, color: '#8C857B', lineHeight: 20 },

  audioCard:          { backgroundColor: '#FDFCFA', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#E2EFE8' },
  secaoTitulo: { fontSize: 15, fontWeight: '500', color: '#302C28', marginBottom: 14, lineHeight: 22 },
  playerRow:          { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  btnPlay:            { backgroundColor: '#44745B', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, minWidth: 150, alignItems: 'center' },
  btnPause:           { backgroundColor: '#7D6540' },
  btnPlayText: { color: '#fff', fontWeight: '500', fontSize: 15, lineHeight: 22 },
  btnStop:            { backgroundColor: '#975451', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  btnStopText:        { color: '#fff', fontSize: 18 },

  transcricaoCard:    { backgroundColor: '#FDFCFA', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#EAE5DC' },
  transcricaoHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  toggleRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontSize: 12, color: '#8C857B', fontWeight: '600', lineHeight: 17 },
  transcricaoTexto:   { fontSize: 15, color: '#4E4941', lineHeight: 24 },
  semTranscricao:     { alignItems: 'center', paddingVertical: 16 },
  semTranscricaoText: { fontSize: 14, color: '#A9A299', textAlign: 'center', lineHeight: 20 },

  // ⚠️ NOVOS estilos de turnos
  turnosContainer:    { gap: 12 },
  turnoBubble:        { borderRadius: 14, padding: 14, borderWidth: 1 },
  turnoAnalista:      { backgroundColor: '#E3EAF1', borderColor: '#C4D3E0', alignSelf: 'flex-start', marginRight: 40 },
  turnoAnalisante:    { backgroundColor: '#F2E9DC', borderColor: '#E3D5BC', alignSelf: 'flex-end', marginLeft: 40 },
  turnoHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  turnoBadge:         { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  turnoBadgeAnalista: { backgroundColor: '#4D6B88' },
  turnoBadgeAnalisante: { backgroundColor: '#7D6540' },
  turnoBadgeText: { fontSize: 11, fontWeight: '500', color: '#fff', lineHeight: 16 },
  turnoIndex:         { fontSize: 10, color: '#A9A299', fontWeight: '600' },
  turnoTexto:         { fontSize: 15, color: '#302C28', lineHeight: 22 },

  semTurnos:          { alignItems: 'center', paddingVertical: 24 },
  semTurnosIcon:      { marginBottom: 8 },
  semTurnosText: { fontSize: 14, color: '#8C857B', textAlign: 'center', marginBottom: 6, lineHeight: 20 },
  semTurnosSub: { fontSize: 12, color: '#A9A299', textAlign: 'center', fontStyle: 'italic', lineHeight: 17 },

  loadingBox:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 20 },
  loadingText: { fontSize: 13, color: '#8C857B', lineHeight: 19 },

  // ⚠️ NOVOS: estados de transcrição assíncrona (processando/erro)
  statusBox:          { alignItems: 'center', paddingVertical: 24, gap: 10 },
  statusIcon:         {},
  statusText: { fontSize: 14, color: '#756E66', textAlign: 'center', paddingHorizontal: 12, lineHeight: 20 },
  btnAtualizar:       { backgroundColor: '#E3EAF1', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  btnAtualizarText: { color: '#4D6B88', fontWeight: '500', fontSize: 14, lineHeight: 20 },
  textAreaManual: { minHeight: 160, borderWidth: 1, borderColor: '#EAE5DC', borderRadius: 12, padding: 12, fontSize: 15, color: '#302C28', textAlignVertical: 'top', lineHeight: 22 },
  btnSalvarManual:    { backgroundColor: '#44745B', alignItems: 'center' },
  btnSalvarManualText: { color: '#fff', fontWeight: '500', fontSize: 14, lineHeight: 20 },
});