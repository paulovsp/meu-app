import React, { useCallback, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getAvailabilitySlots,
  verificarConflitoSlot,
  aplicarSlot,
  deleteAvailabilitySlot,
  getPatients,
  addPatient,
  cancelarCompromissosFuturosDoHorario,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { TIPOS_EVENTO, infoTipoEvento, corTipoEvento, ehTipoGrupo, tipoTemPacienteUnico } from '../services/tiposEvento';

const DIAS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
];

// Máscara automática: usuária digita só números, o "07:10" (com o zero à
// esquerda) sai sozinho — evita o erro comum de digitar "7:10" sem o zero.
function formatarHorario(texto, setter) {
  const numeros = texto.replace(/\D/g, '').slice(0, 4);
  const formatado = numeros.length > 2 ? `${numeros.slice(0, 2)}:${numeros.slice(2)}` : numeros;
  setter(formatado);
}

function horarioValido(horario) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(horario);
}

function horarioParaMinutos(horario) {
  const [horas, minutos] = horario.split(':').map(Number);
  return horas * 60 + minutos;
}

function obterDiaLabel(dayOfWeek) {
  const dia = DIAS.find((item) => item.value === dayOfWeek);
  return dia?.label || 'Dia não definido';
}

function corDaModalidade(modality) {
  if (modality === 'online') return '#C8E6C9';
  if (modality === 'presencial') return '#A5D6A7';

  return '#FFE0B2';
}

function modalidadeLabel(modality) {
  if (modality === 'online') return '💻 Online';
  if (modality === 'presencial') return '🏠 Presencial';

  return '🏠 💻 Ambos';
}

