// Medidor do nível de entrada do microfone durante a gravação.
//
// Existe por um motivo concreto: quando outro app está em chamada no mesmo
// aparelho (Google Meet, Zoom, WhatsApp), o Android entrega o microfone pra
// chamada e SILENCIA a nossa gravação em vez de bloqueá-la — o arquivo sai
// com a duração certa e sem uma palavra dentro. Sem um medidor, isso só é
// descoberto depois, com a sessão já perdida. Ver src/services/gravacaoEmBlocos.js.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LIMIAR_SILENCIO_DBFS } from '../services/gravacaoEmBlocos';

// Faixa útil da barra, em dBFS já normalizados (ver normalizarNivel em
// gravacaoEmBlocos.js — o Android não entrega dBFS de verdade). Fala normal
// fica entre -40 e -5; -80 é o fundo, onde só há ruído do próprio microfone.
const DBFS_MINIMO = -80;

export default function MedidorDeEntrada({ nivel }) {
  const temLeitura = typeof nivel === 'number';
  const proporcao = temLeitura
    ? Math.max(0, Math.min(1, (nivel - DBFS_MINIMO) / (0 - DBFS_MINIMO)))
    : 0;
  const semSom = temLeitura && nivel <= LIMIAR_SILENCIO_DBFS;

  return (
    <View style={s.container}>
      <View style={s.trilho}>
        <View
          style={[
            s.preenchimento,
            { width: `${Math.round(proporcao * 100)}%` },
            semSom && s.preenchimentoSemSom,
          ]}
        />
      </View>
      <Text style={[s.legenda, semSom && s.legendaSemSom]}>
        {!temLeitura
          ? 'Medindo o som...'
          : semSom
          ? 'Não está entrando som no microfone'
          : 'Som entrando normalmente'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { alignSelf: 'stretch', marginTop: 14 },
  trilho: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EAE5DC',
    overflow: 'hidden',
  },
  preenchimento: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#497363',
  },
  preenchimentoSemSom: { backgroundColor: '#975451' },
  legenda: {
    marginTop: 6,
    fontSize: 12,
    color: '#756E66',
    textAlign: 'center',
  },
  legendaSemSom: { color: '#975451', fontWeight: '600' },
});
