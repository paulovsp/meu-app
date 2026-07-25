import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, FlatList, Alert
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { listarPacientes, deletarPaciente } from '../services/database';

export default function PatientsScreen() {
  const navigation = useNavigation();
  const [pacientes, setPacientes] = useState([]);

  useFocusEffect(
    useCallback(() => {
      setPacientes(listarPacientes());
    }, [])
  );

  function irParaFormulario(paciente = null) {
    navigation.navigate('PatientForm', paciente ? { paciente } : {});
  }

  function confirmarDelecao(id, codinome) {
    Alert.alert('Remover analisante', `Deseja remover "${codinome}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: () => {
          deletarPaciente(id);
          setPacientes(listarPacientes());
        }
      }
    ]);
  }

  // Inicial do avatar usa codinome
  function getInicial(item) {
    const ref = item.codinome || item.nome;
    return ref.charAt(0).toUpperCase();
  }

  // Nome exibido é sempre o codinome (se tiver), senão mostra "–"
  function getNomeExibido(item) {
    return item.codinome || '—';
  }

  function renderItem({ item }) {
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardBody}
          onPress={() => navigation.navigate('PatientDetail', { paciente: item })}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInicial(item)}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName}>{getNomeExibido(item)}</Text>
            {item.telefone
              ? <Text style={styles.cardSub}>📞 {item.telefone}</Text>
              : null}
            {item.data_inicio
              ? <Text style={styles.cardSub}>🗓 Início: {item.data_inicio}</Text>
              : null}
          </View>
        </TouchableOpacity>
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.editBtn} onPress={() => irParaFormulario(item)}>
            <Text style={styles.editBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => confirmarDelecao(item.id, getNomeExibido(item))}
          >
            <Text style={styles.deleteBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Analisantes</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => irParaFormulario()}>
          <Text style={styles.addBtnText}>+ Novo</Text>
        </TouchableOpacity>
      </View>

      {pacientes.length === 0 ? (
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
          contentContainerStyle={styles.list}
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
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  cardBody:     { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#3D5A80',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText:   { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardInfo:     { flex: 1 },
  cardName:     { fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  cardSub:      { fontSize: 13, color: '#888', marginTop: 2 },
  cardActions:  { flexDirection: 'row', gap: 8 },
  editBtn:      { padding: 8 },
  editBtnText:  { fontSize: 20 },
  deleteBtn:    { padding: 8 },
  deleteBtnText:{ fontSize: 20 },
  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:    { fontSize: 64, marginBottom: 16 },
  emptyText:    { fontSize: 16, color: '#aaa', marginBottom: 24 },
  emptyBtn:     { backgroundColor: '#3D5A80', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  emptyBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});