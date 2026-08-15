import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { listarPacientes, deletarPaciente, getModalidadesPorPaciente } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { calcularAnosEMeses, formatarAnosEMeses } from '../services/validacao';

export default function AnalisantesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [pacientes, setPacientes] = useState([]);
  const [modalidades, setModalidades] = useState({});
  const [removendoId, setRemovendoId] = useState(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      const [lista, modalidadesLista] = await Promise.all([
        listarPacientes(),
        getModalidadesPorPaciente(),
      ]);
      setPacientes(lista);
      setModalidades(modalidadesLista);
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

  function irParaFormulario(paciente = null) {
    navigation.navigate('PatientForm', paciente ? { paciente } : {});
  }

  function confirmarDelecao(id, nome) {
    Alert.alert('Remover analisante', `Deseja remover "${nome}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: async () => {
          setRemovendoId(id);
          try {
            await deletarPaciente(id);
            await carregar();
          } catch (e) {
            Alert.alert('Erro ao remover', mensagemDeErro(e));
          } finally {
            setRemovendoId(null);
          }
        }
      }
    ]);
  }

  // ⚠️ CORRIGIDO: não existe mais campo "codinome" — usa sempre o nome real
  function getInicial(item) {
    const ref = item.nome || 'A';
    return ref.charAt(0).toUpperCase();
  }

  function getNomeExibido(item) {
    return item.nome || '—';
  }

  function getModalidadeLabel(modalidade) {
    switch (modalidade) {
      case 'online':     return '💻 Online';
      case 'presencial': return '🏥 Presencial';
      case 'hibrido':    return '🔀 Híbrido';
      default:           return null;
    }
  }

  function renderItem({ item }) {
    const idadeTexto = formatarAnosEMeses(calcularAnosEMeses(item.nascimento));
    const tempoAnaliseTexto = formatarAnosEMeses(calcularAnosEMeses(item.data_inicio));
    const modalidadeLabel = getModalidadeLabel(modalidades[item.id]);

    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardMain}
          onPress={() => navigation.navigate('PatientDetail', { paciente: item })}
        >
          <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
            {getNomeExibido(item)}
          </Text>

          <View style={styles.cardBody}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInicial(item)}</Text>
            </View>
            <View style={styles.cardInfo}>
              {modalidadeLabel ? <Text style={styles.cardInfoLinha}>{modalidadeLabel}</Text> : null}
              {idadeTexto ? <Text style={styles.cardInfoLinha}>🎂 {idadeTexto}</Text> : null}
              {tempoAnaliseTexto ? <Text style={styles.cardInfoLinha}>🗓 {tempoAnaliseTexto}</Text> : null}
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => irParaFormulario(item)}
            disabled={removendoId === item.id}
          >
            <Text style={styles.actionBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => confirmarDelecao(item.id, getNomeExibido(item))}
            disabled={removendoId === item.id}
          >
            {removendoId === item.id
              ? <ActivityIndicator size="small" color="#c0392b" />
              : <Text style={styles.actionBtnText}>🗑️</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Analisantes</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => irParaFormulario()}>
          <Text style={styles.addBtnText}>+ Novo</Text>
        </TouchableOpacity>
      </View>

      {carregando ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#3D5A80" />
        </View>
      ) : pacientes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={styles.emptyText}>Nenhum analisante cadastrado</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => irParaFormulario()}>
            <Text style={styles.emptyBtnText}>Cadastrar primeiro analisante</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pacientes}
          keyExtractor={(item) => item.id.toString()}
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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 24, paddingBottom: 16, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  title:        { fontSize: 26, fontWeight: 'bold', color: '#1A1A2E' },
  addBtn:       { backgroundColor: '#3D5A80', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText:   { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  list:         { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  cardMain:     { flex: 1 },
  cardName:     { fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 },
  cardBody:     { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#3D5A80',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText:   { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cardInfo:     { flex: 1, gap: 2 },
  cardInfoLinha:{ fontSize: 13, color: '#666' },
  cardActions:  { flexDirection: 'column', gap: 2, marginLeft: 6 },
  actionBtn:    { padding: 4 },
  actionBtnText:{ fontSize: 15 },
  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:    { fontSize: 64, marginBottom: 16 },
  emptyText:    { fontSize: 16, color: '#aaa', marginBottom: 24 },
  emptyBtn:     { backgroundColor: '#3D5A80', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  emptyBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});