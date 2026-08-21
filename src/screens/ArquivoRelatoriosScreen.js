import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ScrollView, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listarPacientes, getSessions, getRecords } from '../services/database';
import {
  TIPOS_RELATORIO, OPCOES_ULTIMAS_SESSOES, gerarRelatorio, listarRelatorios, estimarCustoRelatorio,
} from '../services/relatorios';
import { mensagemDeErro } from '../services/erros';
import { formatarSaldoBRL } from '../services/creditosIA';

const COLORS = {
  bg: '#F7F6F3',
  surface: '#FFFFFF',
  border: '#E8E4DD',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
  textLight: '#A5A19A',
  btnBlue: '#3D5A80',
};

function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export default function ArquivoRelatoriosScreen() {
  const navigation = useNavigation();
  const [pacientes, setPacientes] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [carregandoLista, setCarregandoLista] = useState(true);

  const [paciente, setPaciente] = useState(null);
  const [sessoes, setSessoes] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [historicoRelatorios, setHistoricoRelatorios] = useState([]);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  const [quantidadeUltimas, setQuantidadeUltimas] = useState(3);
  const [gerandoTipo, setGerandoTipo] = useState(null);
  const [relatorioAberto, setRelatorioAberto] = useState(null);

  useFocusEffect(
    useCallback(() => {
      listarPacientes()
        .then(setPacientes)
        .catch((err) => Alert.alert('Erro', mensagemDeErro(err)))
        .finally(() => setCarregandoLista(false));
    }, [])
  );

  async function selecionarPaciente(p) {
    setPaciente(p);
    setCarregandoDetalhe(true);
    try {
      const [s, r, h] = await Promise.all([
        getSessions(p.id),
        getRecords(p.id),
        listarRelatorios(p.id),
      ]);
      setSessoes(s);
      setRegistros(r);
      setHistoricoRelatorios(h);
    } catch (err) {
      Alert.alert('Erro ao carregar', mensagemDeErro(err));
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  async function handleGerar(tipo) {
    const tipoInfo = TIPOS_RELATORIO.find((t) => t.valor === tipo);
    const parametros = tipo === 'ultimas_sessoes' ? { quantidade: quantidadeUltimas } : {};

    setGerandoTipo(tipo);
    let custoEstimado;
    try {
      custoEstimado = await estimarCustoRelatorio(paciente, tipo, parametros);
    } catch (err) {
      setGerandoTipo(null);
      Alert.alert('Não foi possível gerar', mensagemDeErro(err));
      return;
    }
    setGerandoTipo(null);

    const mensagem = custoEstimado > 0
      ? `${tipoInfo?.label || tipo}\n\nCusto estimado (no pior caso): até ${formatarSaldoBRL(custoEstimado)}.\n\nGerar mesmo assim?`
      : `${tipoInfo?.label || tipo}\n\nEste relatório é calculado direto no app, sem uso de IA — sem custo. Gerar?`;

    Alert.alert(
      'Confirmar geração',
      mensagem,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Gerar', onPress: () => executarGeracao(tipo, parametros) },
      ]
    );
  }

  async function executarGeracao(tipo, parametros) {
    setGerandoTipo(tipo);
    try {
      const relatorio = await gerarRelatorio(paciente, tipo, parametros);
      setHistoricoRelatorios((atual) => [relatorio, ...atual]);
      setRelatorioAberto(relatorio);
    } catch (err) {
      if (err.assinaturaInativa || err.creditosInsuficientes) {
        Alert.alert('Não foi possível gerar', err.message);
      } else {
        Alert.alert('Erro ao gerar relatório', mensagemDeErro(err));
      }
    } finally {
      setGerandoTipo(null);
    }
  }

  const pacientesFiltrados = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(filtro.toLowerCase())
  );

  if (!paciente) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.buscaWrap}>
          <Ionicons name="search-outline" size={18} color={COLORS.textMid} />
          <TextInput
            style={s.buscaInput}
            value={filtro}
            onChangeText={setFiltro}
            placeholder="Buscar analisante..."
            placeholderTextColor="#B0ADA6"
          />
        </View>

        {carregandoLista ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.btnBlue} />
          </View>
        ) : (
          <FlatList
            data={pacientesFiltrados}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.lista}
            ListEmptyComponent={<Text style={s.vazio}>Nenhum analisante encontrado.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.pacienteLinha} onPress={() => selecionarPaciente(item)}>
                <Text style={s.pacienteNome}>{item.nome}</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.pacienteHeader}>
        <TouchableOpacity onPress={() => setPaciente(null)} style={s.trocarBtn}>
          <Ionicons name="arrow-back" size={18} color={COLORS.btnBlue} />
          <Text style={s.trocarBtnText}>{paciente.nome}</Text>
        </TouchableOpacity>
      </View>

      {carregandoDetalhe ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.btnBlue} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollInner}>
          <Text style={s.sectionTitle}>Gerar relatório</Text>
          {TIPOS_RELATORIO.map((tipo) => (
            <View key={tipo.valor} style={s.relatorioCard}>
              <Text style={s.relatorioLabel}>{tipo.label}</Text>
              {tipo.valor === 'ultimas_sessoes' && (
                <View style={s.chipsRow}>
                  {OPCOES_ULTIMAS_SESSOES.map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={[s.chip, quantidadeUltimas === n && s.chipAtivo]}
                      onPress={() => setQuantidadeUltimas(n)}
                    >
                      <Text style={[s.chipTexto, quantidadeUltimas === n && s.chipTextoAtivo]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity
                style={[s.gerarBtn, gerandoTipo && { opacity: 0.6 }]}
                onPress={() => handleGerar(tipo.valor)}
                disabled={!!gerandoTipo}
              >
                {gerandoTipo === tipo.valor ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={s.gerarBtnText}>Gerar</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}

          {historicoRelatorios.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Relatórios já gerados</Text>
              {historicoRelatorios.map((r) => (
                <TouchableOpacity key={r.id} style={s.itemLinha} onPress={() => setRelatorioAberto(r)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemTitulo}>
                      {TIPOS_RELATORIO.find((t) => t.valor === r.tipo)?.label || r.tipo}
                    </Text>
                    <Text style={s.itemMeta}>{formatarDataHora(r.criado_em)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
                </TouchableOpacity>
              ))}
            </>
          )}

          <Text style={s.sectionTitle}>Sessões ({sessoes.length})</Text>
          {sessoes.length === 0 ? (
            <Text style={s.vazio}>Nenhuma sessão registrada.</Text>
          ) : (
            sessoes.slice(0, 20).map((sess) => (
              <TouchableOpacity
                key={sess.id}
                style={s.itemLinha}
                onPress={() => navigation.navigate('SessionDetail', { sessionId: sess.id })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitulo}>Sessão — {formatarDataHora(sess.date)}</Text>
                  <Text style={s.itemMeta} numberOfLines={1}>{sess.transcript || 'Sem transcrição'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
              </TouchableOpacity>
            ))
          )}

          <Text style={s.sectionTitle}>Registros ({registros.length})</Text>
          {registros.length === 0 ? (
            <Text style={s.vazio}>Nenhum registro adicionado.</Text>
          ) : (
            registros.slice(0, 20).map((reg) => (
              <TouchableOpacity
                key={reg.id}
                style={s.itemLinha}
                onPress={() => navigation.navigate('RecordDetail', { record: reg })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitulo}>{reg.title}</Text>
                  <Text style={s.itemMeta}>{formatarDataHora(reg.created_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!relatorioAberto}
        animationType="slide"
        onRequestClose={() => setRelatorioAberto(null)}
      >
        <SafeAreaView style={s.safe}>
          <View style={s.modalHeader}>
            <Text style={s.modalHeaderTitulo}>
              {TIPOS_RELATORIO.find((t) => t.valor === relatorioAberto?.tipo)?.label || 'Relatório'}
            </Text>
            <TouchableOpacity onPress={() => setRelatorioAberto(null)}>
              <Ionicons name="close" size={26} color={COLORS.textDark} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={s.relatorioConteudo}>{relatorioAberto?.conteudo}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  buscaWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, margin: 16, marginBottom: 8, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  buscaInput: { flex: 1, fontSize: 15, color: COLORS.textDark },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lista: { paddingHorizontal: 16, paddingBottom: 16 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 13, marginTop: 12 },
  pacienteLinha: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  pacienteNome: { fontSize: 15, color: COLORS.textDark, fontWeight: '600' },
  pacienteHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  trocarBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trocarBtnText: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  scrollInner: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginTop: 18, marginBottom: 8 },
  relatorioCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  relatorioLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textDark, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
  },
  chipAtivo: { backgroundColor: COLORS.btnBlue, borderColor: COLORS.btnBlue },
  chipTexto: { fontSize: 13, fontWeight: '700', color: COLORS.textMid },
  chipTextoAtivo: { color: '#FFFFFF' },
  gerarBtn: {
    backgroundColor: COLORS.btnBlue, borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  gerarBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  itemLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  itemTitulo: { fontSize: 14, fontWeight: '600', color: COLORS.textDark },
  itemMeta: { fontSize: 12, color: COLORS.textMid, marginTop: 2 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalHeaderTitulo: { fontSize: 17, fontWeight: '700', color: COLORS.textDark, flex: 1 },
  relatorioConteudo: { fontSize: 14.5, color: COLORS.textDark, lineHeight: 22 },
});
