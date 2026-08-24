// Aberta ao tocar num horário liberado (item 1, v16 — "apagar só este
// horário" da Agenda) — o horário recorrente segue vinculado a outro
// analisante nas demais semanas, mas esta data específica está livre.
// Escolher um analisante aqui cria um compromisso avulso só para esta
// data, sem mexer no horário recorrente.
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { listarPacientes, criarAppointmentAvulso } from '../services/database';
import { mensagemDeErro } from '../services/erros';

const COLORS = {
  bg: '#F7F5F0', surface: '#FFFFFF', border: '#EAE5DC',
  textDark: '#302C28', textMid: '#756E66', textLight: '#8C857B', btnBlue: '#497363',
};

export default function MarcarHorarioAvulsoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { dataISO, startTime, endTime, modality } = route.params;

  const [pacientes, setPacientes] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [marcando, setMarcando] = useState(null);

  useFocusEffect(
    useCallback(() => {
      listarPacientes()
        .then(setPacientes)
        .catch((err) => Alert.alert('Erro', mensagemDeErro(err)))
        .finally(() => setCarregando(false));
    }, [])
  );

  async function escolherPaciente(paciente) {
    setMarcando(paciente.id);
    try {
      const criado = await criarAppointmentAvulso({
        patientId: paciente.id,
        dataISO,
        startTime,
        endTime,
        modality: modality || 'ambos',
      });
      navigation.replace('DetalheCompromisso', { appointmentId: criado.id });
    } catch (err) {
      setMarcando(null);
      Alert.alert('Erro ao marcar', mensagemDeErro(err));
    }
  }

  const dataFormatada = dataISO ? dataISO.split('-').reverse().join('/') : '';
  const pacientesFiltrados = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(filtro.toLowerCase())
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Marcar horário" onVoltar={() => navigation.goBack()} />
      <View style={s.infoBox}>
        <Text style={s.infoTexto}>
          {dataFormatada} · {startTime}{endTime ? `–${endTime}` : ''}
        </Text>
        <Text style={s.infoSub}>Escolha o analisante pra este horário</Text>
      </View>

      <View style={s.buscaWrap}>
        <Ionicons name="search-outline" size={18} color={COLORS.textMid} />
        <TextInput
          style={s.buscaInput}
          value={filtro}
          onChangeText={setFiltro}
          placeholder="Buscar analisante..."
          placeholderTextColor="#756E66"
        />
      </View>

      {carregando ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.btnBlue} />
        </View>
      ) : (
        <FlatList
          data={pacientesFiltrados}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.lista}
          ListEmptyComponent={<Text style={s.vazio}>Nenhum analisante encontrado.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.pacienteLinha}
              onPress={() => escolherPaciente(item)}
              disabled={!!marcando}
            >
              <Text style={s.pacienteNome}>{item.nome}</Text>
              {marcando === item.id ? (
                <ActivityIndicator color={COLORS.btnBlue} size="small" />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  infoBox: {
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  infoTexto: { fontSize: 16, fontWeight: '600', color: COLORS.textDark, lineHeight: 23 },
  infoSub: { fontSize: 13, color: COLORS.textMid, marginTop: 2, lineHeight: 19 },
  buscaWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, margin: 16, marginBottom: 8, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  buscaInput: { flex: 1, fontSize: 15, color: COLORS.textDark, lineHeight: 22 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lista: { paddingHorizontal: 16, paddingBottom: 16 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 13, marginTop: 12, lineHeight: 19 },
  pacienteLinha: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  pacienteNome: { fontSize: 15, color: COLORS.textDark, fontWeight: '600', lineHeight: 22 },
});
