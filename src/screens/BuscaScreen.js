import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { listarPacientes } from '../services/database';
import {
  montarContextoSelecionados, estimarCustoResposta, chamarBuscaChat, criarSessaoRedacao,
  CreditosInsuficientesError, AssinaturaInativaError,
} from '../services/buscaChat';
import { formatarSaldoBRL } from '../services/creditosIA';
import { mensagemDeErro } from '../services/erros';
import { MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

// Estado sobrevive fora do componente — a tela é remontada sempre que sai
// da pilha de navegação (ex: Início → Analisantes → Busca de novo), então um
// useState local sozinho perderia a seleção e a conversa em andamento. Só
// reseta quando a própria pessoa aperta "limpar" — esse botão é o que
// representa "fechar a janela da Busca Dr.Sig": até ele ser apertado, cada
// pergunta nova reenvia `trocas` inteiro como histórico da conversa (a IA
// tem memória do que já foi perguntado/respondido nesta janela); depois
// dele, uma conversa nova começa do zero, inclusive com um registro de
// pseudonimização (`sessaoRedacao`) novo.
const estadoPersistente = {
  selecionadosIds: [],
  pergunta: '',
  trocas: [],
  sessaoRedacao: criarSessaoRedacao(),
};

function Troca({ item }) {
  return (
    <View style={s.troca}>
      <View style={[s.bolha, s.bolhaUsuario]}>
        <Text style={s.bolhaNomes}>{item.nomes}</Text>
        <Text style={[s.bolhaTexto, s.bolhaTextoUsuario]}>{item.pergunta}</Text>
      </View>
      <View style={[s.bolha, s.bolhaAssistente]}>
        <Text style={s.bolhaTexto}>{item.resposta}</Text>
        <Text style={s.bolhaCusto}>Custo: {formatarSaldoBRL(item.custo)}</Text>
      </View>
    </View>
  );
}

export default function BuscaScreen() {
  const navigation = useNavigation();
  const [pessoas, setPessoas] = useState([]);
  const [selecionadosIds, setSelecionadosIds] = useState(estadoPersistente.selecionadosIds);
  const [seletorAberto, setSeletorAberto] = useState(estadoPersistente.selecionadosIds.length === 0);
  const [pergunta, setPergunta] = useState(estadoPersistente.pergunta);
  const [trocas, setTrocas] = useState(estadoPersistente.trocas);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const listRef = useRef(null);

  useFocusEffect(useCallback(() => {
    listarPacientes().then(setPessoas).catch(() => {}).finally(() => setCarregando(false));
  }, []));

  useEffect(() => { estadoPersistente.selecionadosIds = selecionadosIds; }, [selecionadosIds]);
  useEffect(() => { estadoPersistente.pergunta = pergunta; }, [pergunta]);
  useEffect(() => { estadoPersistente.trocas = trocas; }, [trocas]);

  function limpar() {
    setSelecionadosIds([]);
    setPergunta('');
    setTrocas([]);
    setSeletorAberto(true);
    estadoPersistente.selecionadosIds = [];
    estadoPersistente.trocas = [];
    estadoPersistente.sessaoRedacao = criarSessaoRedacao();
  }

  function alternarPessoa(id) {
    setSelecionadosIds((atual) => (
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]
    ));
  }

  function alternarTodos() {
    setSelecionadosIds((atual) => (
      atual.length === pessoas.length ? [] : pessoas.map((p) => p.id)
    ));
  }

  async function enviar() {
    const texto = pergunta.trim();
    if (!texto || enviando) return;
    if (selecionadosIds.length === 0) {
      Alert.alert('Selecione ao menos uma pessoa', 'Marque na lista quem você quer que a IA consulte antes de perguntar.');
      return;
    }

    const selecionados = pessoas.filter((p) => selecionadosIds.includes(p.id));
    const { contexto } = await montarContextoSelecionados(selecionados, estadoPersistente.sessaoRedacao);
    const historicoAnterior = trocas.flatMap((t) => ([
      { role: 'user', content: t.pergunta },
      { role: 'assistant', content: t.resposta },
    ]));
    const historicoCompleto = [...historicoAnterior, { role: 'user', content: texto }];
    const custoEstimado = estimarCustoResposta({ contexto, historico: historicoCompleto });
    const nomes = selecionados.map((p) => p.nome).join(', ');

    Alert.alert(
      'Confirmar pergunta',
      `Sobre: ${nomes}.\n\nCusto estimado (no pior caso): até ${formatarSaldoBRL(custoEstimado)}.\n\nEnviar mesmo assim?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: () => processarEnvio(texto, contexto, historicoCompleto, nomes) },
      ]
    );
  }

  async function processarEnvio(texto, contexto, historicoCompleto, nomes) {
    setPergunta('');
    setEnviando(true);
    try {
      const { texto: resposta, custo } = await chamarBuscaChat(historicoCompleto, contexto, estadoPersistente.sessaoRedacao);
      setTrocas((prev) => [...prev, { id: `t-${Date.now()}`, pergunta: texto, resposta, custo, nomes }]);
    } catch (e) {
      if (e instanceof AssinaturaInativaError) {
        Alert.alert('Assinatura inativa', MENSAGEM_ASSINATURA_INATIVA);
      } else if (e instanceof CreditosInsuficientesError) {
        Alert.alert('Créditos de IA insuficientes', 'Fale com o administrador da conta pra recarregar.');
      } else {
        Alert.alert('Erro ao responder', mensagemDeErro(e, 'Tente novamente.'));
      }
    } finally {
      setEnviando(false);
    }
  }

  const todosSelecionados = pessoas.length > 0 && selecionadosIds.length === pessoas.length;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <CabecalhoTela
        titulo="Busca Dr.Sig"
        onVoltar={() => navigation.goBack()}
        acoes={(
          <TouchableOpacity onPress={limpar} style={{ padding: 6 }}>
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <TouchableOpacity style={s.seletorHeader} onPress={() => setSeletorAberto((v) => !v)}>
          <Text style={s.seletorHeaderTexto}>
            {selecionadosIds.length === 0
              ? 'Selecionar analisantes/supervisionandos'
              : `${selecionadosIds.length} selecionado${selecionadosIds.length > 1 ? 's' : ''}`}
          </Text>
          <Ionicons name={seletorAberto ? 'chevron-up' : 'chevron-down'} size={18} color="#497363" />
        </TouchableOpacity>

        {seletorAberto && (
          carregando ? (
            <ActivityIndicator style={{ marginVertical: 12 }} color="#497363" />
          ) : pessoas.length === 0 ? (
            <Text style={s.seletorVazio}>Nenhum analisante ou supervisionando cadastrado ainda.</Text>
          ) : (
            <ScrollView style={s.seletorLista} contentContainerStyle={s.seletorListaConteudo}>
              <TouchableOpacity
                style={[s.chip, todosSelecionados && s.chipSelecionado]}
                onPress={alternarTodos}
              >
                <Text style={[s.chipTexto, todosSelecionados && s.chipTextoSelecionado]}>
                  {todosSelecionados ? '• ' : ''}Selecionar todos
                </Text>
              </TouchableOpacity>
              {pessoas.map((pessoa) => {
                const selecionado = selecionadosIds.includes(pessoa.id);
                return (
                  <TouchableOpacity
                    key={pessoa.id}
                    style={[s.chip, selecionado && s.chipSelecionado]}
                    onPress={() => alternarPessoa(pessoa.id)}
                  >
                    <Text style={[s.chipTexto, selecionado && s.chipTextoSelecionado]}>
                      {selecionado ? '• ' : ''}{pessoa.nome}
                      {pessoa.eh_supervisionando ? ' (supervisão)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )
        )}

        <FlatList
          ref={listRef}
          data={trocas}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <Troca item={item} />}
          contentContainerStyle={s.lista}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={(
            <Text style={s.dica}>
              Selecione quem você quer consultar, escreva a pergunta e envie. A IA guarda memória
              desta conversa até você apertar "limpar" — depois disso, uma conversa nova começa do
              zero.
            </Text>
          )}
        />

        {enviando && (
          <View style={s.digitando}>
            <ActivityIndicator size="small" color="#497363" />
            <Text style={s.digitandoTexto}>Consultando...</Text>
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Escreva sua pergunta..."
            placeholderTextColor="#8C857B"
            value={pergunta}
            onChangeText={setPergunta}
            multiline
          />
          <TouchableOpacity
            style={[s.enviarBtn, (!pergunta.trim() || enviando) && s.enviarBtnDesabilitado]}
            onPress={enviar}
            disabled={!pergunta.trim() || enviando}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },

  seletorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FDFCFA', borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  seletorHeaderTexto: { fontSize: 14, fontWeight: '500', color: '#497363', lineHeight: 20 },
  seletorVazio: { fontSize: 13, color: '#8C857B', padding: 16, backgroundColor: '#FDFCFA', lineHeight: 19 },
  seletorLista: { maxHeight: 160, backgroundColor: '#FDFCFA' },
  seletorListaConteudo: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    padding: 12, paddingTop: 8,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#F7F5F0', borderWidth: 1, borderColor: '#EAE5DC',
  },
  chipSelecionado: { backgroundColor: '#497363', borderColor: '#497363' },
  chipTexto: { fontSize: 13, fontWeight: '600', color: '#756E66', lineHeight: 19 },
  chipTextoSelecionado: { color: '#fff' },

  lista: { padding: 16, gap: 14, flexGrow: 1 },
  dica: { fontSize: 13, color: '#8C857B', textAlign: 'center', marginTop: 24, lineHeight: 19 },

  troca: { gap: 8 },
  bolha: {
    maxWidth: '92%',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bolhaAssistente: {
    backgroundColor: '#FDFCFA',
    borderWidth: 1,
    borderColor: '#EAE5DC',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bolhaUsuario: {
    backgroundColor: '#497363',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bolhaNomes: { fontSize: 11, color: '#C4D3E0', marginBottom: 4, fontWeight: '600', lineHeight: 16 },
  bolhaTexto: { fontSize: 14, color: '#302C28', lineHeight: 20 },
  bolhaTextoUsuario: { color: '#fff' },
  bolhaCusto: { fontSize: 11, color: '#8C857B', marginTop: 6, lineHeight: 16 },

  digitando: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingBottom: 6,
  },
  digitandoTexto: { fontSize: 12, color: '#8C857B', lineHeight: 17 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#EAE5DC',
    backgroundColor: '#FDFCFA',
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: '#F7F5F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#302C28',
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  enviarBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#497363',
    alignItems: 'center', justifyContent: 'center',
  },
  enviarBtnDesabilitado: { backgroundColor: '#A9A299' },
});
