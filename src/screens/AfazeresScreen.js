import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import {
  listarAfazeres, adicionarAfazer, alternarAfazer, removerAfazer, reordenarAfazeres,
} from '../services/afazeres';
import { mensagemDeErro } from '../services/erros';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  btnBlue: '#497363',
};

// Espaço entre uma linha e a seguinte. Entra na conta de onde cada linha
// começa — sem ele, o alvo do arraste erra por 10px por item, e o erro se
// acumula até apontar pra linha errada no fim da lista.
const MARGEM_LINHA = 10;

export default function AfazeresScreen() {
  const navigation = useNavigation();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState('');
  const [adicionando, setAdicionando] = useState(false);

  // ── Arraste ───────────────────────────────────────────────────────────
  // A linha arrastada flutua atrás do dedo e uma marca mostra onde ela vai
  // cair; a lista embaixo não se mexe. É de propósito: reordenar o array
  // durante o arraste obriga a corrigir a origem do deslocamento a cada
  // troca, e é justamente aí que esse tipo de tela costuma ficar
  // "escorregadia". Uma única reordenação, ao soltar.
  const [arrastandoIndex, setArrastandoIndex] = useState(null);
  const [alvoIndex, setAlvoIndex] = useState(null);
  const deslocamento = useRef(new Animated.Value(0)).current;
  // Altura real de cada linha (o texto pode quebrar em mais de uma), medida
  // no onLayout. Ref e não state: muda durante o layout e não deve
  // provocar re-render.
  const alturas = useRef([]);
  const arrastandoRef = useRef(null);
  const alvoRef = useRef(null);
  const itensRef = useRef([]);
  itensRef.current = itens;

  const carregar = useCallback(async () => {
    try {
      setItens(await listarAfazeres());
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function alturaDe(i) {
    return (alturas.current[i] || 0) + MARGEM_LINHA;
  }

  function topoDe(i) {
    let t = 0;
    for (let k = 0; k < i; k++) t += alturaDe(k);
    return t;
  }

  /** Em qual posição a linha cairia se o dedo soltasse agora. */
  function indiceAlvo(origem, dy) {
    const centro = topoDe(origem) + alturaDe(origem) / 2 + dy;
    let acumulado = 0;
    for (let i = 0; i < itensRef.current.length; i++) {
      const altura = alturaDe(i);
      if (centro < acumulado + altura / 2) return i;
      acumulado += altura;
    }
    return itensRef.current.length - 1;
  }

  async function soltar(origem, destino) {
    if (destino == null || destino === origem) return;
    const anterior = itensRef.current;
    const novo = [...anterior];
    const [movido] = novo.splice(origem, 1);
    novo.splice(destino, 0, movido);
    setItens(novo);
    // Alturas medidas seguem a posição, não o item — depois de mover, as
    // antigas estão trocadas. Zerar faz o próximo layout remedir.
    alturas.current = [];
    try {
      await reordenarAfazeres(novo.map((i) => i.id));
    } catch (err) {
      setItens(anterior);
      Alert.alert('Erro ao reordenar', mensagemDeErro(err));
    }
  }

  // Um PanResponder por posição, criado UMA vez por tamanho de lista.
  //
  // Criar dentro do render parece inofensivo e não é: o próprio arraste
  // provoca re-render (a marca de destino muda de lugar), e um
  // PanResponder novo no meio do gesto chega com `_gestureState` zerado —
  // o `dy` recomeça do zero e a linha salta de volta pro dedo. Os
  // handlers só dependem de `index` e de refs, então a instância pode
  // ficar estável sem ler estado velho.
  const panResponders = useMemo(
    () => itens.map((_, index) => criarPanResponder(index)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itens.length],
  );

  function criarPanResponder(index) {
    return PanResponder.create({
      // Só a alça pega o toque; o resto da linha continua rolando a lista.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        arrastandoRef.current = index;
        alvoRef.current = index;
        deslocamento.setValue(0);
        setArrastandoIndex(index);
        setAlvoIndex(index);
      },
      onPanResponderMove: (_, gesto) => {
        deslocamento.setValue(gesto.dy);
        const alvo = indiceAlvo(index, gesto.dy);
        if (alvo !== alvoRef.current) {
          alvoRef.current = alvo;
          setAlvoIndex(alvo);
        }
      },
      onPanResponderRelease: () => {
        const origem = arrastandoRef.current;
        const destino = alvoRef.current;
        arrastandoRef.current = null;
        alvoRef.current = null;
        setArrastandoIndex(null);
        setAlvoIndex(null);
        deslocamento.setValue(0);
        soltar(origem, destino);
      },
      onPanResponderTerminate: () => {
        arrastandoRef.current = null;
        alvoRef.current = null;
        setArrastandoIndex(null);
        setAlvoIndex(null);
        deslocamento.setValue(0);
      },
    });
  }

  async function handleAdicionar() {
    if (!texto.trim()) return;
    setAdicionando(true);
    try {
      const novo = await adicionarAfazer(texto);
      setItens((atual) => [novo, ...atual]);
      alturas.current = [];
      setTexto('');
    } catch (err) {
      Alert.alert('Erro ao adicionar', mensagemDeErro(err));
    } finally {
      setAdicionando(false);
    }
  }

  async function handleAlternar(item) {
    const novoValor = !item.concluido;
    // Concluir não muda mais o item de lugar: a ordem é a que a pessoa
    // montou, e um item que pula pro fim ao ser marcado desmancha
    // exatamente essa organização.
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido: novoValor } : i)));
    try {
      await alternarAfazer(item.id, novoValor);
    } catch (err) {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido: !novoValor } : i)));
      Alert.alert('Erro', mensagemDeErro(err));
    }
  }

  function handleRemover(item) {
    Alert.alert('Remover afazer', `Remover "${item.texto}" da lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setItens((atual) => atual.filter((i) => i.id !== item.id));
          alturas.current = [];
          try {
            await removerAfazer(item.id);
          } catch (err) {
            Alert.alert('Erro', mensagemDeErro(err));
            carregar();
          }
        },
      },
    ]);
  }

  function renderLinha(item, index) {
    const arrastando = arrastandoIndex === index;
    // A marca de destino aparece ANTES da linha alvo quando o item está
    // subindo, e DEPOIS quando está descendo — é onde ele vai encaixar.
    const marcaAntes = alvoIndex === index && arrastandoIndex > index;
    const marcaDepois = alvoIndex === index && arrastandoIndex < index;

    return (
      <View key={item.id}>
        {marcaAntes && <View style={s.marcaDestino} />}
        <Animated.View
          onLayout={(e) => { alturas.current[index] = e.nativeEvent.layout.height; }}
          style={[
            s.linha,
            arrastando && s.linhaArrastando,
            arrastando && { transform: [{ translateY: deslocamento }] },
          ]}
        >
          <TouchableOpacity
            style={s.checkWrap}
            onPress={() => handleAlternar(item)}
            disabled={arrastandoIndex !== null}
          >
            <Ionicons
              name={item.concluido ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={item.concluido ? COLORS.btnBlue : COLORS.textMid}
            />
          </TouchableOpacity>

          <Text style={[s.texto, item.concluido && s.textoConcluido]}>{item.texto}</Text>

          <TouchableOpacity
            style={s.removerBtn}
            onPress={() => handleRemover(item)}
            disabled={arrastandoIndex !== null}
          >
            <Ionicons name="trash-outline" size={18} color={COLORS.textMid} />
          </TouchableOpacity>

          {/* Alça de arraste. Área generosa de propósito: é um alvo que se
              pega com o polegar, em movimento, não um botão que se mira. */}
          <View style={s.alca} {...(panResponders[index]?.panHandlers || {})}>
            <Ionicons name="reorder-three-outline" size={22} color={COLORS.textMid} />
          </View>
        </Animated.View>
        {marcaDepois && <View style={s.marcaDestino} />}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Afazeres" onVoltar={() => navigation.goBack()} />
      {/* Android já redimensiona a tela sozinho quando o teclado abre
          (softwareKeyboardLayoutMode "resize", padrão do Expo) — usar
          behavior "height" aqui em cima disso comprimia a tela duas vezes.
          Só o iOS precisa de ajuste manual (não redimensiona sozinho). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {carregando ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.btnBlue} />
          </View>
        ) : (
          // ScrollView e não FlatList: a virtualização desmonta linhas fora
          // da tela, e uma linha desmontada no meio de um arraste leva o
          // PanResponder junto.
          <ScrollView
            contentContainerStyle={s.lista}
            scrollEnabled={arrastandoIndex === null}
            keyboardShouldPersistTaps="handled"
          >
            {itens.length === 0 ? (
              <Text style={s.vazio}>Nenhum afazer ainda. Adicione o primeiro abaixo.</Text>
            ) : (
              <>
                {itens.length > 1 && (
                  <Text style={s.dica}>Arraste pela alça à direita para mudar a ordem.</Text>
                )}
                {itens.map(renderLinha)}
              </>
            )}
          </ScrollView>
        )}

        <View style={s.addBar}>
          <TextInput
            style={s.addInput}
            value={texto}
            onChangeText={setTexto}
            placeholder="Novo afazer..."
            placeholderTextColor="#756E66"
            onSubmitEditing={handleAdicionar}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={[s.addBtn, (!texto.trim() || adicionando) && { opacity: 0.5 }]}
            onPress={handleAdicionar}
            disabled={!texto.trim() || adicionando}
          >
            {adicionando ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons name="add" size={24} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lista: { padding: 16, paddingBottom: 8 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 14, marginTop: 40, lineHeight: 20 },
  dica: { color: COLORS.textMid, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    marginBottom: MARGEM_LINHA,
    borderWidth: 1, borderColor: COLORS.border,
  },
  linhaArrastando: {
    borderColor: COLORS.btnBlue,
    // Sombra + zIndex: a linha precisa parecer levantada da lista, e
    // passar POR CIMA das vizinhas enquanto o dedo a leva.
    zIndex: 10,
    elevation: 6,
    shadowColor: '#302C28',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  marcaDestino: {
    height: 2, borderRadius: 2, backgroundColor: COLORS.btnBlue,
    marginBottom: MARGEM_LINHA,
  },
  checkWrap: { padding: 2 },
  texto: { flex: 1, fontSize: 15, color: COLORS.textDark, lineHeight: 22 },
  textoConcluido: { color: COLORS.textMid, textDecorationLine: 'line-through' },
  removerBtn: { padding: 4 },
  alca: { paddingVertical: 6, paddingLeft: 4, paddingRight: 2 },
  addBar: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  addInput: {
    flex: 1, backgroundColor: COLORS.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark, borderWidth: 1, borderColor: COLORS.border,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.btnBlue,
    alignItems: 'center', justifyContent: 'center',
  },
});
