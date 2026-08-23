import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getAppointmentsByDate, ensureAppointmentsForDate } from '../services/database';
import { horarioJaPassou } from '../services/compromissoStatus';

const COLORS = {
  surface: '#FFFFFF',
  borderAzul: '#3D5A80',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
};

// Mesmas cores de ESTADO_LABEL (compromissoStatus.js), versão simplificada
// pro espaço pequeno do widget — sem buscar transcrição por paciente (isso
// exigiria uma consulta extra por linha só pra colorir uma bolinha).
const COR_STATUS = {
  agendado_futuro: '#3D5A80',
  aguardando_confirmacao: '#F09B4A',
  realizado: '#2E8B57',
  nao_realizado: '#C0392B',
};

function corDoStatus(compromisso) {
  if (compromisso.status === 'realizado') return COR_STATUS.realizado;
  if (compromisso.status === 'nao_realizado') return COR_STATUS.nao_realizado;
  const passou = horarioJaPassou(compromisso.date, compromisso.end_time);
  return passou ? COR_STATUS.aguardando_confirmacao : COR_STATUS.agendado_futuro;
}

const MAX_LINHAS = 4;

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MiniAgendaBox({ navigation, altura }) {
  const [compromissos, setCompromissos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  // Sem isso, um toque duplo (comum quando a pessoa não vê nenhum sinal de
  // que o primeiro toque "pegou" — exatamente o caso do carregando acima,
  // antes de existir) podia disparar navigation.navigate('Agenda') mais de
  // uma vez em sequência rápida, empilhando navegação por cima da própria
  // transição ainda em andamento. Trava no primeiro toque; destrava quando
  // a Início ganha foco de novo (voltando da Agenda).
  const navegandoRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      navegandoRef.current = false;
      setCarregando(true);
      const hoje = new Date();
      // Item 3 (leva pós-v13): appointments só "nasce" quando o dia é
      // aberto na Agenda de verdade (mesmo gatilho que AgendaScreen.js usa
      // na visão diária) — sem chamar isso aqui, um dia nunca visitado na
      // Agenda aparecia vazio no widget mesmo tendo horário marcado.
      ensureAppointmentsForDate(hojeISO(), hoje.getDay())
        .then(() => getAppointmentsByDate(hojeISO()))
        .then((lista) => setCompromissos((lista || []).filter((c) => c.status !== 'cancelado')))
        .catch(() => setCompromissos([]))
        .finally(() => setCarregando(false));
    }, [])
  );

  function abrirAgenda() {
    if (navegandoRef.current) return;
    navegandoRef.current = true;
    navigation.navigate('Agenda');
  }

  const visiveis = compromissos.slice(0, MAX_LINHAS);
  const restantes = compromissos.length - visiveis.length;

  return (
    <TouchableOpacity
      style={s.molduraGrossa}
      activeOpacity={0.75}
      onPress={abrirAgenda}
    >
      <View style={s.molduraFina}>
        <View style={[s.caixa, altura ? { height: altura } : null]}>
          <View style={s.header}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.borderAzul} />
            <Text style={s.titulo}>Agenda de hoje</Text>
            {carregando && (
              <ActivityIndicator size="small" color={COLORS.borderAzul} style={s.spinner} />
            )}
          </View>

          {carregando && compromissos.length === 0 ? null : visiveis.length === 0 ? (
            <Text style={s.vazio}>Nenhum horário hoje</Text>
          ) : (
            visiveis.map((c) => (
              <View key={c.id} style={s.linhaRow}>
                <View style={[s.statusDot, { backgroundColor: corDoStatus(c) }]} />
                <Text style={s.linha} numberOfLines={1}>
                  {c.start_time?.slice(0, 5)} · {c.patient_nome || c.titulo || 'Compromisso'}
                </Text>
              </View>
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
    // altura fixa (não só mínimo) + corte — a Início não rola mais (item
    // 2), então este widget nunca pode crescer além do espaço reservado.
    overflow: 'hidden',
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  spinner: { marginLeft: 'auto' },
  linhaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  linha: { flex: 1, fontSize: 13.5, color: COLORS.textDark },
  vazio: { fontSize: 13.5, color: COLORS.textMid, fontStyle: 'italic' },
  maisTexto: { fontSize: 12.5, color: COLORS.textMid, marginTop: 2, fontWeight: '600' },
});
