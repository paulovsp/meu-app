import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SectionList, Alert, ActivityIndicator
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getSessions, getRecords, deleteSession, deleteRecord, parsePreco, getPatientById, getModalidadeDerivada,
  getHistoricoParalizacoes, marcarParalizacao, marcarRetorno,
  getAvailabilitySlotsByPatient, liberarHorariosDoPaciente,
} from '../services/database';
import { formatarValorMoeda, getCotacaoCacheada } from '../services/currency';
import { solicitarAutorizacao, getStatusAutorizacao } from '../services/autorizacaoGravacao';
import { mensagemDeErro } from '../services/erros';
import { dataISOParaBR, calcularAnosEMeses, formatarAnosEMeses } from '../services/validacao';

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
    return { texto: 'Ainda não solicitada', cor: '#888', botao: 'Solicitar autorização' };
  }
  if (autorizacao.status === 'autorizada') {
    const data = autorizacao.respondido_em
      ? new Date(autorizacao.respondido_em).toLocaleDateString('pt-BR')
      : '';
    return { texto: `Autorizada${data ? ` em ${data}` : ''}`, cor: '#2E8B57', botao: 'Solicitar novamente' };
  }
  if (autorizacao.status === 'negada') {
    return { texto: 'Não autorizada pelo analisante', cor: '#C0392B', botao: 'Solicitar novamente' };
  }

  // status === 'pendente' — ainda sem resposta, ou já tentou enviar o
  // documento e a conferência automática rejeitou (continua pendente até
  // esgotar as 5 tentativas ou o analisante conseguir enviar um válido).
  const motivo = MOTIVO_REJEICAO_LABEL[autorizacao.motivo_rejeicao];
  const bloqueada = (autorizacao.tentativas || 0) >= 5;
  if (bloqueada) {
    return {
      texto: `Bloqueada — esgotou as tentativas${motivo ? ` (${motivo})` : ''}`,
      cor: '#C0392B',
      botao: 'Solicitar novamente',
    };
  }
  if (motivo) {
    return {
      texto: `Aguardando reenvio — última tentativa falhou (${motivo})`,
      cor: '#F09B4A',
      botao: 'Reenviar e-mail',
    };
  }
  return { texto: 'Aguardando confirmação do analisante', cor: '#F09B4A', botao: 'Reenviar e-mail' };
}

// ⚠️ NOVO: Badge de autor para registros
function getAuthorBadge(author) {
  switch (author) {
    case 'analyst':   return { icon: '🧑‍⚕️', label: 'A.',   color: '#4A90D9', bg: '#EBF3FB' };
    case 'analysand': return { icon: '🗣️', label: 'P.',    color: '#F57C00', bg: '#FFF8E1' };
    case 'alternado': return { icon: '🔄', label: 'A/P',  color: '#7C3AED', bg: '#F0E8FF' };
    default:          return null;
  }
}

