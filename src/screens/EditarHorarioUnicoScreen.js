// "Só este horário" (item 4, v13) — edita start_time/end_time de UM
// compromisso específico (tabela appointments), sem tocar no horário
// recorrente em availability_slots. Deliberadamente simples (2 campos de
// hora) porque só existe pra esse único caso de uso — o editor completo do
// horário recorrente continua em DisponibilidadeScreen.js.
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { atualizarHorarioAppointment } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import {
  mascararHorario, normalizarHorario, horarioValido, horarioParaMinutos, terminoPadrao,
  DURACAO_PADRAO_SESSAO_MIN,
} from '../services/horarios';

export default function EditarHorarioUnicoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { appointmentId, date, startTime, endTime } = route.params;

  const [inicio, setInicio] = useState(startTime || '');
  const [fim, setFim] = useState(endTime || '');
  const [salvando, setSalvando] = useState(false);
  // Já chega com o término do compromisso — mexer no início não deve
  // sobrescrever esse valor sozinho (ver DisponibilidadeScreen.js).
  const terminoManualRef = useRef(!!endTime);

  const dataFormatada = date ? date.split('-').reverse().join('/') : '';

  function aoDigitarInicio(texto) {
    const mascarado = mascararHorario(texto);
    setInicio(mascarado);
    if (terminoManualRef.current) return;
    const sugerido = terminoPadrao(mascarado);
    if (sugerido) setFim(sugerido);
  }

  function aoDigitarFim(texto) {
    terminoManualRef.current = true;
    setFim(mascararHorario(texto));
  }

  async function salvar() {
    // "845" digitado direto vira 08:45 aqui, sem depender de sair do campo.
    const inicioFinal = normalizarHorario(inicio);
    const fimFinal = normalizarHorario(fim);

    if (!horarioValido(inicioFinal) || !horarioValido(fimFinal)) {
      Alert.alert('Horário inválido', 'Informe os horários no formato HH:MM.\n\nExemplo: 07:45 (dá pra digitar só "745").');
      return;
    }
    if (horarioParaMinutos(inicioFinal) >= horarioParaMinutos(fimFinal)) {
      Alert.alert('Intervalo inválido', 'O horário de término deve ser posterior ao horário de início.');
      return;
    }
    setInicio(inicioFinal);
    setFim(fimFinal);
    setSalvando(true);
    try {
      await atualizarHorarioAppointment(appointmentId, { startTime: inicioFinal, endTime: fimFinal });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Editar só este horário" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.subtitulo}>
          Só o compromisso de {dataFormatada || 'hoje'} muda — o horário recorrente da agenda
          continua igual pras próximas semanas.
        </Text>

        <Text style={s.label}>Início</Text>
        <TextInput
          style={s.input}
          value={inicio}
          onChangeText={aoDigitarInicio}
          onBlur={() => { const n = normalizarHorario(inicio); if (n) setInicio(n); }}
          placeholder="745"
          placeholderTextColor="#756E66"
          keyboardType="numeric"
          maxLength={5}
        />

        <Text style={s.label}>Término</Text>
        <TextInput
          style={s.input}
          value={fim}
          onChangeText={aoDigitarFim}
          onBlur={() => { const n = normalizarHorario(fim); if (n) setFim(n); }}
          placeholder="HH:MM"
          placeholderTextColor="#756E66"
          keyboardType="numeric"
          maxLength={5}
        />
        <Text style={s.dica}>
          Dá pra digitar só os números ("745" vira 07:45). Num horário novo, o
          término se preenche sozinho com {DURACAO_PADRAO_SESSAO_MIN} minutos.
        </Text>

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
  safe: { flex: 1, backgroundColor: '#FDFCFA' },
  content: { padding: 20 },
  subtitulo: { fontSize: 13, color: '#756E66', marginBottom: 20, lineHeight: 18 },
  dica: { fontSize: 11.5, color: '#8C857B', fontStyle: 'italic', lineHeight: 16, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#302C28', marginBottom: 6, marginTop: 12, lineHeight: 19 },
  input: {
    borderWidth: 1, borderColor: '#EAE5DC', borderRadius: 10, padding: 12,
    fontSize: 16, color: '#302C28',
  },
  btnSalvar: {
    backgroundColor: '#497363', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 24,
  },
  btnSalvarTexto: { color: '#fff', fontWeight: '500', fontSize: 15, lineHeight: 22 },
});
