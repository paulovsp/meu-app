import React, { useState, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { listarStatusSessoes, estaSemRelato } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';

const FILTROS = [
  { valor: 'sem_relato', label: 'Sem relato' },
  { valor: 'todos', label: 'Todos os status' },
];

function formatarData(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function SessoesStatusScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  // Sem isso, o card "Sessões sem relato" do Perfil (que mostra a contagem
  // de estaSemRelato) e esta tela mostravam critérios diferentes — a
  // usuária tocava o card esperando ver N itens e via outra coisa. Por
  // padrão só o que realmente falta relato; "Todos os status" mantém a
  // visão geral (cancelada, falta, etc.) pra quem quiser conferir.
  const [filtro, setFiltro] = useState('sem_relato');

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

  const listaFiltrada = filtro === 'sem_relato' ? lista.filter(estaSemRelato) : lista;

  function abrirItem(item) {
    if (item.sessionId) {
      navigation.navigate('SessionDetail', { sessionId: item.sessionId, pacienteNome: item.patientNome });
      return;
    }
    if (item.status === 'realizado') {
      Alert.alert(
        'Adicionar relato',
        `Como quer registrar a sessão de ${item.patientNome}?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Escrever registro',
            onPress: () => navigation.navigate('AddRecord', {
              patientId: item.patientId,
              appointmentId: item.appointmentId,
              dataSessao: item.date,
            }),
          },
          {
            text: 'Gravar áudio',
            onPress: () => navigation.navigate('NewSession', {
              patientId: item.patientId,
              patientNome: item.patientNome,
              appointmentId: item.appointmentId,
            }),
          },
        ]
      );
      return;
    }
    navigation.navigate('DetalheCompromisso', { appointmentId: item.appointmentId });
  }

  function renderItem({ item }) {
    const estado = getEstadoCompromisso({
      status: item.status,
      temTranscricao: item.temRelato,
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
        <View style={[styles.badge, { backgroundColor: (transcrevendo ? '#7D6540' : info.cor) + '20' }]}>
          <Text style={[styles.badgeText, { color: transcrevendo ? '#7D6540' : info.cor }]}>
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

        <View style={styles.filtroRow}>
          {FILTROS.map((f) => (
            <TouchableOpacity
              key={f.valor}
              style={[styles.filtroBtn, filtro === f.valor && styles.filtroBtnAtivo]}
              onPress={() => setFiltro(f.valor)}
            >
              <Text style={[styles.filtroTxt, filtro === f.valor && styles.filtroTxtAtivo]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {carregando ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#497363" />
        </View>
      ) : listaFiltrada.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="leaf-outline" size={34} color="#A8CBBA" style={styles.emptyIcon} />
          <Text style={styles.emptyText}>
            {filtro === 'sem_relato'
              ? 'Nenhuma sessão sem relato nos últimos 90 dias.'
              : 'Nenhum compromisso passado nos últimos 90 dias.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={listaFiltrada}
          keyExtractor={(item) => item.appointmentId}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  header: {
    padding: 24, paddingBottom: 16, backgroundColor: '#FDFCFA',
    borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  title:    { fontSize: 22, fontWeight: '500', color: '#302C28' },
  subtitle: { fontSize: 13, color: '#8C857B', marginTop: 4, lineHeight: 19 },
  filtroRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  filtroBtn: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: '#EAE5DC',
  },
  filtroBtnAtivo: { backgroundColor: '#497363' },
  filtroTxt: { fontSize: 12.5, fontWeight: '600', color: '#756E66', lineHeight: 18 },
  filtroTxtAtivo: { color: '#fff' },
  list:     { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 14,
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2, gap: 8,
  },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  nome: { flex: 1, fontSize: 15, fontWeight: '500', color: '#302C28', lineHeight: 22 },
  data: { fontSize: 12, color: '#8C857B', lineHeight: 17 },
  badge:    { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  empty:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:{ marginBottom: 16 },
  emptyText: { fontSize: 15, color: '#A9A299', textAlign: 'center', lineHeight: 22 },
});
