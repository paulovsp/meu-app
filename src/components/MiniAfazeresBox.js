import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { papel, tinta, salvia } from '../theme';
import { listarAfazeres, estiloDoAfazer } from '../services/afazeres';

const COLORS = {
  surface: '#FFFFFF',
  borderAzul: '#497363',
  textDark: '#302C28',
  textMid: '#756E66',
};

// Espaço que a linha "+N mais" ocupa quando precisa existir. Entra na
// conta só quando de fato sobrar afazer de fora — senão roubaria altura
// de um item que caberia.
const ALTURA_MAIS = 22;

export default function MiniAfazeresBox({ navigation, altura }) {
  const [itens, setItens] = useState([]);

  // ── Quantos cabem, de verdade ─────────────────────────────────────────
  // Antes era um teto fixo de 4 linhas, e sobrava metade do cartão vazio —
  // ou faltava espaço, quando os afazeres eram longos. Agora o cartão se
  // mede, mede cada item e mostra quantos couberem, de cima para baixo.
  //
  // `null` = ainda medindo. Nessa passagem todos são renderizados (dentro
  // de um contêiner que corta o excedente, então nada vaza) só para que
  // cada um informe a própria altura; a passagem seguinte já corta no
  // número certo.
  const [alturaLista, setAlturaLista] = useState(0);
  const [quantosCabem, setQuantosCabem] = useState(null);
  const alturasRef = useRef({});
  const itensRef = useRef([]);
  itensRef.current = itens;

  useFocusEffect(
    useCallback(() => {
      listarAfazeres()
        .then((lista) => setItens(lista.filter((i) => !i.concluido)))
        .catch(() => setItens([]));
    }, [])
  );

  // Lista nova, medidas velhas não valem mais.
  useEffect(() => {
    alturasRef.current = {};
    setQuantosCabem(null);
  }, [itens]);

  function recalcular() {
    const lista = itensRef.current;
    if (!alturaLista || lista.length === 0) return;
    if (lista.some((i) => alturasRef.current[i.id] == null)) return;

    const cabemEm = (disponivel) => {
      let soma = 0;
      let k = 0;
      for (const i of lista) {
        const h = alturasRef.current[i.id];
        if (soma + h > disponivel) break;
        soma += h;
        k += 1;
      }
      return k;
    };

    let k = cabemEm(alturaLista);
    // Sobrou item de fora: a linha "+N mais" passa a existir e precisa de
    // altura, então a conta é refeita com ela descontada.
    if (k < lista.length) k = cabemEm(alturaLista - ALTURA_MAIS);
    // Um afazer sozinho e mais alto que o cartão ainda aparece, cortado —
    // melhor que um cartão vazio dizendo "+1 mais".
    setQuantosCabem(Math.max(k, 1));
  }

  function medirLista(e) {
    const h = e.nativeEvent.layout.height;
    if (h !== alturaLista) setAlturaLista(h);
  }

  function medirItem(id, e) {
    const h = e.nativeEvent.layout.height;
    if (alturasRef.current[id] === h) return;
    alturasRef.current[id] = h;
    recalcular();
  }

  useEffect(recalcular, [alturaLista, itens]);

  const visiveis = quantosCabem == null ? itens : itens.slice(0, quantosCabem);
  const restantes = itens.length - visiveis.length;

  return (
    // Moldura tripla: fina · grossa (3 dp ≈ 0,5 mm) · fina.
    <TouchableOpacity
      style={s.molduraExterna}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Afazeres')}
    >
      <View style={s.molduraCentral}>
        <View style={s.molduraInterna}>
          <View style={[s.caixa, altura ? { height: altura } : null]}>
          <View style={s.header}>
            <Ionicons name="checkbox-outline" size={16} color={salvia.tinta} />
            <Text style={s.titulo}>Afazeres</Text>
          </View>

          {visiveis.length === 0 && quantosCabem != null ? (
            <Text style={s.vazio}>Nada pendente</Text>
          ) : (
            <View style={s.lista} onLayout={medirLista}>
            {/* Tamanho, peso e cor são escolha da pessoa, item a item
                (migration 0080) — o widget mostra o que ela escolheu, não
                uma versão neutra do mesmo texto.

                `adjustsFontSizeToFit` saiu junto: encolhia cada linha em
                função do PRÓPRIO texto, então a linha maior era só a de
                texto mais curto — ênfase por acaso. Com tamanho escolhido
                a dedo, atropelaria a escolha. */}
            {visiveis.map((item) => (
              // O marcador vive DENTRO do mesmo Text do texto, e é por isso
              // que ele aparece só na primeira linha: o que quebra para a
              // linha de baixo é texto puro, encostado na margem, sem
              // recuo pendurado embaixo do ponto.
              <View key={item.id} onLayout={(e) => medirItem(item.id, e)}>
                <Text style={[s.linha, estiloDoAfazer(item)]} numberOfLines={2}>
                  • {item.texto}
                </Text>
              </View>
            ))}
            </View>
          )}
            {restantes > 0 && <Text style={s.maisTexto}>+{restantes} mais</Text>}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Moldura tripla: fina · grossa (3 dp ≈ 0,5 mm) · fina. A linha central
  // é a substância; as duas finas dão a leveza. Mesmo gesto do botão da
  // grade e da barrinha de horário — é a assinatura do app.
  molduraExterna: {
    flex: 1,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: salvia.suave,
    padding: 2,
    backgroundColor: papel.alto,
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  molduraCentral: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: salvia.tinta,
    padding: 2,
  },
  molduraInterna: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: salvia.suave,
    overflow: 'hidden',
  },
  caixa: {
    flex: 1,
    backgroundColor: papel.alto,
    borderRadius: 12,
    padding: 12,
    // altura agora é fixa (não só um mínimo) e o conteúdo é cortado — a
    // Início não rola mais (item 2), então este widget nunca pode crescer
    // além do espaço reservado pra ele.
    overflow: 'hidden',
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 13.5, fontWeight: '500', color: tinta.t900, lineHeight: 18 },
  // `flex: 1` faz a lista ocupar toda a altura que sobra do cabeçalho —
  // é o que acaba com o vão morto no pé do cartão. `overflow: hidden`
  // segura o excedente durante a passagem de medição.
  lista: { flex: 1, overflow: 'hidden' },
  linha: { marginBottom: 6 },
  vazio: { fontSize: 13, color: tinta.t500, fontStyle: 'italic', lineHeight: 19 },
  maisTexto: { fontSize: 11.5, color: tinta.t400, marginTop: 4, fontWeight: '500', lineHeight: 16 },
});
