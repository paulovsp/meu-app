// O botão de resumo da aba Financeiro da Início: Entradas − Saídas = Resultado
// do mês corrente, no mesmo formato do botão de usuário da aba Início.
//
// Entradas em verde e Saídas em vermelho são sempre assim (são o que são);
// o Resultado muda de cor pelo sinal: verde positivo, amarelo zero,
// vermelho negativo. Os números saem das mesmas funções das telas de
// Entradas e Saídas, para os três nunca divergirem.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { formatarMoeda } from '../services/database';
import { papel, tinta } from '../theme';

const VERDE = '#44745B';
const VERMELHO = '#975451';
const AMARELO = '#7D6540';

function corDoResultado(valor) {
  if (valor > 0.004) return VERDE;
  if (valor < -0.004) return VERMELHO;
  return AMARELO;
}

export const RESUMO_FINANCEIRO_H = 66; // mesma altura do banner de usuário (com a margem)

export default function ResumoFinanceiroBanner({ entradas, saidas, mesLabel, carregando, onPress }) {
  const resultado = (entradas || 0) - (saidas || 0);
  return (
    <TouchableOpacity style={st.banner} activeOpacity={0.7} onPress={onPress}
      accessibilityLabel={`Resultado de ${mesLabel}: entradas ${formatarMoeda(entradas || 0)}, saídas ${formatarMoeda(saidas || 0)}, resultado ${formatarMoeda(resultado)}`}
    >
      <View style={st.esquerda}>
        <Text style={st.rotulo}>{mesLabel}</Text>
        {carregando ? (
          <ActivityIndicator size="small" color={tinta.t400} style={{ alignSelf: 'flex-start', marginTop: 2 }} />
        ) : (
          <View style={st.linha}>
            <Text style={[st.valor, { color: VERDE }]} numberOfLines={1} adjustsFontSizeToFit>{formatarMoeda(entradas || 0)}</Text>
            <Text style={st.sinal}>−</Text>
            <Text style={[st.valor, { color: VERMELHO }]} numberOfLines={1} adjustsFontSizeToFit>{formatarMoeda(saidas || 0)}</Text>
            <Text style={st.sinal}>=</Text>
            <Text style={[st.valor, st.resultado, { color: corDoResultado(resultado) }]} numberOfLines={1} adjustsFontSizeToFit>
              {formatarMoeda(resultado)}
            </Text>
          </View>
        )}
      </View>
      <Text style={st.seta}>›</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: papel.alto,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: papel.linha,
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    minHeight: 50,
  },
  esquerda: { flex: 1, gap: 1 },
  rotulo: {
    fontSize: 10,
    color: tinta.t400,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  linha: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  valor: { fontSize: 14, fontWeight: '600', flexShrink: 1, fontVariant: ['tabular-nums'] },
  resultado: { fontWeight: '700' },
  sinal: { fontSize: 14, color: tinta.t500, fontWeight: '500' },
  seta: { fontSize: 22, color: tinta.t400, fontWeight: '300', marginLeft: 6 },
});