function getItemTipoLabel(item) {
  if (item._itemType === 'session') {
    return item.transcript
      ? { icon: '🎙️', label: 'Sessão Transcrita', color: '#4A90D9', bg: '#E8F4FD' }
      : { icon: '📝', label: 'Sessão Anotada',   color: '#F09B4A', bg: '#FFF3E8' };
  }
  // Registros salvos antes da correção do Novo Registro gravavam o tipo
  // (sessão/estudo/outro) na coluna `type` por engano, em vez de `category`
  // — sem esse fallback, todo registro antigo caía no rótulo genérico "Nota".
  const cat = item.category || (['sessao', 'estudo', 'outro'].includes(item.type) ? item.type : null);
  if (cat === 'sessao') return { icon: '📝', label: 'Sessão Anotada', color: '#F09B4A', bg: '#FFF3E8' };
  if (cat === 'estudo') return { icon: '📚', label: 'Estudo', color: '#7C3AED', bg: '#F0E8FF' };
  if (cat === 'outro')  return { icon: '📌', label: 'Outro',  color: '#888',   bg: '#F0F0F0' };
  if (item.type === 'image') return { icon: '🖼️', label: 'Imagem', color: '#E06B6B', bg: '#FDE8E8' };
  if (item.type === 'file')  return { icon: '📎', label: 'Arquivo', color: '#888',   bg: '#F0F0F0' };
  return { icon: '📝', label: 'Nota', color: '#7C3AED', bg: '#F0E8FF' };
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
      <Text style={styles.infoRowIcon}>{icon}</Text>
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
          <Text style={styles.itemIcone}>{tipo.icon}</Text>
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
                    <Text style={[styles.itemTagText, { color: authorBadge.color }]}>
                      {authorBadge.icon} {authorBadge.label}
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
            <Text style={styles.actionBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => confirmarExclusao(item)}
            disabled={removendoItemId === item.id}
          >
            {removendoItemId === item.id
              ? <ActivityIndicator size="small" color="#c0392b" />
              : <Text style={styles.actionBtnText}>🗑️</Text>}
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
              <Text style={styles.infoSub}>📞 {paciente.telefone}</Text>
            ) : null}
            {paciente.email ? (
              <Text style={styles.infoSub}>✉️ {paciente.email}</Text>
            ) : null}
            {paciente.nascimento ? (
              <Text style={styles.infoSub}>
                🎂 {dataISOParaBR(paciente.nascimento) || paciente.nascimento}
                {idadeText ? ` • ${idadeText}` : ''}
              </Text>
            ) : null}
            {paciente.data_inicio ? (
              <Text style={styles.infoSub}>
                🗓 Início: {dataISOParaBR(paciente.data_inicio) || paciente.data_inicio}
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
          <Text style={styles.infoCardEditHint}>✏️</Text>
        </TouchableOpacity>

        {/* Paralisação ⇄ Retorno da análise (item G.20) */}
        <TouchableOpacity
          style={[styles.btnParalizacao, paciente.data_paralizacao && styles.btnRetorno]}
          onPress={alternarParalizacao}
          disabled={alternandoParalizacao}
        >
          {alternandoParalizacao ? (
            <ActivityIndicator color={paciente.data_paralizacao ? '#1e9e63' : '#c0392b'} />
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
          <View key={p.id} style={styles.historicoItem}>
            <Text style={styles.historicoItemTexto}>
              ⏸ {dataISOParaBR(p.data_inicio) || p.data_inicio}
              {' → '}
              {p.data_fim ? `▶ ${dataISOParaBR(p.data_fim) || p.data_fim}` : 'em aberto'}
            </Text>
          </View>
        ))}

        {/* Autorização de gravação/transcrição pelo analisante */}
        <View style={styles.cardAutorizacao}>
          <View style={styles.autorizacaoTopo}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#3D5A80" />
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
          <InfoRow label="Modalidade" value={getModalidadeLabel(modalidadeDerivada)} icon="🖥️" />
          <InfoRow label="Horário" value={paciente.horario} icon="🕐" />
          <InfoRow label="Preço da sessão" value={getPrecoLabel(paciente, cotacaoCache)} icon="💰" />
          <InfoRow
            label="Dia de pagamento"
            value={paciente.dia_pagamento ? `Todo dia ${paciente.dia_pagamento}` : null}
            icon="💳"
          />
          <InfoRow label="Indicação" value={paciente.como_chegou} icon="👋" />
          <InfoRow label="Informações importantes" value={paciente.info_relevantes} icon="📌" />
        </View>

        {/* Dados administrativos */}
        <View style={styles.dadosCard}>
          <InfoRow label="CPF" value={paciente.cpf} icon="🪪" />
          <InfoRow label="Endereço" value={paciente.endereco} icon="📍" />
          <InfoRow label="Telefone de emergência" value={paciente.contato_emergencia} icon="🚨" />
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
            <Text style={styles.vazioIcone}>📭</Text>
            <Text style={styles.vazioTexto}>Nenhuma sessão ou registro ainda</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

// ─── ESTILOS ───────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },

  // Header fixo
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backBtn: { width: 70 },
  backBtnText: { color: '#4A90D9', fontSize: 15, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#1A1A2E', textAlign: 'center' },

  // Info do paciente
  infoCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 16, elevation: 2,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4A90D9',
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  infoTextos: { flex: 1 },
  infoNome: { fontSize: 18, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  infoSub: { fontSize: 13, color: '#888', marginTop: 2 },
  infoCardEditHint: { fontSize: 16, opacity: 0.5, marginLeft: 8 },

  divisoria: {
    height: 1, backgroundColor: '#E0E4EA', marginHorizontal: 16, marginTop: 16,
  },

  // Paralisação ⇄ Retorno
  btnParalizacao: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#FCEBEA', borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#E5A19B',
  },
  btnParalizacaoTexto: { color: '#c0392b', fontWeight: '700', fontSize: 14 },
  btnRetorno: { backgroundColor: '#E6F5EE', borderColor: '#9ED9BE' },
  btnRetornoTexto: { color: '#1e9e63' },
  historicoLink: {
    fontSize: 12.5, color: '#3D5A80', fontWeight: '600',
    marginHorizontal: 16, marginTop: 8,
  },
  historicoItem: { marginHorizontal: 16, marginTop: 4 },
  historicoItemTexto: { fontSize: 12.5, color: '#6B6860' },

  // Card de autorização de gravação/transcrição
  cardAutorizacao: {
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E0E4EA',
  },
  autorizacaoTopo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  autorizacaoTitulo: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  autorizacaoStatus: { fontSize: 13, marginBottom: 10 },
  btnAutorizacao: {
    backgroundColor: '#EBF3FB', borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#C7D9EC',
  },
  btnAutorizacaoTexto: { fontSize: 13, fontWeight: '700', color: '#3D5A80' },

  // Dados do acompanhamento
  dadosCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12,
  },
  infoRowIcon: { fontSize: 18, width: 28, marginTop: 2 },
  infoRowContent: { flex: 1 },
  infoRowLabel: {
    fontSize: 12, color: '#888', fontWeight: '600', marginBottom: 2,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoRowValue: { fontSize: 15, color: '#1A1A2E', lineHeight: 20 },

  // Cabeçalho da lista
  listaHeader: {
    marginHorizontal: 16, marginTop: 20, marginBottom: 8,
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E0E4EA',
  },
  listaHeaderText: {
    fontSize: 15, fontWeight: '700', color: '#1A1A2E',
  },

  // Cabeçalho de pasta (item 10, v13)
  pastaHeader: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 6,
  },
  pastaHeaderText: {
    fontSize: 13, fontWeight: '700', color: '#6B6860',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Lista
  lista: { paddingHorizontal: 16 },

  // Cards de item
  itemCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'flex-start', elevation: 1,
    marginBottom: 10,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  itemIcone: { fontSize: 28, marginRight: 12, marginTop: 2 },
  itemInfo: { flex: 1 },
  itemTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemData: { fontSize: 12, color: '#aaa', fontWeight: '500' },
  // ⚠️ NOVO estilo: container das tags lado a lado com wrap
  itemTagsRow: {
    flexDirection: 'row', gap: 4, flexWrap: 'wrap', maxWidth: '55%',
  },
  itemTag: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  itemTagText: { fontSize: 11, fontWeight: '700' },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  itemPreview: { fontSize: 13, color: '#666', lineHeight: 18 },
  itemSemConteudo: { fontSize: 12, color: '#bbb', marginTop: 4, fontStyle: 'italic' },

  // Ações
  itemActions: {
    flexDirection: 'column', gap: 4, marginLeft: 8, alignItems: 'center',
  },
  actionBtn: { padding: 6 },
  actionBtnText: { fontSize: 18 },

  // Vazio
  vazio: { alignItems: 'center', paddingTop: 48 },
  vazioIcone: { fontSize: 48, marginBottom: 12 },
  vazioTexto: { fontSize: 15, color: '#aaa' },
});