import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import {
  getAvailabilitySlots,
  getAppointmentsByDateRange,
  getAppointmentsByDate,
  getPatientById,
  parsePreco,
  ensureAppointmentsForDate,
  getOrCreateAppointmentForSlot,
  temTranscricaoParaData,
} from '../services/database';
import { formatarValorMoeda } from '../services/currency';
import { horarioJaPassou, getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';
import { mensagemDeErro } from '../services/erros';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { corTipoEvento, infoTipoEvento, ehTipoGrupo } from '../services/tiposEvento';

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SCREEN_WIDTH = Dimensions.get('window').width;
const COL_WIDTH_BASE = (SCREEN_WIDTH - 16) / 7;
const SLOT_HEIGHT_BASE = 34;

const COR_PRESENCIAL = '#A5D6A7'; // verde claro
const COR_ONLINE = '#1B5E20'; // verde escuro

function toISO(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function getInicioSemana(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diaSemana = d.getDay();
  d.setDate(d.getDate() - diaSemana);
  return d;
}

function getFimSemana(date) {
  const fim = new Date(date);
  fim.setDate(fim.getDate() + 6);
  return fim;
}

function compararHorarios(a, b) {
  return (a.start_time || '').localeCompare(b.start_time || '');
}

/** Nome a exibir no card/slot — paciente único (individual), lista de
 * participantes (em grupo) ou o título livre ("Outros"), item J.23. */
function nomeExibicaoEvento({ tipo, patientNome, participantes, titulo }) {
  if (tipo === 'outros') return titulo || 'Outros';
  if (ehTipoGrupo(tipo)) {
    const nomes = (participantes || []).map((p) => p.nome).filter(Boolean);
    return nomes.length > 0 ? nomes.join(', ') : 'Grupo';
  }
  return patientNome || 'Paciente';
}

function labelModalidadeTexto(modality) {
  if (modality === 'online') return '💻 Online';
  if (modality === 'presencial') return '🏠 Presencial';
  return '🏠💻 Ambos';
}

/**
 * Renderiza a barra inferior do slot (usado na visão semanal, compacta).
 */
function BarraModalidade({ modality }) {
  if (modality === 'online') {
    return (
      <View style={[styles.badge, { backgroundColor: COR_ONLINE }]}>
        <Text style={styles.badgeTxt}>ON</Text>
      </View>
    );
  }

  if (modality === 'presencial') {
    return (
      <View style={[styles.badge, { backgroundColor: COR_PRESENCIAL }]}>
        <Text style={styles.badgeTxt}>OFF</Text>
      </View>
    );
  }

  if (modality === 'ambos' || modality === 'hibrido') {
    return (
      <View style={styles.badgeSplitContainer}>
        <View style={[styles.badgeSplitMeio, { backgroundColor: COR_PRESENCIAL }]} />
        <View style={[styles.badgeSplitMeio, { backgroundColor: COR_ONLINE }]} />
      </View>
    );
  }

  return null;
}

export default function AgendaScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  // ⚠️ CORRIGIDO (item 7): agenda mensal removida — só 'semanal' e 'diario'
  const [modoView, setModoView] = useState('semanal');
  const [dataRef, setDataRef] = useState(new Date());
  const [availability, setAvailability] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [temTranscricaoMap, setTemTranscricaoMap] = useState({});
  const [carregando, setCarregando] = useState(true);
  // Esconde da visão semanal os dias sem nenhum horário configurado nem
  // compromisso avulso — pensado pra quem não atende todo dia (ex: sem
  // sábado/domingo) e não quer ver colunas vazias ocupando espaço.
  const [ocultarDiasVazios, setOcultarDiasVazios] = useState(false);

  const inicioSemana = useMemo(() => getInicioSemana(dataRef), [dataRef]);

  // Instante em que esta tela ganhou foco. Serve pra ignorar um toque que
  // "atravessa" da tela anterior: ao tocar numa linha de horário do widget
  // Agenda de hoje (Início), a Agenda é empurrada por cima e um toque ainda
  // em curso (ou um segundo toque rápido) aterrissa aqui, na mesma altura
  // da tela — que por coincidência é onde ficam as linhas de horário daqui.
  // O resultado era abrir o compromisso direto, sem a pessoa ter tocado
  // nele. Tocar no título do widget não fazia isso porque cai no cabeçalho,
  // que não tem nada tocável.
  const focoEmRef = React.useRef(0);
  const TOQUE_CARENCIA_MS = 350;

  useFocusEffect(
    useCallback(() => {
      focoEmRef.current = Date.now();
      carregarDadosAgenda();
    }, [modoView, dataRef, inicioSemana])
  );

  function toqueAtravessouDaTelaAnterior() {
    return Date.now() - focoEmRef.current < TOQUE_CARENCIA_MS;
  }

  async function carregarDadosAgenda() {
    setCarregando(true);
    try {
      const disponibilidades = await getAvailabilitySlots();
      setAvailability(disponibilidades || []);

      if (modoView === 'diario') {
        await ensureAppointmentsForDate(toISO(dataRef), dataRef.getDay());
        const agendamentosDia = await getAppointmentsByDate(toISO(dataRef));
        setAppointments(agendamentosDia || []);

        const dataISO = toISO(dataRef);
        const patientIdsUnicos = [...new Set(agendamentosDia.map((a) => a.patient_id).filter(Boolean))];
        const mapa = {};
        for (const patientId of patientIdsUnicos) {
          mapa[patientId] = await temTranscricaoParaData(patientId, dataISO);
        }
        setTemTranscricaoMap(mapa);
        return;
      }

      const fimSemana = getFimSemana(inicioSemana);
      const agendamentosSemana = await getAppointmentsByDateRange(
        toISO(inicioSemana),
        toISO(fimSemana)
      );
      setAppointments(agendamentosSemana || []);
    } catch (e) {
      Alert.alert('Erro ao carregar agenda', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }

  function mudarSemana(delta) {
    const novaData = new Date(dataRef);
    novaData.setDate(novaData.getDate() + delta * 7);
    setDataRef(novaData);
  }

  function mudarDia(delta) {
    const novaData = new Date(dataRef);
    novaData.setDate(novaData.getDate() + delta);
    setDataRef(novaData);
  }

  // ⚠️ NOVO (item 7): clicar no cabeçalho de um dia na semanal abre a
  // agenda diária automaticamente naquele dia.
  function abrirDiaEspecifico(data) {
    setDataRef(data);
    setModoView('diario');
  }

  // Deslize horizontal troca de dia (modo diário) ou de semana (modo
  // semanal) — mesma sensação de arraste ao vivo usada na Início.
  const { panHandlers, animatedStyle } = useSwipeHorizontal({
    onSwipeLeft: () => (modoView === 'diario' ? mudarDia(1) : mudarSemana(1)),
    onSwipeRight: () => (modoView === 'diario' ? mudarDia(-1) : mudarSemana(-1)),
  });

  // Zoom por pinça (2 dedos) na visão semanal: aumenta/diminui o tamanho
  // dos botões de horário pra facilitar a leitura. Só faz sentido na
  // semanal (a diária já usa cards grandes de largura total).
  const { escala: escalaSemanal, panHandlers: pinchPanHandlers, scaleAnim: pinchScaleAnim } = usePinchZoom({
    min: 0.6,
    max: 2.2,
  });
  const alturaSlotAtual = Math.round(SLOT_HEIGHT_BASE * escalaSemanal);
  // ⚠️ O teto da fonte da hora (11, não 13 como antes) é o valor máximo que
  // ainda cabe inteiro dentro da largura fixa da coluna (COL_WIDTH_BASE,
  // ~53px numa tela de 390px) sem cortar dígito — no zoom médio/alto a
  // fonte batia nesse teto de 13 mas a coluna não crescia junto, cortando a
  // hora no meio ("09:0" em vez de "09:00"). A altura do slot continua
  // crescendo bastante com o zoom (SLOT_HEIGHT_BASE * escala), então o
  // efeito de "mais espaço" continua nítido mesmo com a fonte um pouco
  // mais contida.
  const fontHorarioAtual = Math.max(7, Math.min(11, Math.round(8.5 * escalaSemanal)));
  const fontPacienteAtual = Math.max(6, Math.min(9.5, Math.round(7.5 * escalaSemanal)));

  function slotsDoDiaDaSemana(diaSemana) {
    return availability
      .filter((slot) => slot.day_of_week === diaSemana)
      .sort(compararHorarios);
  }

  function buscarCompromissoDoSlot(dataISO, slot) {
    return appointments.find((appointment) => {
      return (
        appointment.date === dataISO &&
        appointment.start_time === slot.start_time
      );
    });
  }

  function abrirEdicaoHorario({ slot, dataISO, appointment }) {
    navigation.navigate('EditarHorario', {
      slotId: slot?.id || null,
      appointmentId: appointment?.id || null,
      date: dataISO || (slot ? null : toISO(dataRef)),
      startTime: appointment?.start_time || slot?.start_time || null,
      endTime: appointment?.end_time || slot?.end_time || null,
      dayOfWeek: slot?.day_of_week ?? new Date(dataISO).getDay(),
    });
  }

  // Usado nas duas visões (semanal e diária): horário ocupado sempre abre o
  // detalhe do compromisso primeiro (nunca direto a edição do horário
  // recorrente); livre continua abrindo a tela de disponibilidade. Na
  // semanal, o compromisso daquela data específica pode ainda não existir
  // (só a diária pré-cria todos ao carregar) — nesse caso é criado na hora.
  async function abrirCompromissoOuEdicao({ slot, dataISO }) {
    // Carência logo após a tela abrir — ver focoEmRef acima.
    if (toqueAtravessouDaTelaAnterior()) return;
    const compromisso = buscarCompromissoDoSlot(dataISO, slot);
    if (compromisso) {
      navigation.navigate('DetalheCompromisso', { appointmentId: compromisso.id });
      return;
    }
    if (slot.patient_id || slot.tipo === 'outros' || ehTipoGrupo(slot.tipo)) {
      try {
        const criado = await getOrCreateAppointmentForSlot(slot, dataISO);
        if (criado) {
          navigation.navigate('DetalheCompromisso', { appointmentId: criado.id });
          return;
        }
      } catch (e) {
        Alert.alert('Erro ao abrir compromisso', mensagemDeErro(e));
        return;
      }
    }
    abrirEdicaoHorario({ slot, dataISO, appointment: compromisso });
  }

  async function abrirPaciente(appointment) {
    const patientId = appointment.patient_id;

    if (!patientId) {
      Alert.alert(
        'Paciente não encontrado',
        'Este agendamento não possui o campo patient_id vinculado.'
      );
      return;
    }

    let paciente;
    try {
      paciente = await getPatientById(patientId);
    } catch (e) {
      Alert.alert('Erro ao carregar paciente', mensagemDeErro(e));
      return;
    }

    if (!paciente) {
      Alert.alert(
        'Paciente não encontrado',
        'Não foi possível localizar a ficha deste paciente.'
      );
      return;
    }

    navigation.navigate('PatientDetail', {
      paciente,
      appointmentId: appointment.id,
    });
  }

  /**
   * Verde = livre | Vermelho = ocupado (com analisante vinculado).
   * A barra inferior indica a modalidade (presencial/online/ambos).
   * Usado na visão SEMANAL (compacta).
   */
  function renderSlotBotao({ slot, dataISO, key }) {
    const compromisso = buscarCompromissoDoSlot(dataISO, slot);
    const tipo = compromisso?.tipo || slot.tipo || 'sessao_individual';
    const ocupado = !!compromisso || !!slot.patient_id || tipo === 'outros' || ehTipoGrupo(tipo);
    const modality = compromisso?.modality || slot.modality;
    const horario = slot.start_time;

    const nomePaciente = nomeExibicaoEvento({
      tipo,
      patientNome: compromisso?.patient_nome || compromisso?.patient_name || slot.patient_name,
      participantes: compromisso?.participantes || slot.participantes,
      titulo: compromisso?.titulo || slot.titulo,
    });

    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.slotBtn,
          { height: alturaSlotAtual, backgroundColor: ocupado ? corTipoEvento(tipo) : '#43A047' },
        ]}
        onPress={() => abrirCompromissoOuEdicao({ slot, dataISO })}
        onLongPress={() => {
          if (compromisso) abrirPaciente(compromisso);
        }}
        activeOpacity={0.75}
      >
        <Text style={[styles.slotHorarioTxt, { fontSize: fontHorarioAtual }]} numberOfLines={1}>
          {horario}
        </Text>

        {ocupado && (
          <Text style={[styles.slotPacienteTxt, { fontSize: fontPacienteAtual }]} numberOfLines={1}>
            {nomePaciente}
          </Text>
        )}

        <BarraModalidade modality={modality} />
      </TouchableOpacity>
    );
  }

  /**
   * ⚠️ NOVO (item 8): card limpo e maior para a visão DIÁRIA, aproveitando
   * o espaço disponível para mostrar mais informações do analisante
   * (telefone, modalidade, preço) quando o horário estiver ocupado.
   */
  function renderSlotDiarioCard({ slot, dataISO, key }) {
    const compromisso = buscarCompromissoDoSlot(dataISO, slot);
    const tipo = compromisso?.tipo || slot.tipo || 'sessao_individual';
    const ocupado = !!compromisso || !!slot.patient_id || tipo === 'outros' || ehTipoGrupo(tipo);
    const modality = compromisso?.modality || slot.modality;
    const eventoIndividual = tipo === 'sessao_individual' || tipo === 'supervisao_individual';

    const nomePaciente = nomeExibicaoEvento({
      tipo,
      patientNome: compromisso?.patient_nome || compromisso?.patient_name || slot.patient_name,
      participantes: compromisso?.participantes || slot.participantes,
      titulo: compromisso?.titulo || slot.titulo,
    });

    const telefone = eventoIndividual ? (compromisso?.patient_telefone || slot.patient_telefone || null) : null;
    const precoRaw = eventoIndividual ? (compromisso?.patient_preco || slot.patient_preco || null) : null;
    const precoMoeda = compromisso?.patient_preco_moeda || slot.patient_preco_moeda || 'BRL';
    const preco = precoRaw ? formatarValorMoeda(parsePreco(precoRaw), precoMoeda) : null;

    let estadoInfo = null;
    if (compromisso) {
      const temTranscricao = eventoIndividual ? !!temTranscricaoMap[compromisso.patient_id] : true;
      const horarioPassou = horarioJaPassou(dataISO, slot.end_time);
      const estado = getEstadoCompromisso({
        status: compromisso.status,
        temTranscricao,
        horarioPassou,
      });
      estadoInfo = ESTADO_LABEL[estado];
    }

    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.diaCard,
          { borderLeftColor: ocupado ? corTipoEvento(tipo) : '#43A047' },
        ]}
        onPress={() => abrirCompromissoOuEdicao({ slot, dataISO })}
        onLongPress={() => {
          if (compromisso) abrirPaciente(compromisso);
        }}
        activeOpacity={0.75}
      >
        <View style={styles.diaCardTopo}>
          <Text style={styles.diaCardHorario}>
            {slot.start_time}
            {slot.end_time ? ` – ${slot.end_time}` : ''}
          </Text>
          <View
            style={[
              styles.diaCardStatus,
              { backgroundColor: ocupado ? '#FDECEA' : '#E8F5E9' },
            ]}
          >
            <Text
              style={[
                styles.diaCardStatusTxt,
                { color: ocupado ? '#C62828' : '#2E7D32' },
              ]}
            >
              {ocupado ? 'Ocupado' : 'Livre'}
            </Text>
          </View>
        </View>

        {ocupado ? (
          <View style={styles.diaCardCorpo}>
            <Text style={[styles.diaCardTipo, { color: corTipoEvento(tipo) }]}>
              {infoTipoEvento(tipo).labelCurto}
            </Text>
            <Text style={styles.diaCardNome} numberOfLines={1}>
              {nomePaciente || 'Analisante'}
            </Text>
            <View style={styles.diaCardInfoRow}>
              {telefone ? (
                <Text style={styles.diaCardInfoItem}>📞 {telefone}</Text>
              ) : null}
              {modality ? (
                <Text style={styles.diaCardInfoItem}>
                  {labelModalidadeTexto(modality)}
                </Text>
              ) : null}
              {preco ? (
                <Text style={styles.diaCardInfoItem}>💰 {preco}</Text>
              ) : null}
            </View>
            {estadoInfo && (
              <Text style={[styles.diaCardEstado, { color: estadoInfo.cor }]}>
                ● {estadoInfo.texto}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.diaCardLivreTxt}>
            Horário disponível
            {modality ? ` · ${labelModalidadeTexto(modality)}` : ''}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  function renderAgendamentosSemSlot(dataISO, slots, renderFn = renderSlotBotao) {
    const agendamentosDia = appointments.filter((a) => a.date === dataISO);

    const semSlot = agendamentosDia.filter((appointment) => {
      return !slots.some(
        (slot) => slot.start_time === appointment.start_time
      );
    });

    return semSlot
      .sort(compararHorarios)
      .map((appointment) =>
        renderFn({
          slot: {
            id: `virtual-${appointment.id}`,
            start_time: appointment.start_time,
            end_time: appointment.end_time,
            modality: appointment.modality,
            tipo: appointment.tipo,
            titulo: appointment.titulo,
            participantes: appointment.participantes,
            day_of_week: new Date(dataISO).getDay(),
          },
          dataISO,
          key: `virtual-${dataISO}-${appointment.id}`,
        })
      );
  }

  function renderColunaDia(data) {
    const dataISO = toISO(data);
    const diaSemana = data.getDay();
    const slots = slotsDoDiaDaSemana(diaSemana);

    return (
      <View key={`day-${dataISO}`} style={[styles.colunaDia, { width: COL_WIDTH_BASE }]}>
        {/* ⚠️ NOVO (item 7): tocar no cabeçalho do dia abre a agenda diária */}
        <TouchableOpacity
          style={styles.diaHeader}
          onPress={() => abrirDiaEspecifico(data)}
          activeOpacity={0.6}
        >
          <Text style={styles.diaHeaderSemana}>{DIAS_LABEL[diaSemana]}</Text>
          <Text style={styles.diaHeaderData}>
            {String(data.getDate()).padStart(2, '0')}/
            {String(data.getMonth() + 1).padStart(2, '0')}
          </Text>
        </TouchableOpacity>

        <ScrollView
          style={styles.listaSlots}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {slots.length === 0 && <Text style={styles.semHorarios}>—</Text>}

          {slots.map((slot) =>
            renderSlotBotao({
              slot,
              dataISO,
              key: `availability-${dataISO}-${slot.id}`,
            })
          )}

          {renderAgendamentosSemSlot(dataISO, slots)}
        </ScrollView>
      </View>
    );
  }

  function diaTemAlgumHorario(data) {
    const dataISO = toISO(data);
    const temSlot = slotsDoDiaDaSemana(data.getDay()).length > 0;
    const temCompromissoAvulso = appointments.some((a) => a.date === dataISO);
    return temSlot || temCompromissoAvulso;
  }

  function renderSemanal() {
    const todosOsDias = Array.from({ length: 7 }, (_, index) => {
      const data = new Date(inicioSemana);
      data.setDate(data.getDate() + index);
      return data;
    });

    const dias = ocultarDiasVazios ? todosOsDias.filter(diaTemAlgumHorario) : todosOsDias;

    if (dias.length === 0) {
      return (
        <View style={styles.semanaVaziaBox}>
          <Ionicons name="calendar-outline" size={32} color="#A5A19A" />
          <Text style={styles.semanaVaziaTxt}>Nenhum horário nessa semana.</Text>
        </View>
      );
    }

    return <View style={styles.semanaContainer}>{dias.map(renderColunaDia)}</View>;
  }

  function renderDiario() {
    const dataISO = toISO(dataRef);
    const diaSemana = dataRef.getDay();
    const slots = slotsDoDiaDaSemana(diaSemana);
    const semNadaHoje =
      slots.length === 0 && appointments.filter((a) => a.date === dataISO).length === 0;

    return (
      <View style={styles.diarioContainer}>
        <View style={styles.navDia}>
          <TouchableOpacity onPress={() => mudarDia(-1)} style={styles.navSetaBtn}>
            <Text style={styles.navSeta}>‹</Text>
          </TouchableOpacity>

          <Text style={styles.navTexto}>
            {dataRef.toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
            })}
          </Text>

          <TouchableOpacity onPress={() => mudarDia(1)} style={styles.navSetaBtn}>
            <Text style={styles.navSeta}>›</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.diarioLista, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {semNadaHoje && (
            <Text style={styles.semHorariosDia}>
              Não há disponibilidades cadastradas para este dia.
            </Text>
          )}

          {slots.map((slot) =>
            renderSlotDiarioCard({
              slot,
              dataISO,
              key: `availability-${dataISO}-${slot.id}`,
            })
          )}

          {renderAgendamentosSemSlot(dataISO, slots, renderSlotDiarioCard)}
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.viewBtn, modoView === 'diario' && styles.viewBtnAtivo]}
          onPress={() => setModoView('diario')}
        >
          <Text style={modoView === 'diario' ? styles.viewBtnTxtAtivo : styles.viewBtnTxt}>
            Diário
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.viewBtn, modoView === 'semanal' && styles.viewBtnAtivo]}
          onPress={() => setModoView('semanal')}
        >
          <Text style={modoView === 'semanal' ? styles.viewBtnTxtAtivo : styles.viewBtnTxt}>
            Semanal
          </Text>
        </TouchableOpacity>
      </View>

      {modoView === 'semanal' && (
        <View style={styles.navSemana}>
          <TouchableOpacity onPress={() => mudarSemana(-1)}>
            <Text style={styles.navSeta}>‹</Text>
          </TouchableOpacity>

          <Text style={styles.navTexto}>
            Semana de{' '}
            {inicioSemana.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
            })}
            {Math.abs(escalaSemanal - 1) > 0.02 ? `  ·  zoom ${Math.round(escalaSemanal * 100)}%` : ''}
          </Text>

          <View style={styles.navSemanaDireita}>
            <TouchableOpacity onPress={() => mudarSemana(1)}>
              <Text style={styles.navSeta}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setOcultarDiasVazios((v) => !v)}
              style={styles.ocultarVaziosBtn}
            >
              <Ionicons
                name={ocultarDiasVazios ? 'eye-off' : 'eye-off-outline'}
                size={16}
                color={ocultarDiasVazios ? '#3D5A80' : '#8A8578'}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.btnNovoHorario}
        onPress={() =>
          navigation.navigate('EditarHorario', {
            date: toISO(dataRef),
            dayOfWeek: dataRef.getDay(),
          })
        }
      >
        <Text style={styles.btnNovoHorarioTxt}>+ Novo Horário</Text>
      </TouchableOpacity>

      <Animated.View style={[{ flex: 1 }, animatedStyle]} {...panHandlers}>
        {carregando ? (
          <View style={styles.carregandoWrap}>
            <ActivityIndicator size="large" color="#1976D2" />
          </View>
        ) : (
          <>
            {modoView === 'semanal' && (
              <View style={{ flex: 1 }} {...pinchPanHandlers}>
                <Animated.View style={{ flex: 1, transform: [{ scaleY: pinchScaleAnim }] }}>
                  {renderSemanal()}
                </Animated.View>
              </View>
            )}
            {modoView === 'diario' && renderDiario()}
          </>
        )}
      </Animated.View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  viewBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#EEEEEE' },
  viewBtnAtivo: { backgroundColor: '#1976D2' },
  viewBtnTxt: { color: '#333333', fontSize: 13 },
  viewBtnTxtAtivo: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  btnNovoHorario: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#1976D2',
    borderRadius: 10,
    alignItems: 'center',
  },
  btnNovoHorarioTxt: { color: '#FFFFFF', fontWeight: 'bold' },
  navSemana: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 6,
  },
  navDia: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  navSetaBtn: { padding: 8 },
  navSeta: { fontSize: 30, color: '#1976D2', paddingHorizontal: 12 },
  navTexto: { fontWeight: '600', color: '#333333', textTransform: 'capitalize' },
  navSemanaDireita: { flexDirection: 'row', alignItems: 'center' },
  ocultarVaziosBtn: { padding: 8, marginLeft: 2 },
  semanaContainer: { flex: 1, flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 8 },
  semanaVaziaBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 40 },
  semanaVaziaTxt: { fontSize: 14, color: '#A5A19A' },
  colunaDia: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E4E8ED',
    marginHorizontal: 1,
  },
  diaHeader: {
    alignItems: 'center',
    paddingVertical: 6,
    backgroundColor: '#EAF2FB',
    borderBottomWidth: 1,
    borderBottomColor: '#D7E4F3',
  },
  diaHeaderSemana: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  diaHeaderData: { fontSize: 9, color: '#555555' },
  listaSlots: { padding: 3 },
  slotBtn: {
    height: SLOT_HEIGHT_BASE,
    borderRadius: 5,
    marginBottom: 3,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  slotHorarioTxt: { fontSize: 9, fontWeight: 'bold', color: '#FFFFFF' },
  slotPacienteTxt: { fontSize: 8, color: '#FFFFFF', maxWidth: '95%' },
  badge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 1,
    alignItems: 'center',
  },
  badgeTxt: { fontSize: 7, fontWeight: 'bold', color: '#FFFFFF' },
  badgeSplitContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    flexDirection: 'row',
  },
  badgeSplitMeio: { flex: 1 },
  semHorarios: { fontSize: 10, color: '#AAAAAA', textAlign: 'center', marginTop: 10 },
  carregandoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Diário (item 8: visual clean, mais espaço para informação) ──
  diarioContainer: { flex: 1 },
  diarioLista: { padding: 16, paddingTop: 4, gap: 12 },
  semHorariosDia: { textAlign: 'center', color: '#777777', marginTop: 35 },

  diaCard: {
    backgroundColor: '#FAFBFC',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 5,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  diaCardTopo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  diaCardHorario: { fontSize: 18, fontWeight: '700', color: '#1A1A2E' },
  diaCardStatus: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  diaCardStatusTxt: { fontSize: 12, fontWeight: '700' },
  diaCardCorpo: { gap: 6 },
  diaCardTipo: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  diaCardNome: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  diaCardInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  diaCardInfoItem: { fontSize: 13, color: '#666666' },
  diaCardEstado: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  diaCardLivreTxt: { fontSize: 13, color: '#888888', fontStyle: 'italic' },
});