import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getSessions, getRecords, deleteSession, deleteRecord, parsePreco } from '../services/database';
import { formatarValorMoeda, getCotacaoCacheada } from '../services/currency';

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

// ─── Idade e tempo de análise ──────────────────────────
function calcularAnosEMeses(dataStr) {
  if (!dataStr) return null;
  const hoje = new Date();
  let data;
  if (dataStr.includes('/')) {
    const [d, m, a] = dataStr.split('/').map(Number);
    if (!a || !m || !d) return null;
    data = new Date(a, m - 1, d);
  } else {
    data = new Date(dataStr);
  }
  if (isNaN(data.getTime())) return null;

  let anos = hoje.getFullYear() - data.getFullYear();
  let meses = hoje.getMonth() - data.getMonth();
  if (hoje.getDate() < data.getDate()) meses--;
  if (meses < 0) { anos--; meses += 12; }
  return { anos, meses };
}

function formatarAnosEMeses(obj) {
  if (!obj) return null;
  const { anos, meses } = obj;
  if (!anos && !meses) return '0 meses';
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'ano' : 'anos'}`);
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  return partes.join(' e ');
}

// ─── Preço da sessão (com conversão para Reais, se moeda estrangeira) ──
function getPrecoLabel(paciente) {
  const valor = parsePreco(paciente.preco_sessao);
  if (!valor) return null;
  const moeda = paciente.preco_moeda || 'BRL';
  const formatado = formatarValorMoeda(valor, moeda);
  if (moeda === 'BRL') return formatado;

  const cotacao = getCotacaoCacheada(moeda);
  if (!cotacao?.valor_brl) return formatado;
  return `${formatado}  (≈ ${formatarValorMoeda(valor * cotacao.valor_brl, 'BRL')})`;
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
  const cat = item.category;
  if (cat === 'estudo') return { icon: '📚', label: 'Estudo', color: '#7C3AED', bg: '#F0E8FF' };
  if (cat === 'outro')  return { icon: '📌', label: 'Outro',  color: '#888',   bg: '#F0F0F0' };
  if (item.type === 'image') return { icon: '🖼️', label: 'Imagem', color: '#E06B6B', bg: '#FDE8E8' };
  if (item.type === 'file')  return { icon: '📎', label: 'Arquivo', color: '#888',   bg: '#F0F0F0' };
  return { icon: '📝', label: 'Nota', color: '#7C3AED', bg: '#F0E8FF' };
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
  const { paciente } = route.params;

  const [sessoes, setSessoes] = useState([]);
  const [registros, setRegistros] = useState([]);

  useFocusEffect(
    useCallback(() => {
      setSessoes(getSessions(paciente.id));
      setRegistros(getRecords(paciente.id));
    }, [paciente.id])
  );

  // ─── Datas formatadas ──────────────────────────────────
  const idadeText = formatarAnosEMeses(calcularAnosEMeses(paciente.nascimento));
  const tempoAnaliseText = formatarAnosEMeses(calcularAnosEMeses(paciente.data_inicio));

  // ─── Lista unificada ─────────────────────────────────
  const todosItens = [
    ...sessoes.map(s => ({ ...s, _itemType: 'session' })),
    ...registros.map(r => ({ ...r, _itemType: 'record' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

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
        onPress: () => {
          if (item._itemType === 'session') {
            deleteSession(item.id);
            setSessoes(getSessions(paciente.id));
          } else {
            deleteRecord(item.id);
            setRegistros(getRecords(paciente.id));
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
          <TouchableOpacity style={styles.actionBtn} onPress={() => editarItem(item)}>
            <Text style={styles.actionBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => confirmarExclusao(item)}>
            <Text style={styles.actionBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Header do FlatList (info do paciente) ───────────
  function ListHeader() {
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
                🎂 {paciente.nascimento}
                {idadeText ? ` • ${idadeText}` : ''}
              </Text>
            ) : null}
            {paciente.data_inicio ? (
              <Text style={styles.infoSub}>
                🗓 Início: {paciente.data_inicio}
                {tempoAnaliseText ? ` • ${tempoAnaliseText}` : ''}
              </Text>
            ) : null}
          </View>
          <Text style={styles.infoCardEditHint}>✏️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnPerfilPsicossomatico}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('PerfilPsicossomatico', { paciente })}
        >
          <Ionicons name="analytics-outline" size={18} color="#3D5A80" />
          <Text style={styles.btnPerfilPsicossomaticoTexto}>Perfil Psicossomático</Text>
          <Ionicons name="chevron-forward" size={16} color="#3D5A80" />
        </TouchableOpacity>
        <View style={styles.divisoria} />

        {/* Dados do acompanhamento (sem título) */}
        <View style={styles.dadosCard}>
          <InfoRow label="Horário" value={paciente.horario} icon="🕐" />
          <InfoRow label="CPF" value={paciente.cpf} icon="🪪" />
          <InfoRow label="Preço da sessão" value={getPrecoLabel(paciente)} icon="💰" />
          <InfoRow
            label="Dia de pagamento"
            value={paciente.dia_pagamento ? `Todo dia ${paciente.dia_pagamento}` : null}
            icon="💳"
          />
          <InfoRow label="Modalidade" value={getModalidadeLabel(paciente.modalidade)} icon="🖥️" />
          <InfoRow label="Endereço" value={paciente.endereco} icon="📍" />
          <InfoRow label="Contato de emergência" value={paciente.contato_emergencia} icon="🚨" />
          <InfoRow label="Como chegou" value={paciente.como_chegou} icon="👋" />
          <InfoRow label="Informações relevantes" value={paciente.info_relevantes} icon="📌" />
        </View>

        {/* Separador da lista */}
        <View style={styles.listaHeader}>
          <Text style={styles.listaHeaderText}>
            Histórico ({todosItens.length})
          </Text>
        </View>
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

      {/* Lista única com header */}
      <FlatList
        data={todosItens}
        keyExtractor={(item) => `${item._itemType}_${item.id}`}
        renderItem={renderItem}
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

  // Botão do Perfil Psicossomático + barra divisória
  btnPerfilPsicossomatico: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#EBF3FB', marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: '#C7D9EC',
  },
  btnPerfilPsicossomaticoTexto: { fontSize: 14, fontWeight: '700', color: '#3D5A80' },
  divisoria: {
    height: 1, backgroundColor: '#E0E4EA', marginHorizontal: 16, marginTop: 16,
  },

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