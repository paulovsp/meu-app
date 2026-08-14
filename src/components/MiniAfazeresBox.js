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

export default function MiniAfazeresBox({ navigation }) {
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
      style={s.caixa}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Afazeres')}
    >
      <View style={s.header}>
        <Ionicons name="checkbox-outline" size={16} color={COLORS.borderAzul} />
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
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  caixa: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.borderAzul,
    padding: 14,
    minHeight: 130,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  titulo: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  linha: { fontSize: 12.5, color: COLORS.textDark, marginBottom: 4 },
  vazio: { fontSize: 12.5, color: COLORS.textMid, fontStyle: 'italic' },
  maisTexto: { fontSize: 11.5, color: COLORS.textMid, marginTop: 2, fontWeight: '600' },
});
