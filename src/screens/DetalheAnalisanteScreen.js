import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SectionList, Alert, ActivityIndicator, Modal, TextInput
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getSessions, getRecords, deleteSession, deleteRecord, parsePreco, getPatientById, getModalidadeDerivada,
  getHistoricoParalizacoes, marcarParalizacao, marcarRetorno,
  editarPeriodoParalizacao, excluirPeriodoParalizacao,
  getAvailabilitySlotsByPatient, liberarHorariosDoPaciente,
} from '../services/database';
import { formatarValorMoeda, getCotacaoCacheada } from '../services/currency';
import { solicitarAutorizacao, getStatusAutorizacao } from '../services/autorizacaoGravacao';
import { mensagemDeErro } from '../services/erros';
import { dataISOParaBR, dataBRParaISO, calcularAnosEMeses, formatarAnosEMeses } from '../services/validacao';

// ─── Helper: máscara DD/MM/AAAA enquanto digita (mesmo padrão usado no
// Formulário do Analisante) ─────────────────────────────
function formatarDataDigitada(texto, setter) {
  const numeros = texto.replace(/\D/g, '');
  let formatado = numeros;
  if (numeros.length >= 3 && numeros.length <= 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
  } else if (numeros.length > 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
  }
  setter(formatado);
}

// ─── Helper: remove tags HTML ──────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Preço da sessão (com conversão para Reais, se moeda estrangeira) ──
function getPrecoLabel(paciente, cotacaoCache) {
  const valor = parsePreco(paciente.preco_sessao);
  if (!valor) return null;
  const moeda = paciente.preco_moeda || 'BRL';
  const formatado = formatarValorMoeda(valor, moeda);
  if (moeda === 'BRL') return formatado;

  if (!cotacaoCache?.valor_brl) return formatado;
  return `${formatado}  (≈ ${formatarValorMoeda(valor * cotacaoCache.valor_brl, 'BRL')})`;
}

// ─── Labels ────────────────────────────────────────────
function getModalidadeLabel(modalidade) {
  switch (modalidade) {
    case 'online':     return 'Online';
    case 'presencial': return 'Presencial';
    case 'hibrido':    return 'Híbrido';
    default:           return null;
  }
}

// ─── Status da autorização de gravação/transcrição ────
// Motivo exato devolvido pela Edge Function confirmar-autorizacao quando o
// documento enviado não bate — mostrar aqui pra profissional evita que ela
// veja só "Aguardando" sem saber que o analisante já tentou e falhou, e por quê.
const MOTIVO_REJEICAO_LABEL = {
  documento_ilegivel: 'documento ilegível na foto',
  cpf_nao_confere: 'CPF do documento não confere com o cadastro',
  cpf_do_profissional: 'enviou documento da própria profissional',
};

function getAutorizacaoInfo(autorizacao) {
  if (!autorizacao) {
    return { texto: 'Ainda não solicitada', cor: '#8C857B', botao: 'Solicitar autorização' };
  }
  if (autorizacao.status === 'autorizada') {
    const data = autorizacao.respondido_em
      ? new Date(autorizacao.respondido_em).toLocaleDateString('pt-BR')
      : '';
    return { texto: `Autorizada${data ? ` em ${data}` : ''}`, cor: '#44745B', botao: 'Solicitar novamente' };
  }
  if (autorizacao.status === 'negada') {
    return { texto: 'Não autorizada pelo analisante', cor: '#975451', botao: 'Solicitar novamente' };
  }

  // status === 'pendente' — ainda sem resposta, ou já tentou enviar o
  // documento e a conferência automática rejeitou (continua pendente até
  // esgotar as 5 tentativas ou o analisante conseguir enviar um válido).
  const motivo = MOTIVO_REJEICAO_LABEL[autorizacao.motivo_rejeicao];
  const bloqueada = (autorizacao.tentativas || 0) >= 5;
  if (bloqueada) {
    return {
      texto: `Bloqueada — esgotou as tentativas${motivo ? ` (${motivo})` : ''}`,
      cor: '#975451',
      botao: 'Solicitar novamente',
    };
  }
  if (motivo) {
    return {
      texto: `Aguardando reenvio — última tentativa falhou (${motivo})`,
      cor: '#7D6540',
      botao: 'Reenviar e-mail',
    };
  }
  return { texto: 'Aguardando confirmação do analisante', cor: '#7D6540', botao: 'Reenviar e-mail' };
}

