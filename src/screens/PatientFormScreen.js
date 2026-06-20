import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ScrollView, Alert
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { inserirPaciente, editarPaciente } from '../services/database';

export default function PatientFormScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const pacienteExistente = route.params?.paciente ?? null;
  const editando = pacienteExistente !== null;

  const [nome, setNome]           = useState(pacienteExistente?.nome ?? '');
  const [nascimento, setNascimento] = useState(pacienteExistente?.nascimento ?? '');
  const [dataInicio, setDataInicio] = useState(pacienteExistente?.data_inicio ?? '');
  const [telefone, setTelefone]   = useState(pacienteExistente?.telefone ?? '');
  const [codinome, setCodinome]   = useState(pacienteExistente?.codinome ?? '');

  function formatarData(texto, setter) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length >= 3 && numeros.length <= 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    } else if (numeros.length > 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
    }
    setter(formatado);
  }

  function formatarTelefone(texto) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length > 2 && numeros.length <= 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    } else if (numeros.length > 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7, 11)}`;
    }
    setTelefone(formatado);
  }

  function salvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Por favor, informe o nome do analisante.');
      return;
    }
    if (!codinome.trim()) {
      Alert.alert('Campo obrigatório', 'Por favor, informe o codinome de privacidade.');
      return;
    }
    try {
      if (editando) {
        editarPaciente({
          id: pacienteExistente.id,
          nome: nome.trim(),
          nascimento,
          data_inicio: dataInicio,
          telefone,
          codinome: codinome.trim(),
        });
      } else {
        inserirPaciente({
          nome: nome.trim(),
          nascimento,
          data_inicio: dataInicio,
          telefone,
          codinome: codinome.trim(),
        });
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível salvar. Tente novamente.');
      console.error(e);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editando ? 'Editar Analisante' : 'Novo Analisante'}
        </Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

        {/* ── CODINOME — sempre visível e em destaque ── */}
        <View style={styles.codinomeDestaque}>
          <Text style={styles.codinomeDestaqueLabel}>🔒 Codinome de privacidade *</Text>
          <TextInput
            style={styles.codinomeInput}
            placeholder="Ex: Paciente A, Rosa, P1..."
            placeholderTextColor="#8AAEC8"
            value={codinome}
            onChangeText={setCodinome}
            autoCapitalize="words"
            returnKeyType="next"
          />
          <Text style={styles.hint}>
            Este é o nome que aparecerá em todo o aplicativo. O nome real fica protegido.
          </Text>
        </View>

        {/* ── NOME REAL — só visível ao editar ── */}
        {editando && (
          <View style={styles.nomeRealBox}>
            <Text style={styles.nomeRealLabel}>⚠️ Nome real (confidencial)</Text>
            <TextInput
              style={styles.input}
              placeholder="Nome completo do analisante"
              placeholderTextColor="#bbb"
              value={nome}
              onChangeText={setNome}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Text style={styles.hint}>
              Usado internamente para substituição automática nas transcrições.
            </Text>
          </View>
        )}

        {/* ── NOME REAL — só no cadastro (novo), sem mostrar o que foi digitado ── */}
        {!editando && (
          <View style={styles.nomeRealBox}>
            <Text style={styles.nomeRealLabel}>⚠️ Nome real (confidencial)</Text>
            <TextInput
              style={styles.input}
              placeholder="Nome completo do analisante"
              placeholderTextColor="#bbb"
              value={nome}
              onChangeText={setNome}
              autoCapitalize="words"
              returnKeyType="next"
              secureTextEntry={true}
            />
            <Text style={styles.hint}>
              Nunca aparecerá nas telas. Usado só para proteger transcrições.
            </Text>
          </View>
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Data de nascimento</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#bbb"
            value={nascimento}
            onChangeText={(t) => formatarData(t, setNascimento)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Início do acompanhamento</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#bbb"
            value={dataInicio}
            onChangeText={(t) => formatarData(t, setDataInicio)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Telefone / WhatsApp</Text>
          <TextInput
            style={styles.input}
            placeholder="(11) 99999-9999"
            placeholderTextColor="#bbb"
            value={telefone}
            onChangeText={formatarTelefone}
            keyboardType="phone-pad"
            maxLength={15}
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={salvar}>
          <Text style={styles.saveBtnText}>
            {editando ? '💾 Salvar alterações' : '✅ Cadastrar analisante'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backBtn:      { width: 80 },
  backBtnText:  { color: '#3D5A80', fontSize: 15, fontWeight: '600' },
  headerTitle:  { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E' },
  form:         { padding: 24, gap: 20 },
  fieldGroup:   { gap: 6 },
  label: {
    fontSize: 13, fontWeight: '600', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  hint:         { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, color: '#1A1A2E',
    borderWidth: 1, borderColor: '#E0E4EA',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },

  // Codinome em destaque
  codinomeDestaque: {
    backgroundColor: '#EBF3FB',
    borderRadius: 14,
    padding: 18,
    borderWidth: 2,
    borderColor: '#3D5A80',
    gap: 8,
  },
  codinomeDestaqueLabel: {
    fontSize: 14, fontWeight: '700', color: '#3D5A80',
  },
  codinomeInput: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 18, fontWeight: '600', color: '#1A1A2E',
    borderWidth: 1, borderColor: '#8AAEC8',
  },

  // Nome real em alerta discreto
  nomeRealBox: {
    backgroundColor: '#FFF8E7',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0C040',
    gap: 8,
  },
  nomeRealLabel: {
    fontSize: 13, fontWeight: '700', color: '#8a6000',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  saveBtn: {
    backgroundColor: '#3D5A80', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 12,
  },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText:{ color: '#999', fontSize: 15 },
});