import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getAppointmentsByDate, ensureAppointmentsForDate, getAvailabilitySlots, slotAtivoNaData,
} from '../services/database';
import { corTipoEvento, ehTipoGrupo } from '../services/tiposEvento';
import { papel, tinta, salvia } from '../theme';

const COLORS = {
  surface: papel.alto,
  moldura: salvia.tinta,
  molduraFina: salvia.suave,
  textDark: tinta.t900,
  textMid: tinta.t500,
};

const COR_LIVRE = '#43A047';

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Primeiro nome (ou o título/"Grupo") — o widget é estreito demais pro nome
// inteiro.
function nomeCurto({ tipo, patientNome, titulo, participantes }) {
  if (tipo === 'outros') return (titulo || 'Outros').split(' ')[0];
  if (ehTipoGrupo(tipo)) return participantes?.[0]?.nome?.split(' ')[0] || 'Grupo';
  return (patientNome || 'Livre').split(' ')[0];
}

/**
 * Prévia do dia (verde = livre, cor do tipo de evento = ocupado), numa
 * pilha vertical compacta. O widget INTEIRO é um botão só — os blocos de
 * horário aqui dentro são só visuais, nunca tocáveis individualmente: cada
 * bloco tem a mesma posição/formato de um botão real da Agenda, e deixar
 * cada um navegar por conta própria fazia o toque "coincidir" com a grade
 * de verdade da tela Agenda, abrindo direto o compromisso daquele horário
 * em vez de só levar pra Agenda — o widget é prévia, não uma réplica
 * interativa da Agenda. Tocar em qualquer lugar do card leva só pra Agenda.
 */
export default function MiniAgendaBox({ navigation, altura }) {
  const [itens, setItens] = useState([]);
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
      const diaSemana = hoje.getDay();
      const dataISO = hojeISO();

      // Item 3 (leva pós-v13): appointments só "nasce" quando o dia é
      // aberto na Agenda de verdade (mesmo gatilho que AgendaScreen.js usa
      // na visão diária) — sem chamar isso aqui, um dia nunca visitado na
      // Agenda aparecia vazio no widget mesmo tendo horário marcado.
      Promise.all([
        ensureAppointmentsForDate(dataISO, diaSemana).then(() => getAppointmentsByDate(dataISO)),
        getAvailabilitySlots(),
      ])
        .then(([compromissosDia, slots]) => {
          const compromissos = (compromissosDia || []).filter((c) => c.status !== 'cancelado');
          const slotsHoje = (slots || []).filter(
            (s) => s.day_of_week === diaSemana && slotAtivoNaData(s, dataISO)
          );

          const horariosComSlot = new Set();
          const lista = [];

          for (const slot of slotsHoje) {
            const compromisso = compromissos.find((c) => c.start_time === slot.start_time);
            horariosComSlot.add(slot.start_time);
            const tipo = compromisso?.tipo || slot.tipo || 'sessao_individual';
            const ocupado = !!compromisso || !!slot.patient_id || tipo === 'outros' || ehTipoGrupo(tipo);
            lista.push({
              key: `slot-${slot.id}`,
              startTime: slot.start_time,
              cor: ocupado ? corTipoEvento(tipo) : COR_LIVRE,
              nome: nomeCurto({
                tipo,
                patientNome: compromisso?.patient_nome || slot.patient_name,
                titulo: compromisso?.titulo || slot.titulo,
                participantes: compromisso?.participantes || slot.participantes,
              }),
            });
          }

          // Compromissos avulsos (sem horário recorrente por trás) não
          // aparecem no loop acima — entram à parte, como a Agenda também
          // faz (renderAgendamentosSemSlot).
          for (const c of compromissos) {
            if (horariosComSlot.has(c.start_time)) continue;
            lista.push({
              key: `compromisso-${c.id}`,
              startTime: c.start_time,
              cor: corTipoEvento(c.tipo),
              nome: nomeCurto({ tipo: c.tipo, patientNome: c.patient_nome, titulo: c.titulo, participantes: c.participantes }),
            });
          }

          lista.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
          setItens(lista);
        })
        .catch(() => setItens([]))
        .finally(() => setCarregando(false));
    }, [])
  );

  function abrirAgenda() {
    if (navegandoRef.current) return;
    navegandoRef.current = true;
    navigation.navigate('Agenda');
  }

  return (
    // Moldura tripla: fina, grossa (3 dp ≈ 0,5 mm) e fina de novo. O card
    // inteiro é um único TouchableOpacity — ver comentário acima.
    <TouchableOpacity style={s.molduraExterna} activeOpacity={0.85} onPress={abrirAgenda}>
      <View style={s.molduraCentral}>
        <View style={s.molduraInterna}>
          <View style={[s.caixa, altura ? { height: altura } : null]}>
            <View style={s.header}>
              <Ionicons name="calendar-outline" size={16} color={salvia.tinta} />
              {/* Só "Agenda": o widget é estreito e "Agenda de hoje" era
                  cortado no meio da palavra em telas menores. */}
              <Text style={s.titulo} numberOfLines={1}>Agenda</Text>
              {carregando && (
                <ActivityIndicator size="small" color={salvia.tinta} style={s.spinner} />
              )}
            </View>

            {carregando && itens.length === 0 ? null : itens.length === 0 ? (
              <Text style={s.vazio}>Nenhum horário hoje</Text>
            ) : (
              // Barras finas, uma abaixo da outra, dividindo a altura
              // disponível — todas cabem sem rolar, com qualquer quantidade
              // de horários do dia. A cor original do tipo (tiposEvento.js)
              // vive na borda; o preenchimento fica em papel, senão o widget
              // inteiro vira um bloco de cor. Puramente visual — sem onPress.
              <View style={s.pilha}>
                {itens.map((item) => (
                  <View key={item.key} style={[s.slotExterno, { borderColor: item.cor + '44' }]}>
                    <View style={[s.slotCentral, { borderColor: item.cor }]}>
                      <View style={[s.slotInterno, { borderColor: item.cor + '44' }]}>
                        <Text style={s.slotHora} numberOfLines={1}>{item.startTime?.slice(0, 5)}</Text>
                        <Text style={s.slotNome} numberOfLines={1}>{item.nome}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  molduraExterna: {
    flex: 1,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: COLORS.molduraFina,
    padding: 2,
    backgroundColor: COLORS.surface,
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  molduraCentral: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: COLORS.moldura,
    padding: 2,
  },
  molduraInterna: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.molduraFina,
    overflow: 'hidden',
  },
  caixa: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    // altura fixa (não só mínimo) + corte — a Início não rola, então o
    // widget nunca pode crescer além do espaço reservado.
    overflow: 'hidden',
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 13.5, fontWeight: '500', color: COLORS.textDark, lineHeight: 18 },
  spinner: { marginLeft: 'auto' },
  vazio: { fontSize: 13, color: COLORS.textMid, fontStyle: 'italic', lineHeight: 19 },

  pilha: { flex: 1, gap: 5 },
  slotExterno: {
    flex: 1,
    minHeight: 19,
    maxHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    padding: 1,
  },
  slotCentral: { flex: 1, borderRadius: 6, borderWidth: 2, padding: 1 },
  slotInterno: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1,
    backgroundColor: papel.alto,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  slotHora: { fontSize: 10.5, fontWeight: '500', color: tinta.t900, lineHeight: 14 },
  slotNome: { flex: 1, fontSize: 10, color: tinta.t500, lineHeight: 13 },
});
