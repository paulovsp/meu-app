// Seletor de Cidade/UF em 2 passos (estado -> cidade), pra garantir que o
// cadastro/perfil só aceite uma combinação real do IBGE — sem isso o campo
// era texto livre e aceitava qualquer coisa digitada.
import { useState, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ESTADOS_BR, buscarCidadesPorUF } from '../services/localidades';

const COLORS = { azul: '#497363', textDark: '#302C28', textMid: '#756E66', border: '#EAE5DC', bg: '#F7F5F0' };

export default function SeletorCidadeEstado({ visible, onClose, ufInicial, onConfirmar }) {
  const [passo, setPasso] = useState('uf');
  const [ufSelecionada, setUfSelecionada] = useState(ufInicial || null);
  const [busca, setBusca] = useState('');
  const [cidades, setCidades] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!visible) return;
    setPasso(ufInicial ? 'cidade' : 'uf');
    setUfSelecionada(ufInicial || null);
    setBusca('');
  }, [visible, ufInicial]);

  useEffect(() => {
    if (passo !== 'cidade' || !ufSelecionada) return;
    let cancelado = false;
    setCarregando(true);
    setErro('');
    buscarCidadesPorUF(ufSelecionada)
      .then((lista) => { if (!cancelado) setCidades(lista); })
      .catch((e) => { if (!cancelado) setErro(e.message || 'Falha ao carregar cidades.'); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [passo, ufSelecionada]);

  const estadosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return ESTADOS_BR;
    return ESTADOS_BR.filter(
      (e) => e.nome.toLowerCase().includes(termo) || e.sigla.toLowerCase().includes(termo)
    );
  }, [busca]);

  const cidadesFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return cidades;
    return cidades.filter((c) => c.toLowerCase().includes(termo));
  }, [busca, cidades]);

  function escolherUf(sigla) {
    setUfSelecionada(sigla);
    setBusca('');
    setPasso('cidade');
  }

  function escolherCidade(nome) {
    onConfirmar({ cidade: nome, uf: ufSelecionada });
  }

  function voltarParaUf() {
    setPasso('uf');
    setBusca('');
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          {passo === 'cidade' ? (
            <TouchableOpacity onPress={voltarParaUf} style={s.headerBtn}>
              <Ionicons name="chevron-back" size={24} color={COLORS.azul} />
            </TouchableOpacity>
          ) : (
            <View style={s.headerBtn} />
          )}
          <Text style={s.headerTitle}>
            {passo === 'uf' ? 'Escolha o estado' : `Cidade em ${ufSelecionada}`}
          </Text>
          <TouchableOpacity onPress={onClose} style={s.headerBtn}>
            <Ionicons name="close" size={24} color={COLORS.textMid} />
          </TouchableOpacity>
        </View>

        <TextInput
          style={s.busca}
          value={busca}
          onChangeText={setBusca}
          placeholder={passo === 'uf' ? 'Buscar estado...' : 'Buscar cidade...'}
          placeholderTextColor="#756E66"
          autoCorrect={false}
        />

        {passo === 'uf' ? (
          <FlatList
            data={estadosFiltrados}
            keyExtractor={(item) => item.sigla}
            contentContainerStyle={s.lista}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.item} onPress={() => escolherUf(item.sigla)}>
                <Text style={s.itemSigla}>{item.sigla}</Text>
                <Text style={s.itemNome}>{item.nome}</Text>
              </TouchableOpacity>
            )}
          />
        ) : carregando ? (
          <View style={s.centro}>
            <ActivityIndicator color={COLORS.azul} size="large" />
          </View>
        ) : erro ? (
          <View style={s.centro}>
            <Text style={s.erroTexto}>{erro}</Text>
            <TouchableOpacity style={s.tentarBtn} onPress={() => setPasso('cidade')}>
              <Text style={s.tentarBtnTexto}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={cidadesFiltradas}
            keyExtractor={(item) => item}
            contentContainerStyle={s.lista}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.item} onPress={() => escolherCidade(item)}>
                <Text style={s.itemNome}>{item}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={s.vazio}>Nenhuma cidade encontrada.</Text>}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDFCFA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '500', color: COLORS.textDark, lineHeight: 23 },
  busca: {
    margin: 16, marginBottom: 8, backgroundColor: COLORS.bg, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: COLORS.textDark,
    borderWidth: 1, borderColor: COLORS.border,
  },
  lista: { paddingHorizontal: 16, paddingBottom: 24 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1EDE5',
  },
  itemSigla: {
    fontSize: 13, fontWeight: '500', color: '#fff', backgroundColor: COLORS.azul,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden',
  },
  itemNome: { fontSize: 15, color: COLORS.textDark, lineHeight: 22 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30 },
  erroTexto: { fontSize: 14, color: '#975451', textAlign: 'center', lineHeight: 20 },
  tentarBtn: { backgroundColor: COLORS.azul, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  tentarBtnTexto: { color: '#fff', fontWeight: '500' },
  vazio: { textAlign: 'center', color: COLORS.textMid, marginTop: 30, fontSize: 14, lineHeight: 20 },
});
