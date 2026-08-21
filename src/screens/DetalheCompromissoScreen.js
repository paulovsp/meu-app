import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAppointmentById,
  updateAppointmentStatus,
  temTranscricaoParaData,
  getAvailabilitySlotByDayAndTime,
  deleteAvailabilitySlot,
  listarCompromissosFuturosDoHorario,
  cancelarCompromissosFuturosDoHorario,
} from '../services/database';
import { horarioJaPassou, getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { infoTipoEvento, ehTipoGrupo } from '../services/tiposEvento';
import { nomeExibicaoCompromisso, perguntarPagamentoSessao, perguntarCheckin } from '../services/checkinCompromisso';

export default function DetalheCompromissoScreen({ route, navigation }) {
  const { appointmentId } = route.params;

  useBloqueioAssinatura(navigation);

  const [compromisso, setCompromisso] = useState(null);
  const [temTranscricao, setTemTranscricao] = useState(false);
  const [agindo, setAgindo] = useState(false);
  const alertaMostradoRef = useRef(false);

  const carregar = useCallback(async () => {
    try {
      setCompromisso(await getAppointmentById(appointmentId));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    }
  }, [appointmentId]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  // Pergunta uma única vez por visita se a sessão aconteceu, quando o
  // horário já passou e ninguém ainda confirmou (status ainda 'agendado').
  useEffect(() => {
    if (!compromisso) return;
    const passou = horarioJaPassou(compromisso.date, compromisso.end_time);
    if (compromisso.status === 'agendado' && passou && !alertaMostradoRef.current) {
      alertaMostradoRef.current = true;
      perguntarCheckin(compromisso, { aoConcluir: carregar });
    }
  }, [compromisso, carregar]);

  useEffect(() => {
    if (!compromisso) return;
    const tipo = compromisso.tipo || 'sessao_individual';
    const eventoIndividual = tipo === 'sessao_individual' || tipo === 'supervisao_individual';
    if (!eventoIndividual) return;
    temTranscricaoParaData(compromisso.patient_id, compromisso.date).then(setTemTranscricao);
  }, [compromisso]);

  if (!compromisso) {
    return (
      <View style={styles.container}>
        <Text>Carregando...</Text>
      </View>
    );
  }

  const tipo = compromisso.tipo || 'sessao_individual';
  const eventoIndividual = tipo === 'sessao_individual' || tipo === 'supervisao_individual';
  const horarioPassou = horarioJaPassou(compromisso.date, compromisso.end_time);
  const estado = getEstadoCompromisso({
    status: compromisso.status,
    temTranscricao: eventoIndividual ? temTranscricao : true,
    horarioPassou,
  });
  const estadoInfo = ESTADO_LABEL[estado];
  const podeAgir = compromisso.status === 'agendado';

  // Item 4 (v13): appointments já guarda start_time/end_time próprios,
  // independentes do horário recorrente — "só este dia" é uma edição
  // pontual dessa linha, sem tocar em availability_slots.
  function editarHorario() {
    const dataFormatada = compromisso.date.split('-').reverse().join('/');
    Alert.alert(
      'Editar horário',
      'Editar só este horário, ou este e todos os futuros?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: `Só este (${dataFormatada})`,
          onPress: () => navigation.navigate('EditarHorarioUnico', {
            appointmentId: compromisso.id,
            date: compromisso.date,
            startTime: compromisso.start_time,
            endTime: compromisso.end_time,
          }),
        },
        { text: 'Este e todos os futuros', onPress: editarHorarioRecorrente },
      ]
    );
  }

  async function editarHorarioRecorrente() {
    const [ano, mes, dia] = compromisso.date.split('-').map(Number);
    const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
    try {
      const slot = await getAvailabilitySlotByDayAndTime(dayOfWeek, compromisso.start_time);
      navigation.navigate('EditarHorario', {
        slotId: slot?.id || null,
        date: compromisso.date,
        startTime: compromisso.start_time,
        endTime: compromisso.end_time,
        dayOfWeek,
      });
    } catch (e) {
      Alert.alert('Erro', mensagemDeErro(e));
    }
  }

  async function iniciarSessao() {
    setAgindo(true);
    try {
      await updateAppointmentStatus(compromisso.id, 'realizado');
    } catch (e) {
      setAgindo(false);
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
      return;
    }
    await perguntarPagamentoSessao(compromisso);
    setAgindo(false);
    navigation.replace('NewSession', {
      patientId: compromisso.patient_id,
      patientNome: compromisso.patient_nome,
      platform: compromisso.modality,
      appointmentId: compromisso.id,
    });
  }

  // Grupo/supervisão/outros não têm um único prontuário pra gravar — só
  // marca como realizado, sem abrir a tela de gravação de sessão.
  async function marcarComoRealizado() {
    setAgindo(true);
    try {
      await updateAppointmentStatus(compromisso.id, 'realizado');
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
    } finally {
      setAgindo(false);
    }
  }

  async function cancelarCompromisso() {
    setAgindo(true);
    try {
      await updateAppointmentStatus(compromisso.id, 'cancelado');
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao cancelar', mensagemDeErro(e));
    } finally {
      setAgindo(false);
    }
  }

  function perguntarEscopoCancelamento() {
    const dataFormatada = compromisso.date.split('-').reverse().join('/');
    Alert.alert(
      'Cancelar compromisso',
      'Cancelar só este horário, ou este e todos os futuros?',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: `Só este (${dataFormatada})`, onPress: cancelarCompromisso },
        { text: 'Este e todos os futuros', style: 'destructive', onPress: cancelarRecorrenteComCascata },
      ]
    );
  }

  // "Todos os futuros" remove o horário recorrente (availability_slots) e
  // cancela em cascata os compromissos futuros ainda não realizados desse
  // mesmo horário — avisa quantos antes de confirmar, pra não surpreender.
  async function cancelarRecorrenteComCascata() {
    const [ano, mes, dia] = compromisso.date.split('-').map(Number);
    const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
    setAgindo(true);
    let slot, futuros;
    try {
      [slot, futuros] = await Promise.all([
        getAvailabilitySlotByDayAndTime(dayOfWeek, compromisso.start_time),
        listarCompromissosFuturosDoHorario({
          patientId: compromisso.patient_id,
          dayOfWeek,
          startTime: compromisso.start_time,
        }),
      ]);
    } catch (e) {
      setAgindo(false);
      Alert.alert('Erro', mensagemDeErro(e));
      return;
    }
    setAgindo(false);

    Alert.alert(
      'Confirmar cancelamento',
      futuros.length > 0
        ? `Isso remove o horário recorrente da agenda e cancela mais ${futuros.length} compromisso${futuros.length === 1 ? '' : 's'} futuro${futuros.length === 1 ? '' : 's'} desse horário, além deste. Confirma?`
        : 'Isso remove o horário recorrente da agenda. Não há outros compromissos futuros desse horário. Confirma?',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: 'destructive',
          onPress: async () => {
            setAgindo(true);
            try {
              await updateAppointmentStatus(compromisso.id, 'cancelado');
              if (futuros.length > 0) {
                await cancelarCompromissosFuturosDoHorario({
                  patientId: compromisso.patient_id,
                  dayOfWeek,
                  startTime: compromisso.start_time,
                });
              }
              if (slot?.id) await deleteAvailabilitySlot(slot.id);
              await carregar();
            } catch (e) {
              Alert.alert('Erro ao cancelar', mensagemDeErro(e));
            } finally {
              setAgindo(false);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={[styles.tipoLabel, { color: infoTipoEvento(tipo).cor }]}>
        {infoTipoEvento(tipo).labelCurto}
      </Text>
      <Text style={styles.nome}>{nomeExibicaoCompromisso(compromisso)}</Text>

      <View style={[styles.estadoPill, { backgroundColor: `${estadoInfo.cor}22` }]}>
        <Text style={[styles.estadoPillTxt, { color: estadoInfo.cor }]}>{estadoInfo.texto}</Text>
      </View>

      {eventoIndividual && estado === 'realizado_sem_relato' && (
        <View style={styles.avisoBox}>
          <Text style={styles.avisoTxt}>
            ⚠ Nenhum relato ou transcrição foi adicionado para esta sessão ainda.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <InfoLinha label="Modalidade" valor={compromisso.modality === 'online' ? 'Online' : 'Presencial'} />
        <InfoLinha label="Data" valor={compromisso.date.split('-').reverse().join('/')} />
        <InfoLinha label="Horário" valor={`${compromisso.start_time} - ${compromisso.end_time}`} />
        {eventoIndividual && (
          <>
            <InfoLinha label="Telefone" valor={compromisso.patient_telefone || '-'} />
            <InfoLinha label="Nascimento" valor={compromisso.patient_nascimento || '-'} />
            <InfoLinha label="Início do tratamento" valor={compromisso.patient_data_inicio || '-'} />
          </>
        )}
        {ehTipoGrupo(tipo) && (
          <InfoLinha label="Participantes" valor={(compromisso.participantes || []).map((p) => p.nome).join(', ') || '-'} />
        )}
      </View>

      <TouchableOpacity style={styles.btnEditarHorario} onPress={editarHorario}>
        <Text style={styles.btnEditarHorarioTxt}>✏️ Editar informações do horário</Text>
      </TouchableOpacity>

      {podeAgir && (
        <>
          <TouchableOpacity
            style={[styles.btnIniciar, agindo && { opacity: 0.7 }]}
            onPress={eventoIndividual ? iniciarSessao : marcarComoRealizado}
            disabled={agindo}
          >
            {agindo
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnIniciarTxt}>{eventoIndividual ? 'Iniciar Sessão' : 'Marcar como realizado'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnCancelar, agindo && { opacity: 0.7 }]}
            disabled={agindo}
            onPress={perguntarEscopoCancelamento}
          >
            {agindo ? <ActivityIndicator color="#c62828" /> : <Text style={styles.btnCancelarTxt}>Cancelar Compromisso</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function InfoLinha({ label, valor }) {
  return (
    <View style={styles.linha}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.valor}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  tipoLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  nome: { fontSize: 24, fontWeight: 'bold', marginBottom: 12 },
  estadoPill: {
    alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 6, marginBottom: 16,
  },
  estadoPillTxt: { fontSize: 13, fontWeight: '700' },
  avisoBox: {
    backgroundColor: '#FCEBEA', borderRadius: 10, padding: 12, marginBottom: 16,
  },
  avisoTxt: { color: '#C0392B', fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 14, marginBottom: 20 },
  btnEditarHorario: {
    padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#3D5A80',
  },
  btnEditarHorarioTxt: { color: '#3D5A80', fontWeight: 'bold' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  label: { color: '#777' },
  valor: { fontWeight: '600' },
  btnIniciar: { backgroundColor: '#2e7d32', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  btnIniciarTxt: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnCancelar: { padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#c62828' },
  btnCancelarTxt: { color: '#c62828', fontWeight: 'bold' },
});