// ⚠️ NOVO: Badge de autor para registros
function getAuthorBadge(author) {
  switch (author) {
    case 'analyst':   return { icon: 'medkit-outline',        label: 'A.',   color: '#4D6B88', bg: '#E3EAF1' };
    case 'analysand': return { icon: 'chatbubble-outline',    label: 'P.',   color: '#7D6540', bg: '#F2E9DC' };
    case 'alternado': return { icon: 'swap-horizontal-outline', label: 'A/P',  color: '#675A9A', bg: '#E2DFEF' };
    default:          return null;
  }
}

function getItemTipoLabel(item) {
  if (item._itemType === 'session') {
    return item.transcript
      ? { icon: 'mic-outline', label: 'Sessão Transcrita', color: '#4D6B88', bg: '#E3EAF1' }
      : { icon: 'document-text-outline', label: 'Sessão Anotada',   color: '#7D6540', bg: '#F2E9DC' };
  }
  // Registros salvos antes da correção do Novo Registro gravavam o tipo
  // (sessão/estudo/outro) na coluna `type` por engano, em vez de `category`
  // — sem esse fallback, todo registro antigo caía no rótulo genérico "Nota".
  const cat = item.category || (['sessao', 'estudo', 'outro'].includes(item.type) ? item.type : null);
  if (cat === 'sessao') return { icon: 'document-text-outline', label: 'Sessão Anotada', color: '#7D6540', bg: '#F2E9DC' };
  if (cat === 'estudo') return { icon: 'library-outline', label: 'Estudo', color: '#675A9A', bg: '#E2DFEF' };
  if (cat === 'outro')  return { icon: 'bookmark-outline', label: 'Outro',  color: '#8C857B',   bg: '#F1EDE5' };
  if (item.type === 'image') return { icon: 'image-outline', label: 'Imagem', color: '#975451', bg: '#F1E4E3' };
  if (item.type === 'file')  return { icon: 'attach-outline', label: 'Arquivo', color: '#8C857B',   bg: '#F1EDE5' };
  return { icon: 'document-text-outline', label: 'Nota', color: '#675A9A', bg: '#E2DFEF' };
}

// Item 10 (v13): agrupa o histórico em 3 pastas — sessões (transcritas ou
// anotadas) ficam juntas com registros do tipo "sessão", já que a distinção
// entre elas é só uma badge (🎙️ vs 📝), não uma pasta separada. Registro sem
// categoria nenhuma (imagem/arquivo/nota salva antes da correção do item 6)
// cai em "Outros", o catch-all — não faz sentido junto de sessão nem estudo.
const PASTAS = [
  { key: 'sessoes', titulo: 'Sessões' },
  { key: 'estudos', titulo: 'Estudos' },
  { key: 'outros', titulo: 'Outros' },
];

function getPastaItem(item) {
  if (item._itemType === 'session') return 'sessoes';
  const cat = item.category || (['sessao', 'estudo', 'outro'].includes(item.type) ? item.type : null);
  if (cat === 'sessao') return 'sessoes';
  if (cat === 'estudo') return 'estudos';
  return 'outros';
}

// ─── InfoRow (dados do paciente) ───────────────────────
function InfoRow({ label, value, icon }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={17} color="#8C857B" style={styles.infoRowIcon} />
      <View style={styles.infoRowContent}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        <Text style={styles.infoRowValue}>{value}</Text>
      </View>
    </View>
  );
}

