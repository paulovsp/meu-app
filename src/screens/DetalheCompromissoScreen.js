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
  parsePreco,
  converterParaBRL,
  confirmarPagamentoSessao as confirmarPagamentoSessaoDB,
} from '../services/database';
import { dispararFiscalPorSessao } from '../services/fiscalAutomatico';
import { horarioJaPassou, getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { infoTipoEvento, ehTipoGrupo } from '../services/tiposEvento';

// Nome a exibir — paciente único (individual), lista de participantes (em
// grupo) ou o título livre ("Outros"), item J.23.
function nomeExibicaoCompromisso(compromisso) {
  const tipo = compromisso.tipo || 'sessao_individual';
  if (tipo === 'outros') return compromisso.titulo || 'Outros';
  if (ehTipoGrupo(tipo)) {
    const nomes = (compromisso.participantes || []).map((p) => p.nome).filter(Boolean);
    return nomes.length > 0 ? nomes.join(', ') : 'Grupo';
  }
  return compromisso.patient_nome || 'Analisante';
}

// Cobrança "por sessão": pergunta se o pagamento já foi recebido logo após
// marcar a sessão como realizada. Resolve a Promise só depois que a
// analisante escolhe uma opção (ou de imediato, se a cobrança for mensal),
// pra quem chama poder aguardar antes de navegar pra outra tela.
function perguntarPagamentoSessao(compromisso) {
  return new Promise((resolve) => {
    if (compromisso.patient_tipo_cobranca !== 'por_sessao') {
      resolve();
      return;
    }
    Alert.alert(
      'Pagamento da sessão',
      `O pagamento desta sessão de ${compromisso.patient_nome} já foi recebido?`,
      [
        { text: 'Ainda não', onPress: () => resolve() },
        {
          text: 'Sim, recebido',
          onPress: async () => {
            try {
              const valor = await converterParaBRL(parsePreco(compromisso.patient_preco), compromisso.patient_preco_moeda);
              await confirmarPagamentoSessaoDB(compromisso.id, compromisso.patient_id, compromisso.date, valor);
              dispararFiscalPorSessao(compromisso.patient_id, compromisso.date, valor);
            } catch (e) {
              Alert.alert('Erro ao confirmar pagamento', mensagemDeErro(e));
            } finally {
              resolve();
            }
          },
        },
      ]
    );
  });
}

// Sessão não aconteceu: precisa saber se foi cancelada com antecedência
// (cobrança cancelada — não dispara pergunta de pagamento) ou se foi uma
// falta sem aviso (cobrança segue normalmente — dispara a mesma pergunta
// de pagamento usada quando a sessão é realizada, já que o combinado é
// cobrar a falta também).
function perguntarTipoNaoRealizada(compromisso, recarregar) {
  Alert.alert(
    'Foi cancelada ou falta?',
    `${nomeExibicaoCompromisso(compromisso)} não aconteceu. Foi cancelada com antecedência, ou foi uma falta (sem aviso)?`,
    [
      {
        text: 'Cancelada',
        onPress: async () => {
          try {
            await updateAppointmentStatus(compromisso.id, 'cancelado');
            await recarregar();
            Alert.alert('Cancelamento registrado', 'Essa sessão foi marcada como cancelada — a cobrança dela foi cancelada.');
          } catch (e) {
            Alert.alert('Erro ao atualizar', mensagemDeErro(e));
          }
        },
      },
      {
        text: 'Falta',
        onPress: async () => {
          try {
            await updateAppointmentStatus(compromisso.id, 'nao_realizado');
            await recarregar();
            Alert.alert('Falta registrada', 'Essa sessão foi marcada como falta — a cobrança dela segue normalmente.');
            await perguntarPagamentoSessao(compromisso);
          } catch (e) {
            Alert.alert('Erro ao atualizar', mensagemDeErro(e));
          }
        },
      },
    ]
  );
}

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
      Alert.alert(
        'A sessão aconteceu?',
        `O horário de ${nomeExibicaoCompromisso(compromisso)} já passou. A sessão foi realizada?`,
        [
          {
            text: 'Não foi realizada',
            onPress: () => perguntarTipoNaoRealizada(compromisso, carregar),
          },
          {
            text: 'Sim, foi realizada',
            onPress: async () => {
              try {
                await updateAppointmentStatus(compromisso.id, 'realizado');
                await carregar();
                await perguntarPagamentoSessao(compromisso);
              } catch (e) {
                Alert.alert('Erro ao atualizar', mensagemDeErro(e));
              }
            },
          },
        ]
      );
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

  async function editarHorario() {
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
            onPress={() => {
              Alert.alert('Cancelar compromisso', 'Confirma o cancelamento?', [
                { text: 'Não' },
                { text: 'Sim', onPress: cancelarCompromisso },
              ]);
            }}
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
