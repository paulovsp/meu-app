// ─── Cabeçalho próprio de toda tela secundária ──────────────────────────
// Substitui o header nativo do @react-navigation/native-stack (headerShown
// no AppNavigator.js). O nativo, sob o edge-to-edge do Android no Expo
// SDK 54, não reserva o espaço real que ocupa — ele desenha por cima da
// tela em vez de empurrar o conteúdo pra baixo, cortando o topo de várias
// telas (título duplicado sobreposto, avatar do Perfil cortado pela
// metade, etc). Desenhando o cabeçalho nós mesmos, a altura é sempre a
// que o código diz que é — o conteúdo abaixo nunca fica embaixo dele.
// Mesmo visual do antigo CabecalhoVerde (fundo na cor da marca, onda
// recortada no pé), agora com título, voltar e ações de verdade.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { salvia, papel } from '../theme';

const ALTURA_BARRA = 52;
const ALTURA_ONDA = 16;

export default function CabecalhoTela({ titulo, onVoltar, acoes }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.fundo, { paddingTop: insets.top }]}>
      <View style={s.barra}>
        {onVoltar ? (
          <TouchableOpacity
            onPress={onVoltar}
            style={s.ladoBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <View style={s.ladoBtn} />
        )}

        <Text style={s.titulo} numberOfLines={1}>{titulo}</Text>

        <View style={s.acoes}>{acoes}</View>
      </View>

      <Svg
        width="100%"
        height={ALTURA_ONDA}
        viewBox="0 0 390 18"
        preserveAspectRatio="none"
        style={s.onda}
      >
        <Path d="M0,4 C66,14 132,0 198,7 C258,13 326,2 390,9 L390,18 L0,18 Z" fill={salvia.base} />
        <Path d="M0,9 C66,18 132,5 198,11 C258,17 326,7 390,13 L390,18 L0,18 Z" fill={papel.base} />
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  fundo: { backgroundColor: salvia.tinta, width: '100%' },
  barra: {
    height: ALTURA_BARRA,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  ladoBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titulo: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 19,
    letterSpacing: -0.3,
    marginLeft: 2,
  },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6, minHeight: 44 },
  onda: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

// Altura total real ocupada por este componente (sem contar o inset do
// topo, que cada tela já lê sozinha via useSafeAreaInsets se precisar) —
// exportado pra quem precisar reservar esse espaço manualmente.
export const ALTURA_CABECALHO = ALTURA_BARRA + ALTURA_ONDA;