// ─── COMPONENTE PRINCIPAL ──────────────────────────────
export default function DetalheAnalisanteScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { paciente: pacienteInicial } = route.params;

  // `route.params.paciente` é só a foto de quando se navegou pra cá — se a
  // psicanalista editar o cadastro (CPF/nascimento/e-mail) e voltar, esse
  // valor NÃO se atualiza sozinho. Por isso `paciente` vira estado local,
  // recarregado do Supabase toda vez que a tela ganha foco.
  const [paciente, setPaciente] = useState(pacienteInicial);
  const [sessoes, setSessoes] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [autorizacao, setAutorizacao] = useState(null);
  const [enviandoAutorizacao, setEnviandoAutorizacao] = useState(false);
  const [cotacaoCache, setCotacaoCache] = useState(null);
  const [modalidadeDerivada, setModalidadeDerivada] = useState(null);
  const [removendoItemId, setRemovendoItemId] = useState(null);
  const [historicoParalizacoes, setHistoricoParalizacoes] = useState([]);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [alternandoParalizacao, setAlternandoParalizacao] = useState(false);
  const [periodoEmEdicao, setPeriodoEmEdicao] = useState(null);
  const [dataInicioEdicao, setDataInicioEdicao] = useState('');
  const [dataFimEdicao, setDataFimEdicao] = useState('');
  const [salvandoPeriodo, setSalvandoPeriodo] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const atualizado = await getPatientById(pacienteInicial.id);
          const pacienteAtual = atualizado || pacienteInicial;
          setPaciente(pacienteAtual);
          setSessoes(await getSessions(pacienteInicial.id));
          setRegistros(await getRecords(pacienteInicial.id));
          if (pacienteAtual.preco_moeda && pacienteAtual.preco_moeda !== 'BRL') {
            getCotacaoCacheada(pacienteAtual.preco_moeda).then(setCotacaoCache);
          }
        } catch (e) {
          Alert.alert('Erro ao carregar', mensagemDeErro(e));
        }
      })();
      getStatusAutorizacao(pacienteInicial.id).then(setAutorizacao);
      getModalidadeDerivada(pacienteInicial.id).then(setModalidadeDerivada);
      getHistoricoParalizacoes(pacienteInicial.id).then(setHistoricoParalizacoes).catch(() => {});
    }, [pacienteInicial.id])
  );

  // ─── Paralisação/retorno cascateiam pra Agenda (item 3) ───────────────
  // Ao paralisar: pergunta se os horários reservados devem ficar disponíveis
  // (e em qual modalidade). Ao voltar: oferece reagendar na hora. O ganho
  // previsto já sai de Financeiro/Recebíveis/Fiscal sozinho assim que
  // data_paralizacao é gravada (getSlotsOcupados em database.js ignora
  // horários de paciente paralisado) — não depende de nenhuma escolha feita
  // nesses popups, então cancelar/fechar não deixa a conta desincronizada.
  async function perguntarModalidadeLiberacao(patientId) {
    Alert.alert(
      'Liberar como qual modalidade?',
      'Os horários liberados aparecerão disponíveis com a modalidade escolhida.',
      [
        { text: 'Cancelar' },
        { text: 'Presencial', onPress: () => confirmarLiberacao(patientId, 'presencial') },
        { text: 'Online', onPress: () => confirmarLiberacao(patientId, 'online') },
      ]
    );
  }

  async function confirmarLiberacao(patientId, modalidade) {
    try {
      await liberarHorariosDoPaciente(patientId, modalidade);
    } catch (e) {
      Alert.alert('Erro ao liberar horários', mensagemDeErro(e));
    }
  }

  async function perguntarLiberacaoHorarios(patientId, nome) {
    try {
      const slots = await getAvailabilitySlotsByPatient(patientId);
      if (!slots || slots.length === 0) return;
      Alert.alert(
        'Liberar horários?',
        `${nome || 'Este analisante'} tem ${slots.length} horário${slots.length === 1 ? '' : 's'} reservado${slots.length === 1 ? '' : 's'} na Agenda. Quer deixá-lo${slots.length === 1 ? '' : 's'} disponível${slots.length === 1 ? '' : 'is'} pra outro agendamento enquanto a análise estiver parada?`,
        [
          { text: 'Não, manter reservados', style: 'cancel' },
          { text: 'Definir modalidade...', onPress: () => perguntarModalidadeLiberacao(patientId) },
          { text: 'Sim, liberar', onPress: () => confirmarLiberacao(patientId, null) },
        ]
      );
    } catch (e) {
      // Não bloqueia o fluxo de paralisação — a paralisação já foi salva.
      console.error('Falha ao checar horários pra liberar:', e?.message || e);
    }
  }

  function perguntarReagendamento(pacienteAlvo) {
    Alert.alert(
      'Retorno à análise',
      'Quer reagendar os horários deste analisante agora?',
      [
        { text: 'Depois', style: 'cancel' },
        { text: 'Reagendar agora', onPress: () => navigation.navigate('PatientForm', { paciente: pacienteAlvo }) },
      ]
    );
  }

  async function alternarParalizacao() {
    const estavaAtiva = !paciente.data_paralizacao;
    setAlternandoParalizacao(true);
    try {
      if (paciente.data_paralizacao) {
        await marcarRetorno(paciente.id);
      } else {
        await marcarParalizacao(paciente.id);
      }
      const [atualizado, historico] = await Promise.all([
        getPatientById(paciente.id),
        getHistoricoParalizacoes(paciente.id),
      ]);
      setPaciente(atualizado);
      setHistoricoParalizacoes(historico);

      if (estavaAtiva) {
        await perguntarLiberacaoHorarios(atualizado.id, atualizado.nome);
      } else {
        perguntarReagendamento(atualizado);
      }
    } catch (e) {
      Alert.alert('Erro', mensagemDeErro(e));
    } finally {
      setAlternandoParalizacao(false);
    }
  }

  // ─── Edição/exclusão de um período já registrado ──────
  // Corrige a causa raiz do item G.20b: cada paralisação/retorno já fica
  // registrado como um período (data_inicio + data_fim) na tabela
  // patient_paralizacoes; o que faltava era poder corrigir uma data errada
  // ou apagar um lançamento feito por engano, sem nunca sobrescrever outros
  // períodos — cada edição resincroniza patients.data_paralizacao a partir
  // do que ficar em aberto (ver editarPeriodoParalizacao em database.js).
  function abrirEdicaoPeriodo(periodo) {
    setPeriodoEmEdicao(periodo);
    setDataInicioEdicao(dataISOParaBR(periodo.data_inicio) || '');
    setDataFimEdicao(periodo.data_fim ? dataISOParaBR(periodo.data_fim) || '' : '');
  }

  function fecharEdicaoPeriodo() {
    setPeriodoEmEdicao(null);
    setDataInicioEdicao('');
    setDataFimEdicao('');
  }

  async function recarregarParalizacoes() {
    const [atualizado, historico] = await Promise.all([
      getPatientById(paciente.id),
      getHistoricoParalizacoes(paciente.id),
    ]);
    setPaciente(atualizado);
    setHistoricoParalizacoes(historico);
  }

  async function salvarEdicaoPeriodo() {
    const inicioISO = dataBRParaISO(dataInicioEdicao);
    if (!inicioISO) {
      Alert.alert('Data inválida', 'Informe a data de início no formato DD/MM/AAAA.');
      return;
    }
    const fimISO = dataFimEdicao ? dataBRParaISO(dataFimEdicao) : null;
    if (dataFimEdicao && !fimISO) {
      Alert.alert('Data inválida', 'Informe a data de fim no formato DD/MM/AAAA, ou deixe em branco se ainda está em aberto.');
      return;
    }
    if (fimISO && fimISO < inicioISO) {
      Alert.alert('Datas inválidas', 'A data de fim não pode ser anterior à data de início.');
      return;
    }
    setSalvandoPeriodo(true);
    try {
      await editarPeriodoParalizacao(periodoEmEdicao.id, paciente.id, { dataInicio: inicioISO, dataFim: fimISO });
      await recarregarParalizacoes();
      fecharEdicaoPeriodo();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvandoPeriodo(false);
    }
  }

  function confirmarExclusaoPeriodo() {
    Alert.alert(
      'Excluir este período?',
      'Isso remove o lançamento do histórico de paralisações. Não dá pra desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setSalvandoPeriodo(true);
            try {
              await excluirPeriodoParalizacao(periodoEmEdicao.id, paciente.id);
              await recarregarParalizacoes();
              fecharEdicaoPeriodo();
            } catch (e) {
              Alert.alert('Erro ao excluir', mensagemDeErro(e));
            } finally {
              setSalvandoPeriodo(false);
            }
          },
        },
      ]
    );
  }

  // ─── Autorização de gravação/transcrição ─────────────
  async function handleSolicitarAutorizacao() {
    if (!paciente.email || !paciente.cpf || !paciente.nascimento) {
      Alert.alert(
        'Dados incompletos',
        'Para solicitar autorização, o cadastro do analisante precisa ter e-mail, CPF e data de nascimento preenchidos.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Editar cadastro', onPress: () => navigation.navigate('PatientForm', { paciente }) },
        ]
      );
      return;
    }

    setEnviandoAutorizacao(true);
    const resultado = await solicitarAutorizacao(paciente);
    setEnviandoAutorizacao(false);

    if (!resultado.ok) {
      Alert.alert('Erro', resultado.error || 'Não foi possível enviar a solicitação.');
      return;
    }
    Alert.alert('E-mail enviado', `Enviamos um e-mail para ${paciente.email} pedindo a confirmação do analisante.`);
    getStatusAutorizacao(paciente.id).then(setAutorizacao);
  }

  // ─── Datas formatadas ──────────────────────────────────
  const idadeText = formatarAnosEMeses(calcularAnosEMeses(paciente.nascimento));
  const tempoAnaliseText = formatarAnosEMeses(calcularAnosEMeses(paciente.data_inicio));
  const tempoParadoText = formatarAnosEMeses(calcularAnosEMeses(paciente.data_paralizacao));

  // ─── Lista unificada ─────────────────────────────────
  const todosItens = [
    ...sessoes.map(s => ({ ...s, _itemType: 'session' })),
    ...registros.map(r => ({ ...r, _itemType: 'record' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // ─── Item 10 (v13): agrupamento em pastas ─────────────
  const secoes = PASTAS
    .map((pasta) => ({
      key: pasta.key,
      title: pasta.titulo,
      data: todosItens.filter((item) => getPastaItem(item) === pasta.key),
    }))
    .filter((secao) => secao.data.length > 0);

  // ─── Formatação de data ──────────────────────────────
  function formatarData(dataStr) {
    if (!dataStr) return '';
    try {
      const d = new Date(dataStr);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return dataStr; }
  }

  // ─── Excluir ─────────────────────────────────────────
  function confirmarExclusao(item) {
    const tipoLabel = getItemTipoLabel(item);
    const titulo = item._itemType === 'session'
      ? `${tipoLabel.label} de ${formatarData(item.date)}`
      : (item.title || 'Registro sem título');

    Alert.alert('Remover item?', `Deseja remover "${titulo}"?\n\nEsta ação não pode ser desfeita.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: async () => {
          setRemovendoItemId(item.id);
          try {
            if (item._itemType === 'session') {
              await deleteSession(item.id);
              setSessoes(await getSessions(paciente.id));
            } else {
              await deleteRecord(item.id);
              setRegistros(await getRecords(paciente.id));
            }
          } catch (e) {
            Alert.alert('Erro ao remover', mensagemDeErro(e));
          } finally {
            setRemovendoItemId(null);
          }
        }
      }
    ]);
  }

  // ─── ✅ ABRIR (visualizar) ───────────────────────────
  function abrirItem(item) {
    if (item._itemType === 'session') {
      navigation.navigate('SessionDetail', {
        sessao: item,
        pacienteNome: paciente.nome || 'Analisante',
      });
    } else {
      navigation.navigate('RecordDetail', {
        record: item,
      });
    }
  }

  // ─── ✅ EDITAR (✏️) ──────────────────────────────────
  function editarItem(item) {
    if (item._itemType === 'session') {
      navigation.navigate('SessionDetail', {
        sessao: item,
        pacienteNome: paciente.nome || 'Analisante',
      });
    } else {
      navigation.navigate('AddRecord', {
        record: item,
        patientId: paciente.id,
      });
    }
  }

  // ─── Render item ─────────────────────────────────────
  function renderItem({ item }) {
    const tipo = getItemTipoLabel(item);
    const preview = item._itemType === 'session' ? item.transcript : item.content;

    // ⚠️ NOVO: badge de autor para registros
    const authorBadge = item._itemType === 'record' && item.author
      ? getAuthorBadge(item.author)
      : null;

    return (
      <View style={styles.itemCard}>
        {/* ✅ Toque no card → VISUALIZAR */}
        <TouchableOpacity
          style={styles.itemLeft}
          onPress={() => abrirItem(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.itemIcone, { backgroundColor: tipo.bg }]}>
            <Ionicons name={tipo.icon} size={18} color={tipo.color} />
          </View>
          <View style={styles.itemInfo}>
            <View style={styles.itemTopRow}>
              <Text style={styles.itemData}>{formatarData(item.date)}</Text>
              {/* ⚠️ MODIFICADO: tags em linha com wrap */}
              <View style={styles.itemTagsRow}>
                <View style={[styles.itemTag, { backgroundColor: tipo.bg }]}>
                  <Text style={[styles.itemTagText, { color: tipo.color }]}>{tipo.label}</Text>
                </View>
                {authorBadge && (
                  <View style={[styles.itemTag, { backgroundColor: authorBadge.bg }]}>
                    <Ionicons name={authorBadge.icon} size={11} color={authorBadge.color} />
                    <Text style={[styles.itemTagText, { color: authorBadge.color }]}>
                      {authorBadge.label}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {item._itemType === 'record' && item.title ? (
              <Text style={styles.itemTitulo} numberOfLines={1}>{item.title}</Text>
            ) : null}
            {preview ? (
              <Text style={styles.itemPreview} numberOfLines={3}>{stripHtml(preview)}</Text>
            ) : (
              <Text style={styles.itemSemConteudo}>
                {item._itemType === 'session' ? 'Sem transcrição' : 'Sem conteúdo'}
              </Text>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.itemActions}>
          {/* ✅ ✏️ → EDITAR */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => editarItem(item)}
            disabled={removendoItemId === item.id}
          >
            <Ionicons name="pencil-outline" size={18} color="#497363" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => confirmarExclusao(item)}
            disabled={removendoItemId === item.id}
          >
            {removendoItemId === item.id
              ? <ActivityIndicator size="small" color="#975451" />
              : <Ionicons name="trash-outline" size={18} color="#A9A299" />}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Header do FlatList (info do paciente) ───────────
  function ListHeader() {
    const autorizacaoInfo = getAutorizacaoInfo(autorizacao);
    return (
      <View>
        {/* Card principal — toque para editar os dados do analisante */}
        <TouchableOpacity
          style={styles.infoCard}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('PatientForm', { paciente })}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(paciente.nome || 'A').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.infoTextos}>
            <Text style={styles.infoNome}>{paciente.nome || 'Analisante'}</Text>
            {paciente.telefone ? (
              <Text style={styles.infoSub}>{paciente.telefone}</Text>
            ) : null}
            {paciente.email ? (
              <Text style={styles.infoSub}>{paciente.email}</Text>
            ) : null}
            {paciente.nascimento ? (
              <Text style={styles.infoSub}>
                {dataISOParaBR(paciente.nascimento) || paciente.nascimento}
                {idadeText ? ` • ${idadeText}` : ''}
              </Text>
            ) : null}
            {paciente.data_inicio ? (
              <Text style={styles.infoSub}>
                Início: {dataISOParaBR(paciente.data_inicio) || paciente.data_inicio}
                {tempoAnaliseText ? ` • ${tempoAnaliseText}` : ''}
              </Text>
            ) : null}
            {paciente.data_paralizacao ? (
              <Text style={styles.infoSub}>
                ⏸ Paralização: {dataISOParaBR(paciente.data_paralizacao) || paciente.data_paralizacao}
                {tempoParadoText ? ` • ${tempoParadoText}` : ''}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color="#A9A299" style={styles.infoCardEditHint} />
        </TouchableOpacity>

        {/* Paralisação ⇄ Retorno da análise (item G.20) */}
        <TouchableOpacity
          style={[styles.btnParalizacao, paciente.data_paralizacao && styles.btnRetorno]}
          onPress={alternarParalizacao}
          disabled={alternandoParalizacao}
        >
          {alternandoParalizacao ? (
            <ActivityIndicator color={paciente.data_paralizacao ? '#44745B' : '#975451'} />
          ) : (
            <Text style={[styles.btnParalizacaoTexto, paciente.data_paralizacao && styles.btnRetornoTexto]}>
              {paciente.data_paralizacao ? '▶ Retorno à análise' : '⏸ Paralisação da análise'}
            </Text>
          )}
        </TouchableOpacity>

        {historicoParalizacoes.length > 0 && (
          <TouchableOpacity onPress={() => setMostrarHistorico((v) => !v)}>
            <Text style={styles.historicoLink}>
              {mostrarHistorico ? '▲ Esconder histórico de paralisações' : `▼ Ver histórico de paralisações (${historicoParalizacoes.length})`}
            </Text>
          </TouchableOpacity>
        )}
        {mostrarHistorico && historicoParalizacoes.map((p) => (
          <TouchableOpacity key={p.id} style={styles.historicoItem} onPress={() => abrirEdicaoPeriodo(p)}>
            <Text style={styles.historicoItemTexto}>
              ⏸ {dataISOParaBR(p.data_inicio) || p.data_inicio}
              {' → '}
              {p.data_fim ? `▶ ${dataISOParaBR(p.data_fim) || p.data_fim}` : 'em aberto'}
            </Text>
            <Ionicons name="pencil-outline" size={17} color="#497363" style={styles.historicoItemEditar} />
          </TouchableOpacity>
        ))}

        {/* Autorização de gravação/transcrição pelo analisante */}
        <View style={styles.cardAutorizacao}>
          <View style={styles.autorizacaoTopo}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#497363" />
            <Text style={styles.autorizacaoTitulo}>Autorização de gravação</Text>
          </View>
          <Text style={[styles.autorizacaoStatus, { color: autorizacaoInfo.cor }]}>
            {autorizacaoInfo.texto}
          </Text>
          <TouchableOpacity
            style={[styles.btnAutorizacao, enviandoAutorizacao && { opacity: 0.6 }]}
            activeOpacity={0.8}
            disabled={enviandoAutorizacao}
            onPress={handleSolicitarAutorizacao}
          >
            <Text style={styles.btnAutorizacaoTexto}>
              {enviandoAutorizacao ? 'Enviando...' : autorizacaoInfo.botao}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divisoria} />

        {/* Acompanhamento */}
        <View style={styles.dadosCard}>
          <InfoRow label="Modalidade" value={getModalidadeLabel(modalidadeDerivada)} icon="desktop-outline" />
          <InfoRow label="Horário" value={paciente.horario} icon="time-outline" />
          <InfoRow label="Preço da sessão" value={getPrecoLabel(paciente, cotacaoCache)} icon="cash-outline" />
          <InfoRow
            label="Dia de pagamento"
            value={paciente.dia_pagamento ? `Todo dia ${paciente.dia_pagamento}` : null}
            icon="card-outline"
          />
          <InfoRow label="Indicação" value={paciente.como_chegou} icon="hand-left-outline" />
          <InfoRow label="Informações importantes" value={paciente.info_relevantes} icon="bookmark-outline" />
        </View>

        {/* Dados administrativos */}
        <View style={styles.dadosCard}>
          <InfoRow label="CPF" value={paciente.cpf} icon="id-card-outline" />
          <InfoRow label="Endereço" value={paciente.endereco} icon="location-outline" />
          <InfoRow label="Telefone de emergência" value={paciente.contato_emergencia} icon="alert-circle-outline" />
        </View>

        {todosItens.length > 0 && (
          <View style={styles.listaHeader}>
            <Text style={styles.listaHeaderText}>
              Histórico ({todosItens.length})
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ─── Cabeçalho de cada pasta (Sessões/Estudos/Outros) ─
  function renderSectionHeader({ section }) {
    return (
      <View style={styles.pastaHeader}>
        <Text style={styles.pastaHeaderText}>{section.title} ({section.data.length})</Text>
      </View>
    );
  }

  // ─── RETORNO PRINCIPAL ───────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header fixo */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {paciente.nome || 'Analisante'}
        </Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Lista em pastas — Sessões / Estudos / Outros (item 10, v13) */}
      <SectionList
        sections={secoes}
        keyExtractor={(item) => `${item._itemType}_${item.id}`}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.lista,
          { paddingBottom: 20 }
        ]}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.vazio}>
            <Ionicons name="leaf-outline" size={34} color="#A8CBBA" style={styles.vazioIcone} />
            <Text style={styles.vazioTexto}>Nenhuma sessão ou registro ainda</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Editar/excluir um período de paralisação já registrado */}
      <Modal
        visible={!!periodoEmEdicao}
        transparent
        animationType="fade"
        onRequestClose={fecharEdicaoPeriodo}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>Editar período de paralisação</Text>

            <Text style={styles.modalLabel}>Início</Text>
            <TextInput
              style={styles.modalInput}
              value={dataInicioEdicao}
              onChangeText={(t) => formatarDataDigitada(t, setDataInicioEdicao)}
              placeholder="DD/MM/AAAA"
              keyboardType="numeric"
              maxLength={10}
            />

            <Text style={styles.modalLabel}>Fim</Text>
            <TextInput
              style={styles.modalInput}
              value={dataFimEdicao}
              onChangeText={(t) => formatarDataDigitada(t, setDataFimEdicao)}
              placeholder="DD/MM/AAAA (vazio = em aberto)"
              keyboardType="numeric"
              maxLength={10}
            />

            <TouchableOpacity
              style={[styles.modalBtnSalvar, salvandoPeriodo && { opacity: 0.6 }]}
              onPress={salvarEdicaoPeriodo}
              disabled={salvandoPeriodo}
            >
              {salvandoPeriodo ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalBtnSalvarTexto}>Salvar</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtnExcluir, salvandoPeriodo && { opacity: 0.6 }]}
              onPress={confirmarExclusaoPeriodo}
              disabled={salvandoPeriodo}
            >
              <Text style={styles.modalBtnExcluirTexto}>Excluir período</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalBtnCancelar} onPress={fecharEdicaoPeriodo} disabled={salvandoPeriodo}>
              <Text style={styles.modalBtnCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── ESTILOS ───────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },

  // Header fixo
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FDFCFA', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  backBtn: { width: 70 },
  backBtnText: { color: '#4D6B88', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '500', color: '#302C28', textAlign: 'center' },

  // Info do paciente
  infoCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FDFCFA',
    marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 16, elevation: 2,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4D6B88',
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '500' },
  infoTextos: { flex: 1 },
  infoNome: { fontSize: 18, fontWeight: '500', color: '#302C28', marginBottom: 4 },
  infoSub: { fontSize: 13, color: '#8C857B', marginTop: 2, lineHeight: 19 },
  infoCardEditHint: { opacity: 0.5, marginLeft: 8, lineHeight: 23 },

  divisoria: {
    height: 1, backgroundColor: '#EAE5DC', marginHorizontal: 16, marginTop: 16,
  },

  // Paralisação ⇄ Retorno
  btnParalizacao: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#F1E4E3', borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#E3C9C7',
  },
  btnParalizacaoTexto: { color: '#975451', fontWeight: '500', fontSize: 14, lineHeight: 20 },
  btnRetorno: { backgroundColor: '#E2EFE8', borderColor: '#C3DFCF' },
  btnRetornoTexto: { color: '#44745B' },
  historicoLink: {
    fontSize: 12.5, color: '#497363', fontWeight: '600',
    marginHorizontal: 16, marginTop: 8,
  },
  historicoItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 4, paddingVertical: 4,
  },
  historicoItemTexto: { fontSize: 12.5, color: '#756E66', lineHeight: 18 },
  historicoItemEditar: { opacity: 0.5, marginLeft: 8, lineHeight: 17 },

  // Modal de edição de período de paralisação
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', backgroundColor: '#FDFCFA', borderRadius: 16, padding: 20, gap: 8,
  },
  modalTitulo: { fontSize: 16, fontWeight: '500', color: '#302C28', marginBottom: 8, lineHeight: 23 },
  modalLabel: { fontSize: 12, fontWeight: '600', color: '#8C857B', textTransform: 'uppercase', lineHeight: 17 },
  modalInput: {
    backgroundColor: '#F7F5F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#302C28', borderWidth: 1, borderColor: '#EAE5DC', marginBottom: 4,
  },
  modalBtnSalvar: {
    backgroundColor: '#497363', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginTop: 8,
  },
  modalBtnSalvarTexto: { color: '#fff', fontWeight: '500', fontSize: 14, lineHeight: 20 },
  modalBtnExcluir: {
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#E3C9C7', marginTop: 4,
  },
  modalBtnExcluirTexto: { color: '#975451', fontWeight: '500', fontSize: 14, lineHeight: 20 },
  modalBtnCancelar: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  modalBtnCancelarTexto: { color: '#8C857B', fontSize: 14, lineHeight: 20 },

  // Card de autorização de gravação/transcrição
  cardAutorizacao: {
    backgroundColor: '#FDFCFA', marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#EAE5DC',
  },
  autorizacaoTopo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  autorizacaoTitulo: { fontSize: 14, fontWeight: '500', color: '#302C28', lineHeight: 20 },
  autorizacaoStatus: { fontSize: 13, marginBottom: 10, lineHeight: 19 },
  btnAutorizacao: {
    backgroundColor: '#E3EAF1', borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#C4D3E0',
  },
  btnAutorizacaoTexto: { fontSize: 13, fontWeight: '500', color: '#497363', lineHeight: 19 },

  // Dados do acompanhamento
  dadosCard: {
    backgroundColor: '#FDFCFA',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12,
  },
  infoRowIcon: { width: 28, marginTop: 2 },
  infoRowContent: { flex: 1 },
  infoRowLabel: {
    fontSize: 12, color: '#8C857B', fontWeight: '600', marginBottom: 2,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoRowValue: { fontSize: 15, color: '#302C28', lineHeight: 20 },

  // Cabeçalho da lista
  listaHeader: {
    marginHorizontal: 16, marginTop: 20, marginBottom: 8,
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  listaHeaderText: {
    fontSize: 15, fontWeight: '500', color: '#302C28',
  },

  // Cabeçalho de pasta (item 10, v13)
  pastaHeader: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 6,
  },
  pastaHeaderText: {
    fontSize: 13, fontWeight: '500', color: '#756E66',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Lista
  lista: { paddingHorizontal: 16 },

  // Cards de item
  itemCard: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'flex-start', elevation: 1,
    marginBottom: 10,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  itemIcone: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, marginTop: 2,
  },
  itemInfo: { flex: 1 },
  itemTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemData: { fontSize: 12, color: '#A9A299', fontWeight: '500', lineHeight: 17 },
  // ⚠️ NOVO estilo: container das tags lado a lado com wrap
  itemTagsRow: {
    flexDirection: 'row', gap: 4, flexWrap: 'wrap', maxWidth: '55%',
  },
  itemTag: {
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  itemTagText: { fontSize: 11, fontWeight: '500', lineHeight: 16 },
  itemTitulo: { fontSize: 15, fontWeight: '500', color: '#302C28', marginBottom: 4, lineHeight: 22 },
  itemPreview: { fontSize: 13, color: '#756E66', lineHeight: 18 },
  itemSemConteudo: { fontSize: 12, color: '#A9A299', marginTop: 4, fontStyle: 'italic', lineHeight: 17 },

  // Ações
  itemActions: {
    flexDirection: 'column', gap: 4, marginLeft: 8, alignItems: 'center',
  },
  actionBtn: { padding: 6 },
  actionBtnText: { fontSize: 18 },

  // Vazio
  vazio: { alignItems: 'center', paddingTop: 48 },
  vazioIcone: { marginBottom: 12 },
  vazioTexto: { fontSize: 15, color: '#A9A299', lineHeight: 22 },
});