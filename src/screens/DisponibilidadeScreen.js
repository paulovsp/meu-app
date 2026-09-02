import React, { useCallback, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
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
import CabecalhoTela from '../components/CabecalhoTela';

import {
  getAvailabilitySlots,
  verificarConflitoSlot,
  aplicarSlot,
  deleteAvailabilitySlot,
  getPatients,
  addPatient,
  cancelarCompromissosFuturosDoHorario,
  parsePreco,
  formatarMoeda,
  atualizarHorarioAppointment,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { TIPOS_EVENTO, infoTipoEvento, corTipoEvento, ehTipoGrupo, tipoTemPacienteUnico } from '../services/tiposEvento';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import {
  mascararHorario, normalizarHorario, horarioValido, horarioParaMinutos, terminoPadrao,
  DURACAO_PADRAO_SESSAO_MIN,
} from '../services/horarios';

const SEMANAS_CICLO = [1, 2, 3, 4];

const DIAS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
];

function formatarData(texto, setter) {
  const numeros = texto.replace(/\D/g, '').slice(0, 8);
  let formatado = numeros;
  if (numeros.length > 2 && numeros.length <= 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
  } else if (numeros.length > 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
  }
  setter(formatado);
}

function dataValida(dataBR) {
  const iso = dataBRParaISO(dataBR);
  if (!iso) return false;
  const [ano, mes, dia] = iso.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

function diaSemanaDeISO(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

// Horário de supervisão (individual ou em grupo) só pode envolver
// supervisionandos — analisante não pode aparecer nessa lista, e
// vice-versa pros tipos de sessão.
function pacientesElegiveis(tipoEvento, pacientes) {
  if (tipoEvento === 'supervisao_individual' || tipoEvento === 'supervisao_grupo') {
    return pacientes.filter((p) => p.eh_supervisionando);
  }
  return pacientes.filter((p) => p.eh_analisante);
}

const TIPOS_COBRANCA_PARTICIPANTE = [
  { valor: 'mensal', label: 'Mensal' },
  { valor: 'mensal_fixo', label: 'Mensal fixo' },
  { valor: 'por_sessao', label: 'Por sessão' },
];

function obterDiaLabel(dayOfWeek) {
  const dia = DIAS.find((item) => item.value === dayOfWeek);
  return dia?.label || 'Dia não definido';
}

function corDaModalidade(modality) {
  if (modality === 'online') return '#C3DFCF';
  if (modality === 'presencial') return '#C3DFCF';

  return '#F2E9DC';
}

function modalidadeLabel(modality) {
  if (modality === 'online') return 'Online';
  if (modality === 'presencial') return 'Presencial';

  return 'Ambos';
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
  // O término se preenche sozinho (início + 50 min) enquanto a pessoa não
  // digitar um término próprio — a partir daí, mexer no início não sobrescreve
  // mais o que ela escolheu à mão. Um horário já existente, aberto pra
  // edição, também conta como "definido pela pessoa".
  const terminoManualRef = useRef(false);
  const [modalidade, setModalidade] = useState('ambos');
  const [slotEditandoId, setSlotEditandoId] = useState(null);
  const [tipoEvento, setTipoEvento] = useState('sessao_individual');
  const [titulo, setTitulo] = useState('');
  const [participantesIds, setParticipantesIds] = useState([]);
  // { [patientId]: { valorSessao: '120', tipoCobranca: 'por_sessao' } } —
  // valor e forma de cobrança combinados PRA ESTE GRUPO (migration 0051).
  // Campo vazio / ausente = herda o que está na ficha da pessoa.
  const [pagamentoParticipantes, setPagamentoParticipantes] = useState({});

  // Presentes só quando esta tela foi aberta a partir de UM compromisso
  // específico (via "Editar informações do horário", DetalheCompromissoScreen.js)
  // — é o que permite perguntar, na hora de salvar, "só hoje ou todos os
  // futuros?" em vez de sempre mexer no horário recorrente inteiro. Ausentes
  // (null) quando a tela é aberta pra criar um horário novo, ou editando um
  // slot direto da lista desta própria tela — nesses casos salva sempre
  // como recorrente, sem perguntar (não existe "hoje" nesse contexto).
  const [appointmentIdEditando, setAppointmentIdEditando] = useState(null);
  const [dataOcorrenciaEditando, setDataOcorrenciaEditando] = useState(null);

  const [analisanteId, setAnalisanteId] = useState(null);
  const [analisanteNome, setAnalisanteNome] = useState('');
  const [mostrarNovoAnalisante, setMostrarNovoAnalisante] = useState(false);
  const [novoAnalisanteNome, setNovoAnalisanteNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluindoId, setExcluindoId] = useState(null);

  // ── Recorrência: avulso (uma data só) ou recorrente (semanal, quinzenal,
  // ou personalizada — semanas escolhidas dentro de um ciclo de 4) ──
  const [escopo, setEscopo] = useState('recorrente');
  const [recorrenciaTipo, setRecorrenciaTipo] = useState('semanal');
  const [dataAvulsa, setDataAvulsa] = useState('');
  const [dataReferencia, setDataReferencia] = useState('');
  const [semanasAtivas, setSemanasAtivas] = useState(SEMANAS_CICLO);

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
        setAppointmentIdEditando(params.appointmentId || null);
        setDataOcorrenciaEditando(params.date || null);
      }
      return;
    }

    if (params.dayOfWeek !== undefined) {
      limparFormulario();
      setAppointmentIdEditando(params.appointmentId || null);
      setDataOcorrenciaEditando(params.date || null);
      setDiaSemana(params.dayOfWeek);

      if (params.startTime) setHorarioInicio(params.startTime);
      if (params.endTime) {
        setHorarioFim(params.endTime);
        terminoManualRef.current = true;
      } else if (params.startTime) {
        const sugerido = terminoPadrao(params.startTime);
        if (sugerido) setHorarioFim(sugerido);
      }

      // Sem slotId (veio de um compromisso avulso — sem horário recorrente
      // por trás, ex: marcado num "horário liberado") — usa a informação do
      // próprio compromisso pra pré-preencher, senão a tela abriria em
      // branco mesmo já tendo tipo/modalidade/paciente definidos.
      if (params.tipo) setTipoEvento(params.tipo);
      if (params.modality) setModalidade(params.modality);
      if (params.titulo) setTitulo(params.titulo);
      if (params.patientId) {
        setAnalisanteId(params.patientId);
        setAnalisanteNome(params.patientNome || '');
      }
      if (params.participantesIds?.length) setParticipantesIds(params.participantesIds);
    }
  }

  // ── Digitação dos horários (ver src/services/horarios.js) ──
  function aoDigitarInicio(texto) {
    const mascarado = mascararHorario(texto);
    setHorarioInicio(mascarado);
    if (terminoManualRef.current) return;
    const sugerido = terminoPadrao(mascarado);
    if (sugerido) setHorarioFim(sugerido);
  }

  function aoDigitarFim(texto) {
    terminoManualRef.current = true;
    setHorarioFim(mascararHorario(texto));
  }

  // Ao sair do campo, o que foi digitado vira o horário final ("845" ->
  // "08:45", "8" -> "08:00") — se não der pra interpretar, o texto fica como
  // está e a validação do salvar avisa.
  function normalizarCampoInicio() {
    const normalizado = normalizarHorario(horarioInicio);
    if (!normalizado) return;
    setHorarioInicio(normalizado);
    if (terminoManualRef.current) return;
    const sugerido = terminoPadrao(normalizado);
    if (sugerido) setHorarioFim(sugerido);
  }

  function normalizarCampoFim() {
    const normalizado = normalizarHorario(horarioFim);
    if (normalizado) setHorarioFim(normalizado);
  }

  function limparFormulario() {
    setSlotEditandoId(null);
    setAppointmentIdEditando(null);
    setDataOcorrenciaEditando(null);
    setDiaSemana(1);
    setHorarioInicio('');
    setHorarioFim('');
    terminoManualRef.current = false;
    setModalidade('ambos');
    setTipoEvento('sessao_individual');
    setTitulo('');
    setParticipantesIds([]);
    setPagamentoParticipantes({});
    setAnalisanteId(null);
    setAnalisanteNome('');
    setMostrarNovoAnalisante(false);
    setNovoAnalisanteNome('');
    setEscopo('recorrente');
    setRecorrenciaTipo('semanal');
    setDataAvulsa('');
    setDataReferencia('');
    setSemanasAtivas(SEMANAS_CICLO);
  }

  function alternarSemanaAtiva(semana) {
    setSemanasAtivas((atual) =>
      atual.includes(semana) ? atual.filter((s) => s !== semana) : [...atual, semana].sort()
    );
  }

  function alternarParticipante(patientId) {
    setParticipantesIds((atual) =>
      atual.includes(patientId) ? atual.filter((id) => id !== patientId) : [...atual, patientId]
    );
  }

  function definirPagamentoParticipante(patientId, campos) {
    setPagamentoParticipantes((atual) => ({
      ...atual,
      [patientId]: { ...(atual[patientId] || {}), ...campos },
    }));
  }

  /** O que este grupo rende por encontro: soma do valor combinado de cada
   * integrante, caindo no preço da ficha de quem não tem valor próprio —
   * é exatamente a mesma regra usada em getSlotsOcupados (database.js),
   * pra tela e Financeiro nunca mostrarem números diferentes. */
  const totalGrupoPorEncontro = participantesIds.reduce((soma, pid) => {
    const combinado = pagamentoParticipantes[pid]?.valorSessao;
    if (combinado != null && String(combinado).trim() !== '') {
      return soma + parsePreco(combinado);
    }
    const paciente = pacientes.find((p) => p.id === pid);
    return soma + parsePreco(paciente?.preco_sessao);
  }, 0);

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
      // Criado a partir de um horário de supervisão individual: marca como
      // supervisionando (não analisante) — sem isso, ia sempre parar como
      // analisante por padrão, mesmo quando quem está sendo cadastrada é
      // uma supervisionanda.
      const ehSupervisao = tipoEvento === 'supervisao_individual';
      const criado = await addPatient?.(nome, {
        ehAnalisante: !ehSupervisao,
        ehSupervisionando: ehSupervisao,
      });
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

  // Muda só a hora DESTE compromisso específico (tabela appointments),
  // sem tocar no horário recorrente nem em nenhuma outra informação
  // (paciente/tipo/modalidade continuam iguais) — é o que "só hoje"
  // significa (item 4, v13, antes numa tela separada, hoje só mais uma
  // opção desta mesma tela na hora de salvar).
  async function salvarSoHoje(inicio, fim) {
    setSalvando(true);
    try {
      await atualizarHorarioAppointment(appointmentIdEditando, { startTime: inicio, endTime: fim });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvando(false);
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
    // Interpreta o que foi digitado antes de validar — quem escreveu "845"
    // e tocou direto em salvar (sem sair do campo) também é atendido.
    const inicio = normalizarHorario(horarioInicio);
    const fim = normalizarHorario(horarioFim);

    if (!horarioValido(inicio) || !horarioValido(fim)) {
      Alert.alert(
        'Horário inválido',
        'Informe os horários no formato HH:MM.\n\nExemplo: 07:45 (dá pra digitar só "745").'
      );
      return;
    }
    // Reflete na tela o que de fato será usado daqui em diante — pro
    // restante desta função e pro Alert abaixo.
    setHorarioInicio(inicio);
    setHorarioFim(fim);

    // Veio de um compromisso específico (não de criar/editar o horário
    // recorrente em abstrato) — pergunta se a mudança vale só pra hoje
    // (só a hora desta ocorrência muda) ou pro horário recorrente inteiro
    // (tudo o que está nesta tela passa a valer também pros futuros).
    // Tudo o mais (validação de grupo/paciente/recorrência, conflito de
    // horário, etc.) só faz sentido pro caminho recorrente, por isso essa
    // pergunta acontece ANTES do resto.
    if (appointmentIdEditando) {
      const dataFormatada = dataOcorrenciaEditando
        ? dataOcorrenciaEditando.split('-').reverse().join('/')
        : 'hoje';
      Alert.alert(
        'Salvar horário',
        `Salvar só para ${dataFormatada} (só a hora muda), ou para este horário e todos os futuros (tudo muda)?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: `Só ${dataFormatada}`, onPress: () => salvarSoHoje(inicio, fim) },
          { text: 'Este e todos os futuros', onPress: () => continuarSalvamentoRecorrente(inicio, fim) },
        ]
      );
      return;
    }

    await continuarSalvamentoRecorrente(inicio, fim);
  }

  async function continuarSalvamentoRecorrente(inicio, fim) {
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
    // Sessão/supervisão individual sem paciente vinculado sempre quebrava
    // ao abrir na Agenda ("null value in column patient_id") — o campo
    // dizia "(opcional)" mas o compromisso materializado exige um
    // paciente. Passa a ser obrigatório pra estes dois tipos.
    if (tipoTemPacienteUnico(tipoEvento) && !analisanteId) {
      Alert.alert(
        'Obrigatório',
        tipoEvento === 'supervisao_individual'
          ? 'Selecione o supervisionando deste horário.'
          : 'Selecione o analisante deste horário.'
      );
      return;
    }

    // ── Recorrência: avulso precisa de uma data válida; quinzenal e
    // personalizada precisam da data da 1ª sessão (âncora do ciclo de 4
    // semanas); personalizada também precisa de ao menos 1 semana marcada.
    if (escopo === 'avulso' && !dataValida(dataAvulsa)) {
      Alert.alert('Data inválida', 'Informe a data desse horário avulso no formato DD/MM/AAAA.');
      return;
    }
    if (escopo === 'recorrente' && (recorrenciaTipo === 'quinzenal' || recorrenciaTipo === 'personalizada') && !dataValida(dataReferencia)) {
      Alert.alert('Data inválida', 'Informe a data da 1ª sessão no formato DD/MM/AAAA.');
      return;
    }
    if (escopo === 'recorrente' && recorrenciaTipo === 'personalizada' && semanasAtivas.length === 0) {
      Alert.alert('Semanas obrigatórias', 'Marque ao menos uma semana do ciclo pra recorrência personalizada.');
      return;
    }

    const diaSemanaEfetivo = escopo === 'avulso' ? diaSemanaDeISO(dataBRParaISO(dataAvulsa)) : diaSemana;
    const recorrencia = escopo === 'avulso'
      ? { tipo: 'avulso', data_avulsa: dataBRParaISO(dataAvulsa) }
      : recorrenciaTipo === 'semanal'
        ? { tipo: 'semanal' }
        : recorrenciaTipo === 'quinzenal'
          ? { tipo: 'quinzenal', data_referencia: dataBRParaISO(dataReferencia) }
          : { tipo: 'personalizada', data_referencia: dataBRParaISO(dataReferencia), semanas_ativas: semanasAtivas };

    setSalvando(true);
    let ocupado, livres, modalidadeNormalizada;
    try {
      ({ ocupado, livres, modalidadeNormalizada } = await verificarConflitoSlot({
        id: slotEditandoId,
        day_of_week: diaSemanaEfetivo,
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
          day_of_week: diaSemanaEfetivo,
          start_time: inicio,
          end_time: fim,
          modality: modalidadeNormalizada,
          patient_id: tipoTemPacienteUnico(tipoEvento) ? analisanteId : null,
          livresParaRemover: livres,
          tipo: tipoEvento,
          titulo: tipoEvento === 'outros' ? titulo.trim() : null,
          // Cada integrante vai com o valor e a cobrança combinados pro
          // grupo (vazio = herda a ficha) — ver migration 0051.
          participantes: ehTipoGrupo(tipoEvento)
            ? participantesIds.map((pid) => ({
                patientId: pid,
                valorSessao: pagamentoParticipantes[pid]?.valorSessao?.trim()
                  ? parsePreco(pagamentoParticipantes[pid].valorSessao)
                  : null,
                tipoCobranca: pagamentoParticipantes[pid]?.tipoCobranca || null,
              }))
            : [],
          recorrencia,
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
    // Horário que já existe tem término escolhido — não pode ser
    // sobrescrito pelo padrão de 50 min se a pessoa ajustar só o início.
    terminoManualRef.current = true;
    setModalidade(slot.modality);
    setTipoEvento(slot.tipo || 'sessao_individual');
    setTitulo(slot.titulo || '');
    setParticipantesIds((slot.participantes || []).map((p) => p.id));
    // Reabre com o valor/cobrança combinados que já estavam salvos pra
    // cada integrante (nulos ficam vazios = herda a ficha).
    setPagamentoParticipantes(
      Object.fromEntries((slot.participantes || []).map((p) => [
        p.id,
        {
          valorSessao: p.valorSessao != null ? String(p.valorSessao) : '',
          tipoCobranca: p.tipoCobranca || null,
        },
      ]))
    );
    setAnalisanteId(slot.patient_id || null);
    setAnalisanteNome(slot.patient_name || '');
    setMostrarNovoAnalisante(false);
    setNovoAnalisanteNome('');

    const tipoRecorrencia = slot.recorrencia_tipo || 'semanal';
    setEscopo(tipoRecorrencia === 'avulso' ? 'avulso' : 'recorrente');
    setRecorrenciaTipo(tipoRecorrencia === 'avulso' ? 'semanal' : tipoRecorrencia);
    setDataAvulsa(dataISOParaBR(slot.data_avulsa));
    setDataReferencia(dataISOParaBR(slot.recorrencia_data_referencia));
    setSemanasAtivas(slot.recorrencia_semanas_ativas?.length ? slot.recorrencia_semanas_ativas : SEMANAS_CICLO);
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
      <CabecalhoTela titulo="Editar Horário" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

          <Text style={styles.label}>Avulso ou recorrente?</Text>
          <View style={styles.modalidadeRow}>
            {[{ valor: 'recorrente', label: 'Recorrente' }, { valor: 'avulso', label: 'Avulso (uma data só)' }].map((op) => (
              <TouchableOpacity
                key={`escopo-${op.valor}`}
                style={[styles.modalidadeBtn, escopo === op.valor && styles.modalidadeBtnAtivo]}
                onPress={() => setEscopo(op.valor)}
              >
                <Text style={escopo === op.valor ? styles.modalidadeBtnTxtAtivo : styles.modalidadeBtnTxt}>
                  {op.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {escopo === 'avulso' ? (
            <>
              <Text style={styles.label}>Data</Text>
              <TextInput
                value={dataAvulsa}
                onChangeText={(texto) => formatarData(texto, setDataAvulsa)}
                placeholder="DD/MM/AAAA"
                keyboardType="numeric"
                maxLength={10}
                style={[styles.input, { marginBottom: 16 }]}
              />
            </>
          ) : (
            <>
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

              <Text style={styles.label}>Recorrência</Text>
              <View style={styles.modalidadeRow}>
                {[{ valor: 'semanal', label: 'Semanal' }, { valor: 'quinzenal', label: 'Quinzenal' }, { valor: 'personalizada', label: 'Personalizada' }].map((op) => (
                  <TouchableOpacity
                    key={`recorrencia-${op.valor}`}
                    style={[styles.modalidadeBtn, recorrenciaTipo === op.valor && styles.modalidadeBtnAtivo]}
                    onPress={() => setRecorrenciaTipo(op.valor)}
                  >
                    <Text style={recorrenciaTipo === op.valor ? styles.modalidadeBtnTxtAtivo : styles.modalidadeBtnTxt}>
                      {op.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {(recorrenciaTipo === 'quinzenal' || recorrenciaTipo === 'personalizada') && (
                <>
                  <Text style={styles.label}>Data da 1ª sessão</Text>
                  <TextInput
                    value={dataReferencia}
                    onChangeText={(texto) => formatarData(texto, setDataReferencia)}
                    placeholder="DD/MM/AAAA"
                    keyboardType="numeric"
                    maxLength={10}
                    style={[styles.input, { marginBottom: 16 }]}
                  />
                </>
              )}

              {recorrenciaTipo === 'personalizada' && (
                <>
                  <Text style={styles.label}>Semanas ativas do ciclo (a partir da 1ª sessão)</Text>
                  <View style={[styles.modalidadeRow, { marginBottom: 18 }]}>
                    {SEMANAS_CICLO.map((semana) => {
                      const ativa = semanasAtivas.includes(semana);
                      return (
                        <TouchableOpacity
                          key={`semana-${semana}`}
                          style={[styles.modalidadeBtn, ativa && styles.modalidadeBtnAtivo]}
                          onPress={() => alternarSemanaAtiva(semana)}
                        >
                          <Text style={ativa ? styles.modalidadeBtnTxtAtivo : styles.modalidadeBtnTxt}>
                            Semana {semana}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </>
          )}

          <View style={styles.horariosRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Início</Text>
              <TextInput
                value={horarioInicio}
                onChangeText={aoDigitarInicio}
                onBlur={normalizarCampoInicio}
                placeholder="745"
                keyboardType="numeric"
                maxLength={5}
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Término</Text>
              <TextInput
                value={horarioFim}
                onChangeText={aoDigitarFim}
                onBlur={normalizarCampoFim}
                placeholder="08:35"
                keyboardType="numeric"
                maxLength={5}
                style={styles.input}
              />
            </View>
          </View>
          <Text style={styles.horarioDica}>
            Dá pra digitar só os números ("745" vira 07:45). O término se preenche
            sozinho com {DURACAO_PADRAO_SESSAO_MIN} minutos — mude se precisar.
          </Text>

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
                    ? 'Presencial'
                    : item === 'online'
                      ? 'Online'
                      : 'Ambos'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tipoTemPacienteUnico(tipoEvento) && (
            <>
              <Text style={styles.label}>
                {tipoEvento === 'supervisao_individual' ? 'Supervisionando *' : 'Analisante *'}
              </Text>

              {analisanteNome ? (
                <View style={styles.analisanteSelecionado}>
                  <Text style={styles.analisanteSelecionadoTxt}>
                    {analisanteNome}
                  </Text>
                  <TouchableOpacity onPress={limparAnalisante}>
                    <Text style={styles.analisanteRemover}>Remover</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.analisantesLista}>
                    {pacientesElegiveis(tipoEvento, pacientes).map((paciente) => (
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
                        {tipoEvento === 'supervisao_individual' ? '+ Novo supervisionando' : '+ Novo analisante'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {mostrarNovoAnalisante && (
                    <View style={styles.novoAnalisanteBox}>
                      <TextInput
                        value={novoAnalisanteNome}
                        onChangeText={setNovoAnalisanteNome}
                        placeholder={tipoEvento === 'supervisao_individual' ? 'Nome do novo supervisionando' : 'Nome do novo analisante'}
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
                {pacientesElegiveis(tipoEvento, pacientes).map((paciente) => {
                  const selecionado = participantesIds.includes(paciente.id);
                  return (
                    <TouchableOpacity
                      key={`participante-${paciente.id}`}
                      style={[styles.analisanteBtn, selecionado && styles.analisanteBtnSelecionado]}
                      onPress={() => alternarParticipante(paciente.id)}
                    >
                      <Text style={[styles.analisanteBtnTxt, selecionado && styles.analisanteBtnTxtSelecionado]}>
                        {selecionado ? '• ' : ''}{paciente.name || paciente.nome}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Quanto cada integrante paga NESTE grupo e como é cobrado
                  (migration 0051). Sem isso, Financeiro/Recebíveis usavam o
                  preço da sessão INDIVIDUAL da pessoa, que quase nunca é o
                  valor combinado do grupo. Em branco = herda a ficha. */}
              {participantesIds.length > 0 && (
                <>
                  <Text style={styles.label}>Pagamento de cada participante</Text>
                  <Text style={styles.horarioDica}>
                    Deixe o valor em branco pra usar o preço da ficha da pessoa.
                    O total do grupo é a soma de todos.
                  </Text>
                  {participantesIds.map((pid) => {
                    const paciente = pacientes.find((p) => p.id === pid);
                    const dados = pagamentoParticipantes[pid] || {};
                    const cobranca = dados.tipoCobranca || paciente?.tipo_cobranca || 'mensal';
                    return (
                      <View key={`pagamento-${pid}`} style={styles.participantePagamentoCard}>
                        <Text style={styles.participantePagamentoNome} numberOfLines={1}>
                          {paciente?.nome || paciente?.name || 'Participante'}
                        </Text>
                        <View style={styles.participantePagamentoLinha}>
                          <Text style={styles.participantePagamentoLabel}>R$</Text>
                          <TextInput
                            style={[styles.input, styles.participantePagamentoInput]}
                            value={dados.valorSessao ?? ''}
                            onChangeText={(t) => definirPagamentoParticipante(pid, { valorSessao: t.replace(/[^\d,.]/g, '') })}
                            placeholder={paciente?.preco_sessao ? `Ficha: ${paciente.preco_sessao}` : 'Valor por sessão'}
                            placeholderTextColor="#A9A299"
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View style={styles.participantePagamentoLinha}>
                          {TIPOS_COBRANCA_PARTICIPANTE.map((opcao) => (
                            <TouchableOpacity
                              key={`cobranca-${pid}-${opcao.valor}`}
                              style={[styles.cobrancaChip, cobranca === opcao.valor && styles.cobrancaChipAtivo]}
                              onPress={() => definirPagamentoParticipante(pid, { tipoCobranca: opcao.valor })}
                            >
                              <Text style={[styles.cobrancaChipTxt, cobranca === opcao.valor && styles.cobrancaChipTxtAtivo]}>
                                {opcao.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                  <View style={styles.totalGrupoBox}>
                    <Text style={styles.totalGrupoTxt}>
                      Total por encontro do grupo: {formatarMoeda(totalGrupoPorEncontro)}
                    </Text>
                  </View>
                </>
              )}
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
                ? <ActivityIndicator color="#975451" />
                : <Text style={styles.btnExcluirFormTxt}>Excluir horário</Text>}
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
                {slot.recorrencia_tipo === 'avulso'
                  ? `Avulso · ${dataISOParaBR(slot.data_avulsa)}`
                  : obterDiaLabel(slot.day_of_week)}
                {slot.recorrencia_tipo === 'quinzenal' && ' · Quinzenal'}
                {slot.recorrencia_tipo === 'personalizada' && ' · Personalizada'}
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
                  {slot.patient_name}
                </Text>
              )}
              {slot.participantes?.length > 0 && (
                <>
                  <Text style={styles.slotAnalisante}>
                    {slot.participantes.map((p) => p.nome).join(', ')}
                  </Text>
                  {/* Soma do que o grupo rende por encontro — mesma regra
                      do Financeiro (valor do grupo, ou o da ficha). */}
                  <Text style={styles.slotValorGrupo}>
                    {formatarMoeda(slot.participantes.reduce(
                      (soma, p) => soma + parsePreco(p.valorSessao ?? p.precoFicha),
                      0
                    ))} por encontro
                  </Text>
                </>
              )}
              {slot.titulo && (
                <Text style={styles.slotAnalisante}>{slot.titulo}</Text>
              )}
            </View>

            <View style={styles.slotAcoes}>
              <TouchableOpacity
                style={styles.btnAcao}
                onPress={() => editarSlot(slot)}
                disabled={excluindoId === slot.id}
              >
                <Ionicons name="pencil-outline" size={18} color="#497363" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnAcao}
                onPress={() => confirmarExclusao(slot)}
                disabled={excluindoId === slot.id}
              >
                {excluindoId === slot.id
                  ? <ActivityIndicator size="small" color="#975451" />
                  : <Ionicons name="trash-outline" size={18} color="#A9A299" />}
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
  safeArea: { flex: 1, backgroundColor: '#F7F5F0' },
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  scrollContent: { padding: 16, paddingBottom: 36 },
  title: { fontSize: 22, fontWeight: '500', color: '#302C28' },
  subtitle: {
    fontSize: 13,
    color: '#756E66',
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: '#FDFCFA',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
  },
  formTitulo: {
    fontSize: 16,
    fontWeight: '500',
    color: '#302C28',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#756E66',
    fontWeight: '500',
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
    backgroundColor: '#EAE5DC',
  },
  diaBtnAtivo: { backgroundColor: '#497363' },
  diaBtnTxt: { fontSize: 12, color: '#4E4941', lineHeight: 17 },
  diaBtnTxtAtivo: { fontSize: 12, color: '#FFFFFF', fontWeight: '500', lineHeight: 17 },
  horariosRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  horarioDica: { fontSize: 11.5, color: '#8C857B', fontStyle: 'italic', lineHeight: 16, marginBottom: 16 },
  participantePagamentoCard: {
    backgroundColor: '#FDFCFA',
    borderWidth: 1,
    borderColor: '#EAE5DC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  participantePagamentoNome: { fontSize: 14, fontWeight: '500', color: '#302C28', lineHeight: 20 },
  participantePagamentoLinha: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  participantePagamentoLabel: { fontSize: 14, color: '#8C857B', lineHeight: 20 },
  participantePagamentoInput: { flex: 1, marginBottom: 0 },
  cobrancaChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#DDD6CA', backgroundColor: '#F7F5F0',
  },
  cobrancaChipAtivo: { backgroundColor: '#497363', borderColor: '#497363' },
  cobrancaChipTxt: { fontSize: 12, color: '#8C857B', lineHeight: 17 },
  cobrancaChipTxtAtivo: { color: '#FFFFFF', fontWeight: '500' },
  totalGrupoBox: {
    backgroundColor: '#E4EFE9', borderRadius: 10, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#497363', marginBottom: 12,
  },
  totalGrupoTxt: { fontSize: 13, fontWeight: '500', color: '#497363', lineHeight: 19 },
  inputGroup: { flex: 1 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#EAE5DC',
    borderRadius: 9,
    paddingHorizontal: 12,
    color: '#302C28',
    backgroundColor: '#FDFCFA',
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
    borderWidth: 1,
  },
  tipoEventoBtnTxt: { fontSize: 12, color: '#4E4941', fontWeight: '600', lineHeight: 17 },
  tipoEventoBtnTxtAtivo: { color: '#FFFFFF', fontWeight: '500' },
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
    backgroundColor: '#EAE5DC',
  },
  modalidadeBtnAtivo: { backgroundColor: '#497363' },
  modalidadeBtnTxt: { fontSize: 12, color: '#4E4941', lineHeight: 17 },
  modalidadeBtnTxtAtivo: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
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
    backgroundColor: '#EAE5DC',
  },
  analisanteBtnTxt: { fontSize: 12, color: '#4E4941', lineHeight: 17 },
  analisanteBtnSelecionado: { backgroundColor: '#497363' },
  analisanteBtnTxtSelecionado: { color: '#FFFFFF', fontWeight: '500' },
  analisanteBtnNovo: { backgroundColor: '#E3EAF1' },
  analisanteBtnNovoTxt: { fontSize: 12, color: '#497363', fontWeight: '500', lineHeight: 17 },
  novoAnalisanteBox: { marginBottom: 16, gap: 8 },
  btnConfirmarAnalisante: {
    backgroundColor: '#497363',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  analisanteSelecionado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F1E4E3',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  analisanteSelecionadoTxt: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7E4441',
  },
  analisanteRemover: { fontSize: 12, color: '#7E4441', lineHeight: 17 },
  btnSalvar: {
    backgroundColor: '#497363',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSalvarTxt: { color: '#FFFFFF', fontWeight: '500' },
  btnExcluirForm: {
    backgroundColor: '#F1E4E3',
    borderWidth: 1,
    borderColor: '#975451',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  btnExcluirFormTxt: { color: '#975451', fontWeight: '500' },
  btnCancelar: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  btnCancelarTxt: { color: '#497363', fontWeight: '600' },
  listaHeader: { marginTop: 24, marginBottom: 10 },
  listaTitulo: { fontSize: 16, fontWeight: '500', color: '#302C28', lineHeight: 23 },
  vazio: { backgroundColor: '#FDFCFA', padding: 20, borderRadius: 12 },
  vazioTexto: { textAlign: 'center', color: '#8C857B' },
  slotItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FDFCFA',
    borderRadius: 12,
    marginBottom: 10,
    padding: 14,
    borderLeftWidth: 7,
    elevation: 1,
  },
  slotInfo: { flex: 1 },
  slotDia: { fontSize: 12, color: '#8C857B', marginBottom: 3, lineHeight: 17 },
  slotHorario: { fontSize: 16, fontWeight: '500', color: '#302C28', lineHeight: 23 },
  slotTipo: { fontSize: 12, fontWeight: '500', marginTop: 4, lineHeight: 17 },
  slotModalidade: { fontSize: 12, color: '#756E66', marginTop: 4, lineHeight: 17 },
  slotAnalisante: { fontSize: 12, color: '#7E4441', marginTop: 4, fontWeight: '600', lineHeight: 17 },
  slotValorGrupo: { fontSize: 11.5, color: '#497363', marginTop: 2, fontWeight: '500', lineHeight: 16 },
  slotAcoes: { flexDirection: 'row', gap: 6 },
  btnAcao: { padding: 7 },
  btnAcaoTexto: { fontSize: 18 },
  btnConcluir: {
    backgroundColor: '#497363',
    paddingVertical: 14,
    marginTop: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnConcluirTxt: { color: '#FFFFFF', fontWeight: '500' },
});