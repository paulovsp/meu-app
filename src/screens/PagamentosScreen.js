import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Modal, Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  listarDespesas, adicionarDespesa, removerDespesa,
  getResumoAssinaturaECreditosDoMes, CATEGORIAS_DESPESA, labelCategoria,
} from '../services/despesas';
import { mensagemDeErro } from '../services/erros';
import MenuLateral from '../components/MenuLateral';
import CabecalhoTela from '../components/CabecalhoTela';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  btnBlue: '#497363',
};

const MESES_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PagamentosScreen() {
  const navigation = useNavigation();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1); // 1-12
  const [despesas, setDespesas] = useState([]);
  const [resumoSistema, setResumoSistema] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [modalVisivel, setModalVisivel] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  const [categoria, setCategoria] = useState('outros');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO());
  const [recorrente, setRecorrente] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [lista, resumo] = await Promise.all([
        listarDespesas(ano, mes),
        getResumoAssinaturaECreditosDoMes(ano, mes),
      ]);
      setDespesas(lista);
      setResumoSistema(resumo);
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setCarregando(false);
    }
  }, [ano, mes]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function mudarMes(delta) {
    let novoMes = mes + delta;
    let novoAno = ano;
    if (novoMes > 12) { novoMes = 1; novoAno += 1; }
    if (novoMes < 1) { novoMes = 12; novoAno -= 1; }
    setMes(novoMes);
    setAno(novoAno);
  }

  function abrirModal() {
    setCategoria('outros');
    setDescricao('');
    setValor('');
    setData(hojeISO());
    setRecorrente(false);
    setModalVisivel(true);
  }

  async function salvar() {
    const valorNum = parseFloat(valor.replace(',', '.'));
    if (!descricao.trim()) {
      Alert.alert('Campo obrigatório', 'Descreva a despesa.');
      return;
    }
    if (!valorNum || valorNum <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
      return;
    }
    setSalvando(true);
    try {
      await adicionarDespesa({ categoria, descricao, valor: valorNum, data, recorrente });
      setModalVisivel(false);
      carregar();
    } catch (err) {
      Alert.alert('Erro ao salvar', mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  function handleRemover(item) {
    Alert.alert('Remover despesa', `Remover "${item.descricao}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            await removerDespesa(item.id);
            carregar();
          } catch (err) {
            Alert.alert('Erro', mensagemDeErro(err));
          }
        },
      },
    ]);
  }

  const totalManual = despesas.reduce((soma, d) => soma + Number(d.valor || 0), 0);
  const totalSistema = (resumoSistema?.assinaturaValorBRL || 0) + (resumoSistema?.creditosCompradosBRL || 0);
  const totalGeral = totalManual + totalSistema;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela
        titulo="Pagamentos"
        onVoltar={() => navigation.goBack()}
        acoes={(
          <TouchableOpacity onPress={() => setMenuAberto(true)} style={{ padding: 6 }}>
            <Ionicons name="menu-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      />
      <View style={s.mesRow}>
        <TouchableOpacity onPress={() => mudarMes(-1)} style={s.mesBtn}>
          <Ionicons name="chevron-back" size={20} color={COLORS.btnBlue} />
        </TouchableOpacity>
        <Text style={s.mesLabel}>{MESES_LABEL[mes - 1]} {ano}</Text>
        <TouchableOpacity onPress={() => mudarMes(1)} style={s.mesBtn}>
          <Ionicons name="chevron-forward" size={20} color={COLORS.btnBlue} />
        </TouchableOpacity>
      </View>

      {carregando ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.btnBlue} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollInner}>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Total do mês</Text>
            <Text style={s.totalValor}>{formatarMoeda(totalGeral)}</Text>
          </View>

          <Text style={s.sectionTitle}>Dr.Sig (automático)</Text>
          <View style={s.sistemaCard}>
            <View style={s.sistemaLinha}>
              <Text style={s.sistemaLabel}>
                Assinatura{resumoSistema?.plano ? ` (${resumoSistema.plano})` : ''}
              </Text>
              <Text style={s.sistemaValor}>{formatarMoeda(resumoSistema?.assinaturaValorBRL)}</Text>
            </View>
            <View style={s.sistemaLinha}>
              <Text style={s.sistemaLabel}>Créditos de IA comprados</Text>
              <Text style={s.sistemaValor}>{formatarMoeda(resumoSistema?.creditosCompradosBRL)}</Text>
            </View>
          </View>

          <Text style={s.sectionTitle}>Despesas lançadas</Text>
          {despesas.length === 0 ? (
            <Text style={s.vazio}>Nenhuma despesa lançada neste mês.</Text>
          ) : (
            despesas.map((d) => (
              <View key={d.id} style={s.despesaLinha}>
                <View style={{ flex: 1 }}>
                  <Text style={s.despesaDescricao}>{d.descricao}</Text>
                  <Text style={s.despesaMeta}>
                    {labelCategoria(d.categoria)} · {d.data.split('-').reverse().join('/')}
                    {d.recorrente ? ' · recorrente' : ''}
                  </Text>
                </View>
                <Text style={s.despesaValor}>{formatarMoeda(d.valor)}</Text>
                <TouchableOpacity style={s.removerBtn} onPress={() => handleRemover(d)}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.textMid} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <TouchableOpacity style={s.fab} onPress={abrirModal}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={modalVisivel} transparent animationType="fade" onRequestClose={() => setModalVisivel(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={s.modalScrollWrap} keyboardShouldPersistTaps="handled">
            <View style={s.modalCard}>
              <Text style={s.modalTitulo}>Nova despesa</Text>

              <Text style={s.modalLabel}>Categoria</Text>
              <View style={s.categoriaGrid}>
                {CATEGORIAS_DESPESA.map((c) => (
                  <TouchableOpacity
                    key={c.valor}
                    style={[s.categoriaChip, categoria === c.valor && s.categoriaChipAtivo]}
                    onPress={() => setCategoria(c.valor)}
                  >
                    <Text style={[s.categoriaChipTexto, categoria === c.valor && s.categoriaChipTextoAtivo]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.modalLabel}>Descrição</Text>
              <TextInput
                style={s.modalInput}
                value={descricao}
                onChangeText={setDescricao}
                placeholder="Ex: Aluguel da sala"
                placeholderTextColor="#756E66"
              />

              <Text style={s.modalLabel}>Valor (R$)</Text>
              <TextInput
                style={s.modalInput}
                value={valor}
                onChangeText={setValor}
                placeholder="0,00"
                placeholderTextColor="#756E66"
                keyboardType="decimal-pad"
              />

              <Text style={s.modalLabel}>Data</Text>
              <TextInput
                style={s.modalInput}
                value={data}
                onChangeText={setData}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#756E66"
              />

              <View style={s.recorrenteRow}>
                <Text style={s.modalLabel}>Despesa recorrente (todo mês)</Text>
                <Switch value={recorrente} onValueChange={setRecorrente} />
              </View>

              <View style={s.modalBtnRow}>
                <TouchableOpacity style={s.modalBtnCancelar} onPress={() => setModalVisivel(false)} disabled={salvando}>
                  <Text style={s.modalBtnCancelarText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.modalBtnConfirmar, salvando && { opacity: 0.7 }]} onPress={salvar} disabled={salvando}>
                  {salvando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.modalBtnConfirmarText}>Salvar</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <MenuLateral
        visible={menuAberto}
        onClose={() => setMenuAberto(false)}
        navigation={navigation}
        clinicaButtons={CLINICA_BUTTONS}
        adminButtons={ADMIN_BUTTONS}
        contextual={{
          titulo: 'Pagamentos',
          itens: [
            { icon: 'add-circle-outline', label: 'Nova despesa', onPress: () => abrirModal() },
          ],
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  mesRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20,
    paddingVertical: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  mesBtn: { padding: 6 },
  mesLabel: { fontSize: 16, fontWeight: '500', color: COLORS.textDark, minWidth: 140, textAlign: 'center', lineHeight: 23 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollInner: { padding: 16, paddingBottom: 90 },
  totalCard: {
    backgroundColor: COLORS.btnBlue, borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 20,
  },
  totalLabel: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, lineHeight: 17 },
  totalValor: { fontSize: 28, fontWeight: '500', color: '#FFFFFF', marginTop: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '500', color: COLORS.textDark, marginBottom: 8, marginTop: 4, lineHeight: 20 },
  sistemaCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 20,
    borderWidth: 1, borderColor: COLORS.border, gap: 8,
  },
  sistemaLinha: { flexDirection: 'row', justifyContent: 'space-between' },
  sistemaLabel: { fontSize: 13, color: COLORS.textMid, lineHeight: 19 },
  sistemaValor: { fontSize: 13, fontWeight: '500', color: COLORS.textDark, lineHeight: 19 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 13, marginTop: 12, lineHeight: 19 },
  despesaLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  despesaDescricao: { fontSize: 14, fontWeight: '500', color: COLORS.textDark, lineHeight: 20 },
  despesaMeta: { fontSize: 12, color: COLORS.textMid, marginTop: 2, lineHeight: 17 },
  despesaValor: { fontSize: 14, fontWeight: '500', color: COLORS.textDark, lineHeight: 20 },
  removerBtn: { padding: 4 },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.btnBlue, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 6,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  modalScrollWrap: { padding: 24, justifyContent: 'center', flexGrow: 1 },
  modalCard: { width: '100%', backgroundColor: COLORS.surface, borderRadius: 18, padding: 24 },
  modalTitulo: { fontSize: 18, fontWeight: '500', color: COLORS.textDark, marginBottom: 8 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textDark, marginBottom: 6, marginTop: 12, lineHeight: 19 },
  modalInput: {
    backgroundColor: COLORS.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark, borderWidth: 1, borderColor: COLORS.border,
  },
  categoriaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoriaChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
  },
  categoriaChipAtivo: { backgroundColor: COLORS.btnBlue, borderColor: COLORS.btnBlue },
  categoriaChipTexto: { fontSize: 12.5, fontWeight: '600', color: COLORS.textMid, lineHeight: 18 },
  categoriaChipTextoAtivo: { color: '#FFFFFF' },
  recorrenteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalBtnCancelar: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: COLORS.bg },
  modalBtnCancelarText: { fontSize: 15, fontWeight: '500', color: COLORS.textMid, lineHeight: 22 },
  modalBtnConfirmar: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: COLORS.btnBlue },
  modalBtnConfirmarText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF', lineHeight: 22 },
});
