import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listarAfazeres } from '../services/afazeres';

const COLORS = {
  surface: '#FFFFFF',
  borderAzul: '#3D5A80',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
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
    <TouchableOpacity
      style={s.molduraGrossa}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Afazeres')}
    >
      <View style={s.molduraFina}>
        <View style={[s.caixa, altura ? { minHeight: altura } : null]}>
          <View style={s.header}>
            <Ionicons name="checkbox-outline" size={18} color={COLORS.borderAzul} />
            <Text style={s.titulo}>Afazeres</Text>
          </View>

          {visiveis.length === 0 ? (
            <Text style={s.vazio}>Nada pendente</Text>
          ) : (
            visiveis.map((item) => (
              <Text key={item.id} style={s.linha} numberOfLines={1}>
                • {item.texto}
              </Text>
            ))
          )}
          {restantes > 0 && <Text style={s.maisTexto}>+{restantes} mais</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Moldura em 3 linhas (grossa + fina + fina) pedida pro contraste dos
  // cards da Início — 3 Views aninhadas, cada uma com sua borda e um
  // respiro pequeno até a próxima, em vez de uma borda só.
  molduraGrossa: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: COLORS.borderAzul,
    padding: 3,
  },
  molduraFina: {
    flex: 1,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.borderAzul,
    padding: 2,
  },
  caixa: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 15,
    padding: 16,
    minHeight: 150,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  titulo: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  linha: { fontSize: 13.5, color: COLORS.textDark, marginBottom: 6 },
  vazio: { fontSize: 13.5, color: COLORS.textMid, fontStyle: 'italic' },
  maisTexto: { fontSize: 12.5, color: COLORS.textMid, marginTop: 2, fontWeight: '600' },
});
