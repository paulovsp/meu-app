import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, FlatList, Alert
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { getSessions, getRecords, deleteSession, deleteRecord } from '../services/database';

export default function PatientDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { paciente } = route.params;

  const [sessoes, setSessoes] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [aba, setAba] = useState('registros');

  useFocusEffect(
    useCallback(() => {
      setSessoes(getSessions(paciente.id));
      setRegistros(getRecords(paciente.id));
    }, [paciente.id])
  );

  function formatarData(dataStr) {
    if (!dataStr) return '';
    try { return new Date(dataStr).toLocaleDateString('pt-BR'); }
    catch { return dataStr; }
  }

  function renderSessao({ item }) {
    return (
      <View style={styles.itemCard}>
        <TouchableOpacity
          style={styles.itemLeft}
          onPress={() => navigation.navigate('SessionDetail', {
            sessao: item,
            pacienteNome: paciente.codinome || paciente.nome,
            pacienteNomeReal: paciente.nome,
            pacienteCodinome: paciente.codinome || null,
          })}
        >
          <Text style={styles.itemIcone}>{item.type === 'online' ? '💻' : '🎙️'}</Text>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitulo}>
              Sessão {item.type === 'online' ? 'Online' : 'Presencial'}
            </Text>
            <Text style={styles.itemData}>{formatarData(item.date)}</Text>
            {item.transcript
              ? <Text style={styles.itemPreview} numberOfLines={2}>{item.transcript}</Text>
              : <Text style={styles.itemSemConteudo}>Sem transcrição</Text>
            }
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            Alert.alert('Remover sessão?', 'Esta ação não pode ser desfeita.', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Remover', style: 'destructive',
                onPress: () => {
                  deleteSession(item.id);
                  setSessoes(getSessions(paciente.id));
                }
              }
            ]);
          }}
        >
          <Text style={styles.deleteBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderRegistro({ item }) {
    const icone = item.type === 'image' ? '🖼️' : item.type === 'file' ? '📎' : '📝';
    return (
      <View style={styles.itemCard}>
        <TouchableOpacity
          style={styles.itemLeft}
          onPress={() => navigation.navigate('RecordDetail', { record: item })}
        >
          <Text style={styles.itemIcone}>{icone}</Text>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitulo}>{item.title || 'Sem título'}</Text>
            <Text style={styles.itemData}>{formatarData(item.date)}</Text>
            {item.content
              ? <Text style={styles.itemPreview} numberOfLines={3}>{item.content}</Text>
              : <Text style={styles.itemSemConteudo}>Sem conteúdo</Text>
            }
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            Alert.alert('Remover registro?', 'Esta ação não pode ser desfeita.', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Remover', style: 'destructive',
                onPress: () => {
                  deleteRecord(item.id);
                  setRegistros(getRecords(paciente.id));
                }
              }
            ]);
          }}
        >
          <Text style={styles.deleteBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{paciente.nome}</Text>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => navigation.navigate('PatientForm', { paciente })}
        >
          <Text style={styles.editBtnText}>✏️</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{paciente.nome.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.infoTextos}>
          <Text style={styles.infoNome}>{paciente.nome}</Text>
          {paciente.codinome ? <Text style={styles.infoSub}>🔒 {paciente.codinome}</Text> : null}
          {paciente.telefone ? <Text style={styles.infoSub}>📞 {paciente.telefone}</Text> : null}
          {paciente.nascimento ? <Text style={styles.infoSub}>🎂 {paciente.nascimento}</Text> : null}
          {paciente.data_inicio ? <Text style={styles.infoSub}>🗓 Início: {paciente.data_inicio}</Text> : null}
        </View>
      </View>

      <View style={styles.botoesRapidos}>
        <TouchableOpacity
          style={styles.btnRapido}
          onPress={() => navigation.navigate('NewSession', { patientId: paciente.id })}
        >
          <Text style={styles.btnRapidoIcone}>🎙️</Text>
          <Text style={styles.btnRapidoTexto}>Nova Sessão</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnRapido, { backgroundColor: '#7c3aed' }]}
          onPress={() => navigation.navigate('AddRecord', { patientId: paciente.id })}
        >
          <Text style={styles.btnRapidoIcone}>📝</Text>
          <Text style={styles.btnRapidoTexto}>Novo Registro</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.abas}>
        <TouchableOpacity
          style={[styles.aba, aba === 'registros' && styles.abaAtiva]}
          onPress={() => setAba('registros')}
        >
          <Text style={[styles.abaTexto, aba === 'registros' && styles.abaTextoAtivo]}>
            📝 Registros ({registros.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.aba, aba === 'sessoes' && styles.abaAtiva]}
          onPress={() => setAba('sessoes')}
        >
          <Text style={[styles.abaTexto, aba === 'sessoes' && styles.abaTextoAtivo]}>
            🎙️ Sessões ({sessoes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {aba === 'registros' ? (
        <FlatList
          data={registros}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRegistro}
          contentContainerStyle={styles.lista}
          ListEmptyComponent={
            <View style={styles.vazio}>
              <Text style={styles.vazioIcone}>📝</Text>
              <Text style={styles.vazioTexto}>Nenhum registro ainda</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={sessoes}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderSessao}
          contentContainerStyle={styles.lista}
          ListEmptyComponent={
            <View style={styles.vazio}>
              <Text style={styles.vazioIcone}>🎙️</Text>
              <Text style={styles.vazioTexto}>Nenhuma sessão registrada</Text>
            </View>
          }
        />
      )}
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
  headerTitle: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#1A1A2E', textAlign: 'center' },
  editBtn: { width: 40, alignItems: 'flex-end' },
  editBtnText: { fontSize: 20 },
  infoCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    margin: 16, borderRadius: 16, padding: 16, elevation: 2,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4A90D9',
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  infoTextos: { flex: 1 },
  infoNome: { fontSize: 18, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  infoSub: { fontSize: 13, color: '#888', marginTop: 2 },
  botoesRapidos: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 8 },
  btnRapido: {
    flex: 1, backgroundColor: '#4A90D9', borderRadius: 12, padding: 14,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  btnRapidoIcone: { fontSize: 18 },
  btnRapidoTexto: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  abas: {
    flexDirection: 'row', backgroundColor: '#fff', marginHorizontal: 16,
    borderRadius: 12, padding: 4, marginBottom: 8, borderWidth: 1, borderColor: '#eee',
  },
  aba: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  abaAtiva: { backgroundColor: '#4A90D9' },
  abaTexto: { fontSize: 14, fontWeight: '600', color: '#888' },
  abaTextoAtivo: { color: '#fff' },
  lista: { padding: 16, gap: 10 },
  itemCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', elevation: 1,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  itemIcone: { fontSize: 24, marginRight: 12, marginTop: 2 },
  itemInfo: { flex: 1 },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: '#1A1A2E' },
  itemData: { fontSize: 12, color: '#aaa', marginTop: 2 },
  itemPreview: { fontSize: 13, color: '#666', marginTop: 4, lineHeight: 18 },
  itemSemConteudo: { fontSize: 12, color: '#bbb', marginTop: 4, fontStyle: 'italic' },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 18 },
  vazio: { alignItems: 'center', paddingTop: 48 },
  vazioIcone: { fontSize: 48, marginBottom: 12 },
  vazioTexto: { fontSize: 15, color: '#aaa' },
});