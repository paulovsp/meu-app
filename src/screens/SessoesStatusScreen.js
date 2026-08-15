import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { listarStatusSessoes } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';

function formatarData(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function SessoesStatusScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      setLista(await listarStatusSessoes());
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [])
  );

  function abrirItem(item) {
    if (item.sessionId) {
      navigation.navigate('SessionDetail', { sessionId: item.sessionId, pacienteNome: item.patientNome });
      return;
    }
    if (item.status === 'realizado') {
      navigation.navigate('NewSession', {
        patientId: item.patientId,
        patientNome: item.patientNome,
        appointmentId: item.appointmentId,
      });
      return;
    }
    navigation.navigate('DetalheCompromisso', { appointmentId: item.appointmentId });
  }

  function renderItem({ item }) {
    const estado = getEstadoCompromisso({
      status: item.status,
      temTranscricao: item.temTranscricao,
      horarioPassou: true,
    });
    const info = ESTADO_LABEL[estado];
    const transcrevendo = item.transcricaoStatus === 'processando';

    return (
      <TouchableOpacity style={styles.card} onPress={() => abrirItem(item)}>
        <View style={styles.cardTopo}>
          <Text style={styles.nome} numberOfLines={1}>{item.patientNome || '—'}</Text>
          <Text style={styles.data}>{formatarData(item.date)} {item.startTime?.slice(0, 5)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: (transcrevendo ? '#F09B4A' : info.cor) + '20' }]}>
          <Text style={[styles.badgeText, { color: transcrevendo ? '#F09B4A' : info.cor }]}>
            {transcrevendo ? 'Transcrevendo...' : info.texto}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Sessões sem relato</Text>
        <Text style={styles.subtitle}>Últimos 90 dias — toque pra abrir ou preencher</Text>
      </View>

      {carregando ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#3D5A80" />
        </View>
      ) : lista.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>Nenhum compromisso passado nos últimos 90 dias.</Text>
        </View>
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(item) => item.appointmentId}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    padding: 24, paddingBottom: 16, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  title:    { fontSize: 22, fontWeight: 'bold', color: '#1A1A2E' },
  subtitle: { fontSize: 13, color: '#888', marginTop: 4 },
  list:     { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2, gap: 8,
  },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  nome:     { flex: 1, fontSize: 15, fontWeight: '700', color: '#1A1A2E' },
  data:     { fontSize: 12, color: '#888' },
  badge:    { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:{ fontSize: 12, fontWeight: '700' },
  empty:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:{ fontSize: 48, marginBottom: 16 },
  emptyText:{ fontSize: 15, color: '#aaa', textAlign: 'center' },
});
