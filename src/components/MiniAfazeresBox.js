import React, { useState, useCallback } from 'react';
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

const MAX_LINHAS = 4;

export default function MiniAfazeresBox({ navigation, altura }) {
  const [itens, setItens] = useState([]);

  useFocusEffect(
    useCallback(() => {
      listarAfazeres()
        .then((lista) => setItens(lista.filter((i) => !i.concluido)))
        .catch(() => setItens([]));
    }, [])
  );

  const visiveis = itens.slice(0, MAX_LINHAS);
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

          {visiveis.length === 0 ? (
            <Text style={s.vazio}>Nada pendente</Text>
          ) : (
            // O tamanho, o peso e a cor agora são escolha da pessoa, item a
            // item (migration 0080) — então o widget mostra o que ela
            // escolheu, e não uma versão neutra do mesmo texto.
            //
            // `adjustsFontSizeToFit` saiu junto: ele encolhia cada linha em
            // função do PRÓPRIO texto, então a linha maior era só a de
            // texto mais curto — ênfase por acaso. Com tamanho escolhido a
            // dedo, isso passaria por cima da escolha. O que não couber em
            // duas linhas é truncado, que é honesto num resumo de quatro.
            visiveis.map((item) => (
              <Text
                key={item.id}
                style={[s.linha, estiloDoAfazer(item)]}
                numberOfLines={2}
              >
                • {item.texto}
              </Text>
            ))
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
  linha: { marginBottom: 7 },
  vazio: { fontSize: 13, color: tinta.t500, fontStyle: 'italic', lineHeight: 19 },
  maisTexto: { fontSize: 11.5, color: tinta.t400, marginTop: 'auto', fontWeight: '500', lineHeight: 16 },
});