export default function DisponibilidadeScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  useBloqueioAssinatura(navigation);

  const [slots, setSlots] = useState([]);
  const [pacientes, setPacientes] = useState([]);

  const [diaSemana, setDiaSemana] = useState(1);
  const [horarioInicio, setHorarioInicio] = useState('');
  const [horarioFim, setHorarioFim] = useState('');
  const [modalidade, setModalidade] = useState('ambos');
  const [slotEditandoId, setSlotEditandoId] = useState(null);
  const [tipoEvento, setTipoEvento] = useState('sessao_individual');
  const [titulo, setTitulo] = useState('');
  const [participantesIds, setParticipantesIds] = useState([]);

  const [analisanteId, setAnalisanteId] = useState(null);
  const [analisanteNome, setAnalisanteNome] = useState('');
  const [mostrarNovoAnalisante, setMostrarNovoAnalisante] = useState(false);
  const [novoAnalisanteNome, setNovoAnalisanteNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluindoId, setExcluindoId] = useState(null);

  /**
   * Atualiza a tela sempre que ela ganha foco, e trata os parâmetros
   * recebidos via navegação (ex: clique em um horário na Agenda).
   */
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const dadosAtualizados = await carregarSlots();
          await carregarPacientes();
          aplicarParametrosDeNavegacao(dadosAtualizados);
        } catch (e) {
          Alert.alert('Erro ao carregar', mensagemDeErro(e));
        }
      })();
    }, [route.params])
  );

  async function carregarSlots() {
    const dados = (await getAvailabilitySlots()) || [];

    const ordenados = [...dados].sort((a, b) => {
      if (a.day_of_week !== b.day_of_week) {
        return a.day_of_week - b.day_of_week;
      }

      return a.start_time.localeCompare(b.start_time);
    });

    setSlots(ordenados);
    return ordenados;
  }

  async function carregarPacientes() {
    const dados = (await getPatients?.()) || [];
    setPacientes(dados);
  }

  /**
   * Se a tela recebeu um `slotId` (clique num horário existente na agenda),
   * carrega esse horário específico no formulário para edição.
   * Se recebeu apenas `dayOfWeek`/`startTime`/`endTime` (novo horário),
   * pré-preenche o formulário limpo com esses valores.
   */
  function aplicarParametrosDeNavegacao(slotsAtuais) {
    const params = route.params || {};

    if (params.slotId) {
      const slotClicado = slotsAtuais.find((s) => s.id === params.slotId);

      if (slotClicado) {
        editarSlot(slotClicado);
      }
      return;
    }

    if (params.dayOfWeek !== undefined) {
      limparFormulario();
      setDiaSemana(params.dayOfWeek);

      if (params.startTime) setHorarioInicio(params.startTime);
      if (params.endTime) setHorarioFim(params.endTime);
    }
  }

  function limparFormulario() {
    setSlotEditandoId(null);
    setDiaSemana(1);
    setHorarioInicio('');
    setHorarioFim('');
    setModalidade('ambos');
    setTipoEvento('sessao_individual');
    setTitulo('');
    setParticipantesIds([]);
    setAnalisanteId(null);
    setAnalisanteNome('');
    setMostrarNovoAnalisante(false);
    setNovoAnalisanteNome('');
  }

  function alternarParticipante(patientId) {
    setParticipantesIds((atual) =>
      atual.includes(patientId) ? atual.filter((id) => id !== patientId) : [...atual, patientId]
    );
  }

  function selecionarAnalisante(paciente) {
    setAnalisanteId(paciente.id);
    setAnalisanteNome(paciente.name || paciente.nome);
    setMostrarNovoAnalisante(false);
  }

  function limparAnalisante() {
    setAnalisanteId(null);
    setAnalisanteNome('');
    setMostrarNovoAnalisante(false);
    setNovoAnalisanteNome('');
  }

  async function confirmarNovoAnalisante() {
    const nome = novoAnalisanteNome.trim();

    if (!nome) {
      Alert.alert('Nome obrigatório', 'Informe o nome do novo analisante.');
      return;
    }

    try {
      const criado = await addPatient?.(nome);
      const novoId = criado?.id || null;

      setAnalisanteId(novoId);
      setAnalisanteNome(nome);
      setMostrarNovoAnalisante(false);
      setNovoAnalisanteNome('');
      await carregarPacientes();
    } catch (e) {
      Alert.alert('Erro ao adicionar', mensagemDeErro(e));
    }
  }

  /**
   * ⚠️ CORRIGIDO (item 6): agora em duas etapas.
   * 1) verificarConflitoSlot só CONFERE e diz o que encontrou — não altera nada.
   * 2) Se houver horário OCUPADO compatível sobreposto → bloqueia com aviso.
   * 3) Se houver horário(s) LIVRE(s) compatível(is) sobrepostos → mostra
   *    exatamente quais (horário + modalidade) e pede confirmação antes de
   *    apagar e salvar. Modalidades incompatíveis (presencial x online)
   *    nunca entram nessa lista — coexistem sem alteração.
   */
  async function salvarSlot() {
    const inicio = horarioInicio.trim();
    const fim = horarioFim.trim();

    if (!horarioValido(inicio) || !horarioValido(fim)) {
      Alert.alert(
        'Horário inválido',
        'Informe os horários no formato HH:MM.\n\nExemplo: 07:45'
      );
      return;
    }

    if (horarioParaMinutos(inicio) >= horarioParaMinutos(fim)) {
      Alert.alert(
        'Intervalo inválido',
        'O horário de término deve ser posterior ao horário de início.'
      );
      return;
    }

    if (ehTipoGrupo(tipoEvento) && participantesIds.length === 0) {
      Alert.alert('Participantes obrigatórios', 'Selecione ao menos um analisante pro evento em grupo.');
      return;
    }
    if (tipoEvento === 'outros' && !titulo.trim()) {
      Alert.alert('Título obrigatório', 'Dê um título pro evento.');
      return;
    }

    setSalvando(true);
    let ocupado, livres, modalidadeNormalizada;
    try {
      ({ ocupado, livres, modalidadeNormalizada } = await verificarConflitoSlot({
        id: slotEditandoId,
        day_of_week: diaSemana,
        start_time: inicio,
        end_time: fim,
        modality: modalidade,
      }));
    } catch (e) {
      setSalvando(false);
      Alert.alert('Erro ao verificar conflito', mensagemDeErro(e));
      return;
    }

    if (ocupado) {
      setSalvando(false);
      Alert.alert(
        'Conflito de horário',
        `Já existe um horário ocupado por ${ocupado.patient_name || 'outro analisante'} das ${ocupado.start_time} às ${ocupado.end_time} (${modalidadeLabel(ocupado.modality)}), com modalidade compatível com a que você escolheu (${modalidadeLabel(modalidadeNormalizada)}).`
      );
      return;
    }

    async function efetivarSalvamento() {
      try {
        await aplicarSlot({
          id: slotEditandoId,
          day_of_week: diaSemana,
          start_time: inicio,
          end_time: fim,
          modality: modalidadeNormalizada,
          patient_id: tipoTemPacienteUnico(tipoEvento) ? analisanteId : null,
          livresParaRemover: livres,
          tipo: tipoEvento,
          titulo: tipoEvento === 'outros' ? titulo.trim() : null,
          participantes: ehTipoGrupo(tipoEvento) ? participantesIds : [],
        });
        await carregarSlots();
        limparFormulario();
      } catch (e) {
        Alert.alert('Erro ao salvar', mensagemDeErro(e));
      } finally {
        setSalvando(false);
      }
    }

    if (livres.length > 0) {
      const listaTexto = livres
        .map((s) => `• ${s.start_time}–${s.end_time} (${modalidadeLabel(s.modality)})`)
        .join('\n');

      Alert.alert(
        'Substituir horário(s) livre(s)?',
        `Este novo horário (${modalidadeLabel(modalidadeNormalizada)}) coincide com ${livres.length === 1 ? 'este horário livre' : 'estes horários livres'}, com modalidade compatível:\n\n${listaTexto}\n\nEle${livres.length === 1 ? '' : 's'} será${livres.length === 1 ? '' : 'ão'} removido${livres.length === 1 ? '' : 's'} e substituído${livres.length === 1 ? '' : 's'} por este. Deseja continuar?`,
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => setSalvando(false) },
          { text: 'Confirmar', onPress: efetivarSalvamento },
        ]
      );
      return;
    }

    // Sem ocupados nem livres sobrepostos compatíveis: salva direto
    efetivarSalvamento();
  }

  function editarSlot(slot) {
    setSlotEditandoId(slot.id);
    setDiaSemana(slot.day_of_week);
    setHorarioInicio(slot.start_time);
    setHorarioFim(slot.end_time);
    setModalidade(slot.modality);
    setTipoEvento(slot.tipo || 'sessao_individual');
    setTitulo(slot.titulo || '');
    setParticipantesIds((slot.participantes || []).map((p) => p.id));
    setAnalisanteId(slot.patient_id || null);
    setAnalisanteNome(slot.patient_name || '');
    setMostrarNovoAnalisante(false);
    setNovoAnalisanteNome('');
  }

  function confirmarExclusao(slot) {
    Alert.alert(
      'Excluir disponibilidade?',
      `Deseja remover o horário de ${obterDiaLabel(
        slot.day_of_week
      )}, das ${slot.start_time} às ${slot.end_time}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setExcluindoId(slot.id);
            try {
              await deleteAvailabilitySlot(slot.id);
              // Item 3 (leva pós-v13): excluir o horário recorrente aqui
              // nunca cancelava compromissos já materializados em
              // `appointments` — eles ficavam "fantasmas", ainda aparecendo
              // como agendados na Agenda e no widget da Início mesmo depois
              // de excluídos daqui. Mesma função de cascata do item 4 (v13).
              if (slot.patient_id) {
                await cancelarCompromissosFuturosDoHorario({
                  patientId: slot.patient_id,
                  dayOfWeek: slot.day_of_week,
                  startTime: slot.start_time,
                });
              }
              await carregarSlots();

              if (slot.id === slotEditandoId) {
                limparFormulario();
              }
            } catch (e) {
              Alert.alert('Erro ao excluir', mensagemDeErro(e));
            } finally {
              setExcluindoId(null);
            }
          },
        },
      ]
    );
  }

  // ⚠️ item 5: excluir o horário que está sendo editado no momento, sem
  // precisar rolar até encontrá-lo na lista de baixo.
  function excluirSlotEmEdicao() {
    if (!slotEditandoId) return;

    Alert.alert(
      'Excluir horário?',
      `Deseja remover o horário de ${obterDiaLabel(diaSemana)}, das ${horarioInicio} às ${horarioFim}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setExcluindoId(slotEditandoId);
            try {
              await deleteAvailabilitySlot(slotEditandoId);
              // Mesma cascata de confirmarExclusao — ver comentário lá.
              if (analisanteId) {
                await cancelarCompromissosFuturosDoHorario({
                  patientId: analisanteId,
                  dayOfWeek: diaSemana,
                  startTime: horarioInicio,
                });
              }
              await carregarSlots();
              limparFormulario();
            } catch (e) {
              Alert.alert('Erro ao excluir', mensagemDeErro(e));
            } finally {
              setExcluindoId(null);
            }
          },
        },
      ]
    );
  }

  function salvarEVoltar() {
    navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>
          Crie horários exatos, como 07:45 até 08:35 — digite só os números
          (4 dígitos), o formato com dois-pontos e o zero à esquerda é
          preenchido automaticamente. Os horários poderão aparecer como
          livres (verde) ou ocupados (vermelho) na agenda, bastando vincular
          uma Nova sessão a um analisante.
        </Text>

        <View style={styles.formCard}>
          <Text style={styles.formTitulo}>
            {slotEditandoId ? 'Editar disponibilidade' : 'Novo horário disponível'}
          </Text>

          <Text style={styles.label}>Dia da semana</Text>

          <View style={styles.diasContainer}>
            {DIAS.map((dia) => (
              <TouchableOpacity
                key={`day-${dia.value}`}
                style={[
                  styles.diaBtn,
                  diaSemana === dia.value && styles.diaBtnAtivo,
                ]}
                onPress={() => setDiaSemana(dia.value)}
              >
                <Text
                  style={
                    diaSemana === dia.value
                      ? styles.diaBtnTxtAtivo
                      : styles.diaBtnTxt
                  }
                >
                  {dia.label.slice(0, 3)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.horariosRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Início</Text>
              <TextInput
                value={horarioInicio}
                onChangeText={(texto) => formatarHorario(texto, setHorarioInicio)}
                placeholder="07:45"
                keyboardType="numeric"
                maxLength={5}
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Término</Text>
              <TextInput
                value={horarioFim}
                onChangeText={(texto) => formatarHorario(texto, setHorarioFim)}
                placeholder="08:35"
                keyboardType="numeric"
                maxLength={5}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>Tipo de evento</Text>
          <View style={styles.tipoEventoContainer}>
            {TIPOS_EVENTO.map((item) => (
              <TouchableOpacity
                key={`tipo-${item.valor}`}
                style={[
                  styles.tipoEventoBtn,
                  { borderColor: item.cor },
                  tipoEvento === item.valor && { backgroundColor: item.cor },
                ]}
                onPress={() => setTipoEvento(item.valor)}
              >
                <Text style={[styles.tipoEventoBtnTxt, tipoEvento === item.valor && styles.tipoEventoBtnTxtAtivo]}>
                  {item.labelCurto}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Modalidade</Text>

          <View style={styles.modalidadeRow}>
            {['presencial', 'online', 'ambos'].map((item) => (
              <TouchableOpacity
                key={`modality-${item}`}
                style={[
                  styles.modalidadeBtn,
                  modalidade === item && styles.modalidadeBtnAtivo,
                ]}
                onPress={() => setModalidade(item)}
              >
                <Text
                  style={
                    modalidade === item
                      ? styles.modalidadeBtnTxtAtivo
                      : styles.modalidadeBtnTxt
                  }
                >
                  {item === 'presencial'
                    ? '🏠 Presencial'
                    : item === 'online'
                      ? '💻 Online'
                      : '🏠💻 Ambos'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tipoTemPacienteUnico(tipoEvento) && (
            <>
              <Text style={styles.label}>Analisante (opcional)</Text>

              {analisanteNome ? (
                <View style={styles.analisanteSelecionado}>
                  <Text style={styles.analisanteSelecionadoTxt}>
                    {analisanteNome}
                  </Text>
                  <TouchableOpacity onPress={limparAnalisante}>
                    <Text style={styles.analisanteRemover}>Remover ✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.analisantesLista}>
                    {pacientes.map((paciente) => (
                      <TouchableOpacity
                        key={`patient-${paciente.id}`}
                        style={styles.analisanteBtn}
                        onPress={() => selecionarAnalisante(paciente)}
                      >
                        <Text style={styles.analisanteBtnTxt}>
                          {paciente.name || paciente.nome}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={[styles.analisanteBtn, styles.analisanteBtnNovo]}
                      onPress={() => setMostrarNovoAnalisante((v) => !v)}
                    >
                      <Text style={styles.analisanteBtnNovoTxt}>
                        + Novo analisante
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {mostrarNovoAnalisante && (
                    <View style={styles.novoAnalisanteBox}>
                      <TextInput
                        value={novoAnalisanteNome}
                        onChangeText={setNovoAnalisanteNome}
                        placeholder="Nome do novo analisante"
                        style={styles.input}
                      />
                      <TouchableOpacity
                        style={styles.btnConfirmarAnalisante}
                        onPress={confirmarNovoAnalisante}
                      >
                        <Text style={styles.btnSalvarTxt}>Adicionar</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {ehTipoGrupo(tipoEvento) && (
            <>
              <Text style={styles.label}>Participantes *</Text>
              <View style={styles.analisantesLista}>
                {pacientes.map((paciente) => {
                  const selecionado = participantesIds.includes(paciente.id);
                  return (
                    <TouchableOpacity
                      key={`participante-${paciente.id}`}
                      style={[styles.analisanteBtn, selecionado && styles.analisanteBtnSelecionado]}
                      onPress={() => alternarParticipante(paciente.id)}
                    >
                      <Text style={[styles.analisanteBtnTxt, selecionado && styles.analisanteBtnTxtSelecionado]}>
                        {selecionado ? '✓ ' : ''}{paciente.name || paciente.nome}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {tipoEvento === 'outros' && (
            <>
              <Text style={styles.label}>Título *</Text>
              <TextInput
                value={titulo}
                onChangeText={setTitulo}
                placeholder="Ex: Supervisão institucional"
                style={styles.input}
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.btnSalvar, salvando && { opacity: 0.7 }]}
            onPress={salvarSlot}
            disabled={salvando || excluindoId != null}
          >
            {salvando
              ? <ActivityIndicator color="#fff" />
              : (
                <Text style={styles.btnSalvarTxt}>
                  {slotEditandoId ? 'Salvar alterações' : 'Adicionar horário'}
                </Text>
              )}
          </TouchableOpacity>

          {/* item 5: excluir horário direto no formulário de edição */}
          {slotEditandoId && (
            <TouchableOpacity
              style={[styles.btnExcluirForm, excluindoId === slotEditandoId && { opacity: 0.7 }]}
              onPress={excluirSlotEmEdicao}
              disabled={salvando || excluindoId != null}
            >
              {excluindoId === slotEditandoId
                ? <ActivityIndicator color="#c62828" />
                : <Text style={styles.btnExcluirFormTxt}>🗑️ Excluir horário</Text>}
            </TouchableOpacity>
          )}

          {slotEditandoId && (
            <TouchableOpacity
              style={styles.btnCancelar}
              onPress={limparFormulario}
            >
              <Text style={styles.btnCancelarTxt}>Cancelar edição</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.listaHeader}>
          <Text style={styles.listaTitulo}>
            Horários cadastrados ({slots.length})
          </Text>
        </View>

        {slots.length === 0 && (
          <View style={styles.vazio}>
            <Text style={styles.vazioTexto}>
              Nenhum horário disponível cadastrado.
            </Text>
          </View>
        )}

        {slots.map((slot) => (
          <View
            key={`availability-${slot.id}`}
            style={[
              styles.slotItem,
              { borderLeftColor: corTipoEvento(slot.tipo) },
            ]}
          >
            <View style={styles.slotInfo}>
              <Text style={styles.slotDia}>
                {obterDiaLabel(slot.day_of_week)}
              </Text>

              <Text style={styles.slotHorario}>
                {slot.start_time} — {slot.end_time}
              </Text>

              <Text style={[styles.slotTipo, { color: corTipoEvento(slot.tipo) }]}>
                {infoTipoEvento(slot.tipo).labelCurto}
              </Text>

              <Text style={styles.slotModalidade}>
                {modalidadeLabel(slot.modality)}
              </Text>

              {slot.patient_name && (
                <Text style={styles.slotAnalisante}>
                  👤 {slot.patient_name}
                </Text>
              )}
              {slot.participantes?.length > 0 && (
                <Text style={styles.slotAnalisante}>
                  👥 {slot.participantes.map((p) => p.nome).join(', ')}
                </Text>
              )}
              {slot.titulo && (
                <Text style={styles.slotAnalisante}>📌 {slot.titulo}</Text>
              )}
            </View>

            <View style={styles.slotAcoes}>
              <TouchableOpacity
                style={styles.btnAcao}
                onPress={() => editarSlot(slot)}
                disabled={excluindoId === slot.id}
              >
                <Text style={styles.btnAcaoTexto}>✏️</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnAcao}
                onPress={() => confirmarExclusao(slot)}
                disabled={excluindoId === slot.id}
              >
                {excluindoId === slot.id
                  ? <ActivityIndicator size="small" color="#c62828" />
                  : <Text style={styles.btnAcaoTexto}>🗑️</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.btnConcluir} onPress={salvarEVoltar}>
          <Text style={styles.btnConcluirTxt}>Concluir e voltar à agenda</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F7FA' },
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollContent: { padding: 16, paddingBottom: 36 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1A1A2E' },
  subtitle: {
    fontSize: 13,
    color: '#666666',
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
  },
  formTitulo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A1A2E',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#555555',
    fontWeight: '700',
    marginBottom: 7,
  },
  diasContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 16,
  },
  diaBtn: {
    minWidth: 42,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
  },
  diaBtnAtivo: { backgroundColor: '#1976D2' },
  diaBtnTxt: { fontSize: 12, color: '#333333' },
  diaBtnTxtAtivo: { fontSize: 12, color: '#FFFFFF', fontWeight: 'bold' },
  horariosRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  inputGroup: { flex: 1 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#D8DEE7',
    borderRadius: 9,
    paddingHorizontal: 12,
    color: '#1A1A2E',
    backgroundColor: '#FFFFFF',
  },
  tipoEventoContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  tipoEventoBtn: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  tipoEventoBtnTxt: { fontSize: 12, color: '#333333', fontWeight: '600' },
  tipoEventoBtnTxtAtivo: { color: '#FFFFFF', fontWeight: 'bold' },
  modalidadeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  modalidadeBtn: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
  },
  modalidadeBtnAtivo: { backgroundColor: '#1976D2' },
  modalidadeBtnTxt: { fontSize: 12, color: '#333333' },
  modalidadeBtnTxtAtivo: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  analisantesLista: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  analisanteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
  },
  analisanteBtnTxt: { fontSize: 12, color: '#333333' },
  analisanteBtnSelecionado: { backgroundColor: '#3D5A80' },
  analisanteBtnTxtSelecionado: { color: '#FFFFFF', fontWeight: '700' },
  analisanteBtnNovo: { backgroundColor: '#E3F2FD' },
  analisanteBtnNovoTxt: { fontSize: 12, color: '#1976D2', fontWeight: '700' },
  novoAnalisanteBox: { marginBottom: 16, gap: 8 },
  btnConfirmarAnalisante: {
    backgroundColor: '#1976D2',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  analisanteSelecionado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  analisanteSelecionadoTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B71C1C',
  },
  analisanteRemover: { fontSize: 12, color: '#B71C1C' },
  btnSalvar: {
    backgroundColor: '#1976D2',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSalvarTxt: { color: '#FFFFFF', fontWeight: 'bold' },
  btnExcluirForm: {
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#E57373',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  btnExcluirFormTxt: { color: '#C62828', fontWeight: 'bold' },
  btnCancelar: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  btnCancelarTxt: { color: '#1976D2', fontWeight: '600' },
  listaHeader: { marginTop: 24, marginBottom: 10 },
  listaTitulo: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  vazio: { backgroundColor: '#FFFFFF', padding: 20, borderRadius: 12 },
  vazioTexto: { textAlign: 'center', color: '#888888' },
  slotItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    padding: 14,
    borderLeftWidth: 7,
    elevation: 1,
  },
  slotInfo: { flex: 1 },
  slotDia: { fontSize: 12, color: '#777777', marginBottom: 3 },
  slotHorario: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  slotTipo: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  slotModalidade: { fontSize: 12, color: '#555555', marginTop: 4 },
  slotAnalisante: { fontSize: 12, color: '#B71C1C', marginTop: 4, fontWeight: '600' },
  slotAcoes: { flexDirection: 'row', gap: 6 },
  btnAcao: { padding: 7 },
  btnAcaoTexto: { fontSize: 18 },
  btnConcluir: {
    backgroundColor: '#3D5A80',
    paddingVertical: 14,
    marginTop: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnConcluirTxt: { color: '#FFFFFF', fontWeight: 'bold' },
});