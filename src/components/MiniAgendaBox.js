import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getAppointmentsByDate } from '../services/database';

const COLORS = {
  surface: '#FFFFFF',
  borderAzul: '#3D5A80',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
};

const MAX_LINHAS = 4;

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MiniAgendaBox({ navigation }) {
  const [compromissos, setCompromissos] = useState([]);

  useFocusEffect(
    useCallback(() => {
      getAppointmentsByDate(hojeISO())
        .then(setCompromissos)
        .catch(() => setCompromissos([]));
    }, [])
  );

  const visiveis = compromissos.slice(0, MAX_LINHAS);
  const restantes = compromissos.length - visiveis.length;

  return (
    <TouchableOpacity
      style={s.molduraGrossa}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Agenda')}
    >
      <View style={s.molduraFina}>
        <View style={s.caixa}>
          <View style={s.header}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.borderAzul} />
            <Text style={s.titulo}>Agenda de hoje</Text>
          </View>

          {visiveis.length === 0 ? (
            <Text style={s.vazio}>Nenhum horário hoje</Text>
          ) : (
            visiveis.map((c) => (
              <Text key={c.id} style={s.linha} numberOfLines={1}>
                {c.start_time?.slice(0, 5)} · {c.patient_nome || c.titulo || 'Compromisso'}
              </Text>
            ))
          )}
          {restantes > 0 && <Text style={s.maisTexto}>+{restantes} mais</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  molduraGrossa: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: COLORS.borderAzul,
    padding: 3,
  },
  molduraFina: {
    flex: 1,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.borderAzul,
    padding: 2,
  },
  caixa: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 15,
    padding: 16,
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  linha: { fontSize: 13.5, color: COLORS.textDark, marginBottom: 6 },
  vazio: { fontSize: 13.5, color: COLORS.textMid, fontStyle: 'italic' },
  maisTexto: { fontSize: 12.5, color: COLORS.textMid, marginTop: 2, fontWeight: '600' },
});
