import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import {
  getAppointmentById,
  updateAppointmentStatus,
  temTranscricaoParaData,
  getAvailabilitySlotByDayAndTime,
  deleteAvailabilitySlot,
  listarCompromissosFuturosDoHorario,
  cancelarCompromissosFuturosDoHorario,
  deleteAppointment,
  deleteAppointments,
  marcarHorarioLiberado,
  desmarcarHorarioLiberado,
  getPagamentoPorAppointment,
  deletarPagamentoDeAppointment,
  desvincularPagamentoDeAppointment,
  parsePreco,
  formatarMoeda,
  atualizarHorarioAppointment,
} from '../services/database';
import { horarioJaPassou, getEstadoCompromisso, ESTADO_LABEL } from '../services/compromissoStatus';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { infoTipoEvento, ehTipoGrupo } from '../services/tiposEvento';
import {
  nomeExibicaoCompromisso, perguntarPagamentoSessao, perguntarCheckin, perguntarTipoNaoRealizada,
} from '../services/checkinCompromisso';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import {
  mascararHorario, normalizarHorario, horarioValido, horarioParaMinutos, terminoPadrao,
} from '../services/horarios';

function mascararDataBR(texto) {
  const n = texto.replace(/\D/g, '').slice(0, 8);
  if (n.length > 4) return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  if (n.length > 2) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return n;
}

function dataBRValida(dataBR) {
  const iso = dataBRParaISO(dataBR);
  if (!iso) return false;
  const [ano, mes, dia] = iso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
}

