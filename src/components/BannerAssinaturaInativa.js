import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { assinaturaEstaAtiva, MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

// Banner persistente — reaparece toda vez que a tela ganha foco, porque o
// estado pode mudar a qualquer momento (webhook do Mercado Pago rodando em
// segundo plano). Sem link, preço ou menção a "assinar"/site — ver
// regra anti-steering do Google Play no comentário de assinatura.js.
export default function BannerAssinaturaInativa() {
  const [ativa, setAtiva] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      assinaturaEstaAtiva().then((valor) => {
        if (!cancelado) setAtiva(valor);
      });
      return () => { cancelado = true; };
    }, [])
  );

  if (ativa) return null;

  return (
    <View style={s.box}>
      <Text style={s.texto}>{MENSAGEM_ASSINATURA_INATIVA}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 14,
  },
  texto: {
    fontSize: 13,
    color: '#5D4037',
    lineHeight: 19,
  },
});
