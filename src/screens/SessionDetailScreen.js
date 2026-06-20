import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { substituirNomePorCodinome } from '../services/database';

export default function SessionDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { sessao, pacienteNome, pacienteNomeReal, pacienteCodinome } = route.params;

  const [tocando, setTocando]                 = useState(false);
  const [carregandoAudio, setCarregandoAudio] = useState(false);
  const soundRef = useRef(null);

  const transcricaoSegura = substituirNomePorCodinome(
    sessao.transcript,
    pacienteNomeReal,
    pacienteCodinome
  );

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
    if (tocando && soundRef.current) {
      await soundRef.current.pauseAsync();
      setTocando(false);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.playAsync();
      setTocando(true);
      return;
    }
    if (!sessao.audio_uri) return;
    setCarregandoAudio(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: sessao.audio_uri },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setTocando(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          setTocando(false);
          soundRef.current = null;
        }
      });
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível reproduzir o áudio.\n\n' + e.message);
    } finally {
      setCarregandoAudio(false);
    }
  }

  async function pararAudio() {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      setTocando(false);
    }
  }

  React.useEffect(() => {
    return () => { pararAudio(); };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sessão</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.infoCard}>
          <Text style={styles.pacienteNome}>{pacienteNome}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, sessao.type === 'online' ? styles.badgeOnline : styles.badgePresencial]}>
              <Text style={styles.badgeText}>
                {sessao.type === 'online' ? '💻 Online' : '🎙️ Presencial'}
              </Text>
            </View>
          </View>
          <Text style={styles.data}>{formatarData(sessao.date)}</Text>
        </View>

        {sessao.audio_uri ? (
          <View style={styles.audioCard}>
            <Text style={styles.secaoTitulo}>🎵 Áudio da Sessão</Text>
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
              {(tocando || soundRef.current) && (
                <TouchableOpacity style={styles.btnStop} onPress={pararAudio}>
                  <Text style={styles.btnStopText}>⏹</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.semAudioCard}>
            <Text style={styles.semAudioText}>🔇 Sem áudio gravado nesta sessão</Text>
          </View>
        )}

        <View style={styles.transcricaoCard}>
          <Text style={styles.secaoTitulo}>📄 Transcrição / Anotações</Text>
          {transcricaoSegura && transcricaoSegura.trim() ? (
            <Text style={styles.transcricaoTexto}>{transcricaoSegura}</Text>
          ) : (
            <View style={styles.semTranscricao}>
              <Text style={styles.semTranscricaoText}>Nenhuma transcrição nesta sessão.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backBtn: { width: 70 },
  backBtnText: { color: '#4A90D9', fontSize: 15, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E' },
  scroll: { padding: 16, gap: 16 },
  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#eee', elevation: 2,
  },
  pacienteNome: { fontSize: 20, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', marginBottom: 10 },
  badge: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  badgePresencial: { backgroundColor: '#EBF5FB' },
  badgeOnline: { backgroundColor: '#EAF0FD' },
  badgeText: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  data: { fontSize: 14, color: '#888', lineHeight: 20 },
  audioCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#D5E8D4',
  },
  secaoTitulo: { fontSize: 15, fontWeight: '700', color: '#1A1A2E', marginBottom: 14 },
  playerRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  btnPlay: {
    backgroundColor: '#27ae60', borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12, minWidth: 150, alignItems: 'center',
  },
  btnPause: { backgroundColor: '#f39c12' },
  btnPlayText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  btnStop: {
    backgroundColor: '#e74c3c', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center',
  },
  btnStopText: { color: '#fff', fontSize: 18 },
  semAudioCard: {
    backgroundColor: '#fafafa', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#eee', alignItems: 'center',
  },
  semAudioText: { fontSize: 14, color: '#aaa' },
  transcricaoCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#eee',
  },
  transcricaoTexto: { fontSize: 15, color: '#333', lineHeight: 24 },
  semTranscricao: { alignItems: 'center', paddingVertical: 16 },
  semTranscricaoText: { fontSize: 14, color: '#aaa', textAlign: 'center' },
});