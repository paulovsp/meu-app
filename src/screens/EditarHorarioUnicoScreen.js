// "Só este horário" (item 4, v13) — edita start_time/end_time de UM
// compromisso específico (tabela appointments), sem tocar no horário
// recorrente em availability_slots. Deliberadamente simples (2 campos de
// hora) porque só existe pra esse único caso de uso — o editor completo do
// horário recorrente continua em DisponibilidadeScreen.js.
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { atualizarHorarioAppointment } from '../services/database';
import { mensagemDeErro } from '../services/erros';

function horarioValido(horario) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(horario);
}
function horarioParaMinutos(horario) {
  const [hh, mm] = horario.split(':').map(Number);
  return hh * 60 + mm;
}

export default function EditarHorarioUnicoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { appointmentId, date, startTime, endTime } = route.params;

  const [inicio, setInicio] = useState(startTime || '');
  const [fim, setFim] = useState(endTime || '');
  const [salvando, setSalvando] = useState(false);

  const dataFormatada = date ? date.split('-').reverse().join('/') : '';

  async function salvar() {
    if (!horarioValido(inicio) || !horarioValido(fim)) {
      Alert.alert('Horário inválido', 'Informe os horários no formato HH:MM.\n\nExemplo: 07:45');
      return;
    }
    if (horarioParaMinutos(inicio) >= horarioParaMinutos(fim)) {
      Alert.alert('Intervalo inválido', 'O horário de término deve ser posterior ao horário de início.');
      return;
    }
    setSalvando(true);
    try {
      await atualizarHorarioAppointment(appointmentId, { startTime: inicio, endTime: fim });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.titulo}>Editar só este horário</Text>
        <Text style={s.subtitulo}>
          Só o compromisso de {dataFormatada || 'hoje'} muda — o horário recorrente da agenda
          continua igual pras próximas semanas.
        </Text>

        <Text style={s.label}>Início</Text>
        <TextInput
          style={s.input}
          value={inicio}
          onChangeText={setInicio}
          placeholder="HH:MM"
          placeholderTextColor="#B0ADA6"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />

        <Text style={s.label}>Término</Text>
        <TextInput
          style={s.input}
          value={fim}
          onChangeText={setFim}
          placeholder="HH:MM"
          placeholderTextColor="#B0ADA6"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />

        <TouchableOpacity
          style={[s.btnSalvar, salvando && { opacity: 0.6 }]}
          onPress={salvar}
          disabled={salvando}
        >
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSalvarTexto}>Salvar</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20 },
  titulo: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginBottom: 6 },
  subtitulo: { fontSize: 13, color: '#6B6860', marginBottom: 20, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#1A1A2E', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: '#E0E4EA', borderRadius: 10, padding: 12,
    fontSize: 16, color: '#1A1A2E',
  },
  btnSalvar: {
    backgroundColor: '#3D5A80', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 24,
  },
  btnSalvarTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