export default function DetalheCompromissoScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { appointmentId } = route.params;

  useBloqueioAssinatura(navigation);

  const [compromisso, setCompromisso] = useState(null);
  const [buscou, setBuscou] = useState(false);
  const [temTranscricao, setTemTranscricao] = useState(false);
  const [agindo, setAgindo] = useState(false);
  // "Remarcar só esta sessão": mexe SÓ neste compromisso, sem tocar no
  // horário recorrente. É a metade que antes vivia escondida dentro do
  // "Editar informações do horário" como a opção "só nesta data" — e que
  // lá, além de confusa, jogava fora a data digitada.
  const [remarcando, setRemarcando] = useState(false);
  const [novaData, setNovaData] = useState('');
  const [novoInicio, setNovoInicio] = useState('');
  const [novoFim, setNovoFim] = useState('');
  const alertaMostradoRef = useRef(false);

  const carregar = useCallback(async () => {
    try {
      setCompromisso(await getAppointmentById(appointmentId));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      // Sem esta marca, `compromisso === null` significava ao mesmo tempo
      // "ainda buscando" e "não existe" — e a tela ficava em "Carregando..."
      // para sempre quando o compromisso tinha sido apagado (é o que
      // acontece ao editar o horário: o compromisso de origem some, esta
      // tela recarrega por id e não acha mais nada).
      setBuscou(true);
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
    temTranscricaoParaData(compromisso.patient_id, compromisso.date)
      .then(setTemTranscricao)
      .catch(() => {});
  }, [compromisso]);

  if (!compromisso) {
    return (
      <View style={{ flex: 1 }}>
        <CabecalhoTela titulo="Compromisso" onVoltar={() => navigation.goBack()} />
        <View style={[styles.container, styles.estadoVazio]}>
          {!buscou ? (
            <ActivityIndicator size="large" color="#497363" />
          ) : (
            <>
              <Text style={styles.estadoVazioTitulo}>Este compromisso não existe mais</Text>
              <Text style={styles.estadoVazioTexto}>
                Ele pode ter sido apagado, ou movido junto com a edição do
                horário. A agenda já está atualizada.
              </Text>
              <TouchableOpacity style={styles.btnEditarHorario} onPress={() => navigation.goBack()}>
                <Text style={styles.btnEditarHorarioTxt}>Voltar para a agenda</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
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

  // "Editar informações do horário" é a ÚNICA porta de entrada pra editar
  // qualquer coisa sobre este horário — tipo de evento, modalidade,
  // paciente, recorrência E hora, tudo na mesma tela (DisponibilidadeScreen).
  // Pré-preenchida a partir do horário recorrente por trás deste
  // compromisso, se houver um, ou a partir do próprio compromisso, se for
  // avulso (sem horário recorrente, ex: marcado via "horário liberado" —
  // nesse caso não existe slot pra pré-preencher, e sem mandar essas
  // informações a tela abriria em branco mesmo já tendo paciente/tipo/
  // modalidade definidos). `appointmentId` vai junto só pra que aquela tela
  // saiba voltar pra cá depois de salvar — a edição de lá é sempre do
  // horário (o molde). Mudar uma única sessão é `abrirRemarcacao`, acima.
  function abrirRemarcacao() {
    setNovaData(dataISOParaBR(compromisso.date));
    setNovoInicio(compromisso.start_time);
    setNovoFim(compromisso.end_time);
    setRemarcando(true);
  }

  async function confirmarRemarcacao() {
    if (!dataBRValida(novaData)) {
      Alert.alert('Data inválida', 'Informe a nova data no formato DD/MM/AAAA.');
      return;
    }
    const inicio = normalizarHorario(novoInicio);
    const fim = normalizarHorario(novoFim);
    if (!horarioValido(inicio) || !horarioValido(fim)) {
      Alert.alert('Horário inválido', 'Informe os horários no formato HH:MM.\n\nExemplo: 07:45 (dá pra digitar só "745").');
      return;
    }
    // A falta desta conferência no caminho antigo foi o que deixou passar
    // um compromisso salvo como "17:30 - 16:20".
    if (horarioParaMinutos(inicio) >= horarioParaMinutos(fim)) {
      Alert.alert('Intervalo inválido', 'O horário de término deve ser posterior ao horário de início.');
      return;
    }

    const dataOriginal = compromisso.date;
    const inicioOriginal = compromisso.start_time;
    const novaDataISO = dataBRParaISO(novaData);
    const saiuDoLugar = novaDataISO !== dataOriginal || inicio !== inicioOriginal;

    setAgindo(true);
    try {
      await atualizarHorarioAppointment(compromisso.id, {
        date: novaDataISO,
        startTime: inicio,
        endTime: fim,
      });

      if (saiuDoLugar) {
        // Mover o compromisso não bastava: o horário recorrente por trás
        // dele continua valendo naquela data, então a Agenda seguia
        // pintando o lugar antigo como ocupado — e, pior,
        // `ensureAppointmentsForDate` recriava ali um compromisso novo na
        // primeira vez que aquele dia fosse aberto. A sessão "voltava".
        //
        // `horarios_liberados` é o mesmo mecanismo de "apagar só este
        // horário": vale para UMA data, não mexe no horário recorrente, e
        // é o que faz o lugar antigo aparecer livre de verdade.
        await marcarHorarioLiberado(dataOriginal, inicioOriginal);
        // E o destino precisa do contrário: se aquele dia/hora estava
        // marcado como liberado (a pessoa já tinha apagado algo ali), a
        // liberação bloquearia justamente a sessão que acabou de chegar.
        await desmarcarHorarioLiberado(novaDataISO, inicio);
      }

      setRemarcando(false);
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao remarcar', mensagemDeErro(e));
    } finally {
      setAgindo(false);
    }
  }

  async function editarInformacoesDoHorario() {
    const [ano, mes, dia] = compromisso.date.split('-').map(Number);
    const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
    try {
      const slot = await getAvailabilitySlotByDayAndTime(dayOfWeek, compromisso.start_time);
      navigation.navigate('EditarHorario', {
        slotId: slot?.id || null,
        appointmentId: compromisso.id,
        date: compromisso.date,
        startTime: compromisso.start_time,
        endTime: compromisso.end_time,
        dayOfWeek,
        tipo,
        modality: compromisso.modality,
        titulo: compromisso.titulo || null,
        patientId: compromisso.patient_id || null,
        patientNome: compromisso.patient_nome || null,
        participantesIds: (compromisso.participantes || []).map((p) => p.id),
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
      // Pra grupo (tem `participantes`), isso pergunta presença + pagamento
      // de cada integrante — pra "outros" (sem participantes), não faz nada.
      await perguntarPagamentoSessao(compromisso);
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
    } finally {
      setAgindo(false);
    }
  }

  // Cancelar "só este" um compromisso que ainda não aconteceu (data/hora no
  // futuro) é sempre cancelamento de verdade — não tem como ter sido falta
  // de algo que ainda vai acontecer. Mas nada muda o status sozinho quando
  // o horário passa: "Cancelar Compromisso" também fica disponível pra um
  // compromisso já vencido que ninguém confirmou ainda (mesmo estado que
  // dispara o popup de check-in) — nesse caso precisa perguntar se foi
  // cancelado com antecedência ou se foi falta, porque isso decide se conta
  // como cobrança (falta cobra normalmente; cancelamento nunca cobra) —
  // reflete direto em Financeiro/Recebíveis/Fiscal pra quem é cobrado por
  // sessão (ver getSessoesCobrancaDoMes, que só considera 'realizado' e
  // 'nao_realizado' como cobráveis).
  function cancelarCompromisso() {
    if (horarioJaPassou(compromisso.date, compromisso.end_time)) {
      perguntarTipoNaoRealizada(compromisso, carregar);
      return;
    }
    efetivarCancelamentoDireto();
  }

  async function efetivarCancelamentoDireto() {
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

  function formatarValorPagamento(pagamento) {
    if (!pagamento?.valor) return '';
    return ` no valor de R$ ${Number(pagamento.valor).toFixed(2).replace('.', ',')}`;
  }

  // "Apagar" é diferente de "Cancelar": remove a linha de vez (não só muda
  // status), por isso fica disponível mesmo quando o compromisso já foi
  // realizado/cancelado (onde "Cancelar" some por não fazer mais sentido).
  // Sempre pergunta o escopo (só este/todos os recorrentes) e, se houver
  // pagamento por sessão vinculado, também pergunta se apaga ou preserva
  // esse registro financeiro — pra nunca sumir com uma cobrança já recebida
  // sem a pessoa escolher isso explicitamente.
  function perguntarExclusao() {
    const dataFormatada = compromisso.date.split('-').reverse().join('/');
    Alert.alert(
      'Apagar compromisso',
      'Apagar só este horário, ou este e todos os recorrentes futuros?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: `Só este (${dataFormatada})`, onPress: excluirApenasEste },
        { text: 'Este e todos os recorrentes', style: 'destructive', onPress: excluirComRecorrentes },
      ]
    );
  }

  async function excluirApenasEste() {
    setAgindo(true);
    let pagamento;
    try {
      pagamento = await getPagamentoPorAppointment(compromisso.id);
    } catch (e) {
      setAgindo(false);
      Alert.alert('Erro', mensagemDeErro(e));
      return;
    }
    setAgindo(false);

    if (pagamento) {
      Alert.alert(
        'Pagamento vinculado',
        `Esse horário tem um pagamento${formatarValorPagamento(pagamento)} registrado. Apagar o pagamento junto, ou manter o registro financeiro (desvinculado deste horário)?`,
        [
          { text: 'Voltar', style: 'cancel' },
          { text: 'Manter pagamento', onPress: () => efetivarExclusaoUnica({ temPagamento: true, apagarPagamento: false }) },
          { text: 'Apagar pagamento também', style: 'destructive', onPress: () => efetivarExclusaoUnica({ temPagamento: true, apagarPagamento: true }) },
        ]
      );
      return;
    }
    efetivarExclusaoUnica({ temPagamento: false });
  }

  async function efetivarExclusaoUnica({ temPagamento, apagarPagamento }) {
    setAgindo(true);
    try {
      if (temPagamento) {
        if (apagarPagamento) await deletarPagamentoDeAppointment(compromisso.id);
        else await desvincularPagamentoDeAppointment(compromisso.id);
      }
      await deleteAppointment(compromisso.id);
      // Sem isso, a Agenda recriava sozinha o mesmo compromisso (a partir
      // do horário recorrente) na próxima vez que a tela carregasse — o
      // ícone nunca saía da tela e não dava pra marcar outra coisa ali.
      await marcarHorarioLiberado(compromisso.date, compromisso.start_time);
      navigation.goBack();
    } catch (e) {
      setAgindo(false);
      Alert.alert('Erro ao apagar', mensagemDeErro(e));
    }
  }

  async function excluirComRecorrentes() {
    const [ano, mes, dia] = compromisso.date.split('-').map(Number);
    const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
    setAgindo(true);
    let slot, futuros, pagamento;
    try {
      [slot, futuros, pagamento] = await Promise.all([
        getAvailabilitySlotByDayAndTime(dayOfWeek, compromisso.start_time),
        listarCompromissosFuturosDoHorario({
          patientId: compromisso.patient_id,
          dayOfWeek,
          startTime: compromisso.start_time,
        }),
        getPagamentoPorAppointment(compromisso.id),
      ]);
    } catch (e) {
      setAgindo(false);
      Alert.alert('Erro', mensagemDeErro(e));
      return;
    }
    setAgindo(false);

    function prosseguir(apagarPagamento) {
      Alert.alert(
        'Confirmar exclusão',
        futuros.length > 0
          ? `Isso remove o horário recorrente da agenda e apaga mais ${futuros.length} compromisso${futuros.length === 1 ? '' : 's'} futuro${futuros.length === 1 ? '' : 's'} desse horário, além deste. Confirma?`
          : 'Isso remove o horário recorrente da agenda. Não há outros compromissos futuros desse horário. Confirma?',
        [
          { text: 'Voltar', style: 'cancel' },
          {
            text: 'Confirmar',
            style: 'destructive',
            onPress: async () => {
              setAgindo(true);
              try {
                if (pagamento) {
                  if (apagarPagamento) await deletarPagamentoDeAppointment(compromisso.id);
                  else await desvincularPagamentoDeAppointment(compromisso.id);
                }
                if (futuros.length > 0) await deleteAppointments(futuros.map((a) => a.id));
                await deleteAppointment(compromisso.id);
                if (slot?.id) await deleteAvailabilitySlot(slot.id);
                navigation.goBack();
              } catch (e) {
                setAgindo(false);
                Alert.alert('Erro ao apagar', mensagemDeErro(e));
              }
            },
          },
        ]
      );
    }

    if (pagamento) {
      Alert.alert(
        'Pagamento vinculado',
        `Esse horário tem um pagamento${formatarValorPagamento(pagamento)} registrado. Apagar o pagamento junto, ou manter o registro financeiro (desvinculado deste horário)?`,
        [
          { text: 'Voltar', style: 'cancel' },
          { text: 'Manter pagamento', onPress: () => prosseguir(false) },
          { text: 'Apagar pagamento também', style: 'destructive', onPress: () => prosseguir(true) },
        ]
      );
      return;
    }
    prosseguir(false);
  }

  return (
    <View style={{ flex: 1 }}>
      <CabecalhoTela titulo="Compromisso" onVoltar={() => navigation.goBack()} />
      {/* Área segura no pé: sem isso os botões ficam por baixo da barra de
          gestos do sistema. */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
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
Nenhum relato ou transcrição foi adicionado para esta sessão ainda.
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
      </View>

      {ehTipoGrupo(tipo) && (
        <View style={styles.card}>
          <Text style={styles.participantesTitulo}>Participantes</Text>
          {(compromisso.participantes || []).length === 0 ? (
            <Text style={styles.valor}>-</Text>
          ) : (
            <>
              {compromisso.participantes.map((p) => (
                <View key={p.id} style={styles.participanteLinha}>
                  <Text style={styles.participanteNome} numberOfLines={1}>{p.nome}</Text>
                  <Text style={styles.participanteStatus}>
                    {p.presente === true ? 'Presente' : p.presente === false ? 'Faltou' : '— sem confirmar'}
                    {/* Valor combinado pro grupo (migration 0051) — antes o
                        detalhe não dizia quanto cada integrante paga. */}
                    {p.precoSessao ? ` · ${formatarMoeda(parsePreco(p.precoSessao))}` : ''}
                    {p.tipoCobranca === 'por_sessao' && p.presente !== false
                      ? (p.pagamentoRecebido ? ' · Pago' : ' · Pendente')
                      : ''}
                  </Text>
                </View>
              ))}
              {/* Soma de todos os pagantes deste encontro — quem faltou
                  continua sendo cobrado (mesma regra da sessão individual),
                  só cancelamento não cobra. */}
              <View style={styles.participanteTotalLinha}>
                <Text style={styles.participanteTotalTxt}>
                  Total do encontro: {formatarMoeda(
                    compromisso.participantes.reduce((soma, p) => soma + parsePreco(p.precoSessao), 0)
                  )}
                </Text>
              </View>
            </>
          )}
          {compromisso.status !== 'agendado' && (
            <TouchableOpacity
              style={styles.btnConferirGrupo}
              onPress={async () => {
                setAgindo(true);
                try {
                  await perguntarPagamentoSessao(compromisso);
                  await carregar();
                } finally {
                  setAgindo(false);
                }
              }}
              disabled={agindo}
            >
              {agindo ? (
                <ActivityIndicator color="#497363" />
              ) : (
                <Text style={styles.btnConferirGrupoTxt}>Conferir presença e pagamento</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {podeAgir && (
        <TouchableOpacity style={styles.btnEditarHorario} onPress={abrirRemarcacao}>
          <Text style={styles.btnEditarHorarioTxt}>Remarcar só esta sessão</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.btnEditarHorario}
        onPress={editarInformacoesDoHorario}
        disabled={agindo}
      >
        <Text style={styles.btnEditarHorarioTxt}>Editar o horário e os próximos</Text>
      </TouchableOpacity>

      <Modal visible={remarcando} transparent animationType="fade" onRequestClose={() => setRemarcando(false)}>
        {/* Três campos numerados dentro de uma caixa centralizada: sem isto,
            no iOS o teclado sobe por cima dos botões Cancelar/Remarcar e não
            há como confirmar sem fechar o teclado primeiro. */}
        <KeyboardAvoidingView
          style={styles.modalFundo}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCaixa}>
            <Text style={styles.modalTitulo}>Remarcar só esta sessão</Text>
            <Text style={styles.modalSub}>
              Muda apenas este encontro. O horário nas próximas semanas continua como está.
            </Text>

            <Text style={styles.modalLabel}>Nova data</Text>
            <TextInput
              style={styles.modalInput}
              value={novaData}
              onChangeText={(t) => setNovaData(mascararDataBR(t))}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#A9A29A"
              keyboardType="number-pad"
              maxLength={10}
            />

            <View style={styles.modalLinhaHoras}>
              <View style={styles.modalMeia}>
                <Text style={styles.modalLabel}>Início</Text>
                <TextInput
                  style={styles.modalInput}
                  value={novoInicio}
                  onChangeText={(t) => {
                    const m = mascararHorario(t);
                    setNovoInicio(m);
                    const sugerido = terminoPadrao(m);
                    if (sugerido) setNovoFim(sugerido);
                  }}
                  onBlur={() => {
                    const n = normalizarHorario(novoInicio);
                    if (n) setNovoInicio(n);
                  }}
                  placeholder="HH:MM"
                  placeholderTextColor="#A9A29A"
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <View style={styles.modalMeia}>
                <Text style={styles.modalLabel}>Término</Text>
                <TextInput
                  style={styles.modalInput}
                  value={novoFim}
                  onChangeText={(t) => setNovoFim(mascararHorario(t))}
                  onBlur={() => {
                    const n = normalizarHorario(novoFim);
                    if (n) setNovoFim(n);
                  }}
                  placeholder="HH:MM"
                  placeholderTextColor="#A9A29A"
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
            </View>

            <View style={styles.modalBotoes}>
              <TouchableOpacity
                style={styles.modalBtnSecundario}
                onPress={() => setRemarcando(false)}
                disabled={agindo}
              >
                <Text style={styles.modalBtnSecundarioTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnPrincipal, agindo && { opacity: 0.7 }]}
                onPress={confirmarRemarcacao}
                disabled={agindo}
              >
                {agindo
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.modalBtnPrincipalTxt}>Remarcar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <TouchableOpacity
        style={[styles.btnApagar, agindo && { opacity: 0.7 }]}
        onPress={perguntarExclusao}
        disabled={agindo}
      >
        {agindo ? <ActivityIndicator color="#975451" /> : <Text style={styles.btnApagarTxt}>Apagar compromisso</Text>}
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
            {agindo ? <ActivityIndicator color="#975451" /> : <Text style={styles.btnCancelarTxt}>Cancelar Compromisso</Text>}
          </TouchableOpacity>
        </>
      )}
      </ScrollView>
    </View>
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
  container: { flex: 1, padding: 16, backgroundColor: '#FDFCFA' },
  tipoLabel: { fontSize: 12, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2, lineHeight: 17 },
  nome: { fontSize: 24, fontWeight: '500', marginBottom: 12 },
  estadoPill: {
    alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 6, marginBottom: 16,
  },
  estadoPillTxt: { fontSize: 13, fontWeight: '500', lineHeight: 19 },
  avisoBox: {
    backgroundColor: '#F1E4E3', borderRadius: 10, padding: 12, marginBottom: 16,
  },
  avisoTxt: { color: '#975451', fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: '#F7F5F0', borderRadius: 10, padding: 14, marginBottom: 20 },
  participantesTitulo: { fontSize: 13, fontWeight: '500', color: '#8C857B', marginBottom: 8, lineHeight: 19 },
  participanteLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 8 },
  participanteNome: { flex: 1, fontWeight: '600', color: '#302C28' },
  participanteStatus: { fontSize: 12.5, color: '#756E66', lineHeight: 18 },
  participanteTotalLinha: {
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EAE5DC',
  },
  participanteTotalTxt: { fontSize: 13, fontWeight: '500', color: '#497363', lineHeight: 19 },
  btnConferirGrupo: { marginTop: 10, paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EAE5DC' },
  btnConferirGrupoTxt: { color: '#497363', fontWeight: '500', fontSize: 13, lineHeight: 19 },
  btnEditarHorario: {
    padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#497363',
  },
  btnEditarHorarioTxt: { color: '#497363', fontWeight: '500' },
  estadoVazio: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  estadoVazioTitulo: { fontSize: 16, fontWeight: '600', color: '#302C28', lineHeight: 23, textAlign: 'center' },
  estadoVazioTexto: { fontSize: 13.5, color: '#756E66', lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  modalFundo: {
    flex: 1, backgroundColor: 'rgba(48,44,40,0.45)',
    justifyContent: 'center', paddingHorizontal: 22,
  },
  modalCaixa: { backgroundColor: '#FFFDF9', borderRadius: 14, padding: 20 },
  modalTitulo: { fontSize: 17, fontWeight: '600', color: '#302C28', lineHeight: 24 },
  modalSub: { fontSize: 13, color: '#756E66', lineHeight: 19, marginTop: 6, marginBottom: 14 },
  modalLabel: { fontSize: 12.5, color: '#8C857B', marginBottom: 5, lineHeight: 18 },
  modalInput: {
    borderWidth: 1, borderColor: '#E0DAD1', borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#302C28',
    backgroundColor: '#fff',
  },
  modalLinhaHoras: { flexDirection: 'row', gap: 12, marginTop: 12 },
  modalMeia: { flex: 1 },
  modalBotoes: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtnSecundario: {
    flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#D8D2C8',
  },
  modalBtnSecundarioTxt: { color: '#756E66', fontWeight: '500' },
  modalBtnPrincipal: {
    flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#44745B',
  },
  modalBtnPrincipalTxt: { color: '#fff', fontWeight: '500' },
  btnApagar: {
    backgroundColor: '#F1E4E3', padding: 14, borderRadius: 10, alignItems: 'center',
    marginBottom: 10, borderWidth: 1, borderColor: '#975451',
  },
  btnApagarTxt: { color: '#975451', fontWeight: '500' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  label: { color: '#8C857B' },
  valor: { fontWeight: '600' },
  btnIniciar: { backgroundColor: '#44745B', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  btnIniciarTxt: { color: '#fff', fontWeight: '500', fontSize: 16, lineHeight: 23 },
  btnCancelar: { padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#975451' },
  btnCancelarTxt: { color: '#975451', fontWeight: '500' },
});
