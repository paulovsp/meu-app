import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { papel, tinta, salvia } from '../theme';
import { listarAfazeres, estiloDoAfazer } from '../services/afazeres';

// Espaço da linha "+N mais", contado só quando ela vai de fato existir —
// senão roubaria altura de um afazer que caberia.
const ALTURA_MAIS = 22;
// Respiro entre um afazer e o seguinte (o `marginBottom` de `s.linha`).
// Entra na conta porque a altura medida de cada item já o inclui.
const ESPACO_ENTRE = 6;

export default function MiniAfazeresBox({ navigation, altura }) {
  const [itens, setItens] = useState([]);

  // ── Quanto cabe, de verdade ───────────────────────────────────────────
  // A regra: enquanto tudo couber, cada afazer ocupa quantas linhas
  // precisar — sem teto artificial. Só quando algo fica de fora é que o
  // último visível é cortado, com reticências, em três linhas; e em duas,
  // se três não couberem.
  //
  // Para isso é preciso a altura NATURAL de cada item, sem limite de
  // linhas. Daí as duas passagens: a primeira renderiza todos sem corte
  // algum, dentro de um contêiner que esconde o excedente, só para que
  // cada um informe quanto ocupa; a segunda já sai no formato final.
  //
  // `plano === null` é a primeira passagem.
  const [plano, setPlano] = useState(null);
  const [alturaLista, setAlturaLista] = useState(0);
  const alturasRef = useRef({});
  const itensRef = useRef([]);
  const alturaListaRef = useRef(0);
  const planoRef = useRef(null);
  itensRef.current = itens;
  alturaListaRef.current = alturaLista;
  planoRef.current = plano;

  useFocusEffect(
    useCallback(() => {
      listarAfazeres()
        .then((lista) => setItens(lista.filter((i) => !i.concluido)))
        .catch(() => setItens([]));
    }, [])
  );

  // Lista nova: medidas antigas não valem mais, e tudo é medido de novo.
  useEffect(() => {
    alturasRef.current = {};
    setPlano(null);
  }, [itens]);

  /** Quantos itens INTEIROS cabem em `disponivel`, e quanto sobra depois. */
  function encaixarInteiros(lista, disponivel) {
    let soma = 0;
    let completos = 0;
    for (const item of lista) {
      const h = alturasRef.current[item.id];
      if (soma + h > disponivel) break;
      soma += h;
      completos += 1;
    }
    return { completos, sobra: disponivel - soma };
  }

  /** O plano de exibição para uma altura disponível. */
  function montarPlano(lista, disponivel) {
    const { completos, sobra } = encaixarInteiros(lista, disponivel);
    if (completos >= lista.length) {
      return { completos, truncado: null, restantes: 0 };
    }

    // Sobrou espaço depois dos inteiros: cabe o começo do próximo, cortado.
    const proximo = lista[completos];
    const lh = estiloDoAfazer(proximo).lineHeight;
    let truncado = null;
    if (sobra >= 3 * lh + ESPACO_ENTRE) truncado = { id: proximo.id, linhas: 3 };
    else if (sobra >= 2 * lh + ESPACO_ENTRE) truncado = { id: proximo.id, linhas: 2 };

    const mostrados = completos + (truncado ? 1 : 0);
    return { completos, truncado, restantes: lista.length - mostrados };
  }

  function recalcular() {
    const lista = itensRef.current;
    const disponivel = alturaListaRef.current;
    if (!disponivel || lista.length === 0) return;
    if (lista.some((i) => alturasRef.current[i.id] == null)) return;

    // Primeiro sem reservar nada: no caso feliz tudo cabe e não existe
    // "+N mais" nenhum para acomodar.
    const cheio = montarPlano(lista, disponivel);
    if (cheio.restantes === 0) {
      setPlano(cheio);
      return;
    }

    // Vai sobrar gente de fora: a linha "+N mais" passa a existir e precisa
    // do espaço dela antes de decidir o corte.
    const comAviso = montarPlano(lista, disponivel - ALTURA_MAIS);
    // Se descontar o aviso o tornou desnecessário, ele não existe — e aí
    // vale o plano cheio, que aproveita melhor o espaço.
    setPlano(comAviso.restantes === 0 ? cheio : comAviso);
  }

  function medirLista(e) {
    const h = e.nativeEvent.layout.height;
    if (h !== alturaListaRef.current) setAlturaLista(h);
  }

  function medirItem(id, e) {
    // Só a passagem de medição vale: depois de decidido os itens já estão
    // cortados, e guardar essas alturas envenenaria a conta seguinte.
    if (planoRef.current !== null) return;
    const h = e.nativeEvent.layout.height;
    if (alturasRef.current[id] === h) return;
    alturasRef.current[id] = h;
    recalcular();
  }

  useEffect(recalcular, [alturaLista, itens]);

  const medindo = plano === null;
  const visiveis = medindo
    ? itens
    : itens.slice(0, plano.completos + (plano.truncado ? 1 : 0));
  const restantes = medindo ? 0 : plano.restantes;

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

            {itens.length === 0 ? (
              <Text style={s.vazio}>Nada pendente</Text>
            ) : (
              <View style={s.lista} onLayout={medirLista}>
                {/* Tamanho, peso e cor são escolha da pessoa, item a item
                    (migration 0080) — o widget mostra o que ela escolheu,
                    não uma versão neutra do mesmo texto. */}
                {visiveis.map((item) => {
                  // Sem limite de linhas enquanto tudo couber. O corte só
                  // acontece no último visível, quando algo ficou de fora.
                  const corte = !medindo && plano.truncado?.id === item.id
                    ? plano.truncado.linhas
                    : undefined;
                  return (
                    // O marcador vive DENTRO do mesmo Text do texto, e é
                    // por isso que aparece só na primeira linha: o que
                    // quebra para baixo é texto puro, encostado na margem,
                    // sem recuo pendurado embaixo do ponto.
                    <View key={item.id} onLayout={(e) => medirItem(item.id, e)}>
                      <Text
                        style={[s.linha, estiloDoAfazer(item)]}
                        numberOfLines={corte}
                        ellipsizeMode="tail"
                      >
                        • {item.texto}
                      </Text>
                    </View>
                  );
                })}
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
    // altura é fixa (não só um mínimo) e o conteúdo é cortado — a Início
    // não rola, então este widget nunca pode crescer além do espaço
    // reservado pra ele.
    overflow: 'hidden',
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 13.5, fontWeight: '500', color: tinta.t900, lineHeight: 18 },
  // `flex: 1` faz a lista ocupar toda a altura que sobra do cabeçalho — é
  // o que acaba com o vão morto no pé do cartão. `overflow: hidden` segura
  // o excedente durante a passagem de medição.
  lista: { flex: 1, overflow: 'hidden' },
  linha: { marginBottom: ESPACO_ENTRE },
  vazio: { fontSize: 13, color: tinta.t500, fontStyle: 'italic', lineHeight: 19 },
  maisTexto: { fontSize: 11.5, color: tinta.t400, marginTop: 4, fontWeight: '500', lineHeight: 16 },
});
