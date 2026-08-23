// Antes era um único campo de texto livre tentando "adivinhar" DDI e se o
// número era celular ou fixo — nunca foi confiável (número internacional
// sem "+" digitado, celular sem o 9 extra, etc). Agora são 3 caixas
// explícitas: a pessoa escolhe o DDI e o DDD, e só o número em si é
// formatado (regra do hífen/espaço em formatarNumeroLocalTelefone).
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { parseTelefone, montarTelefone, formatarNumeroLocalTelefone } from '../services/validacao';

function apenasDigitos(t) {
  return (t || '').replace(/\D/g, '');
}

export default function TelefoneInput({ value, onChangeText, style, inputStyle }) {
  const inicial = useState(() => parseTelefone(value))[0];
  const [ddi, setDdi] = useState(inicial.ddi);
  const [ddd, setDdd] = useState(inicial.ddd);
  const [numero, setNumero] = useState(inicial.numero);

  function atualizar(novoDdi, novoDdd, novoNumero) {
    setDdi(novoDdi);
    setDdd(novoDdd);
    setNumero(novoNumero);
    onChangeText(montarTelefone(novoDdi, novoDdd, novoNumero));
  }

  return (
    <View style={[s.linha, style]}>
      <View style={[s.caixaDDI, inputStyle]}>
        <TextInput
          style={s.textoDDI}
          value={ddi ? `+${ddi}` : '+'}
          onChangeText={(t) => atualizar(apenasDigitos(t).slice(0, 3), ddd, numero)}
          keyboardType="number-pad"
          maxLength={4}
        />
      </View>
      <TextInput
        style={[s.caixaDDD, inputStyle]}
        value={ddd}
        onChangeText={(t) => atualizar(ddi, apenasDigitos(t).slice(0, 3), numero)}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="DDD"
        placeholderTextColor="#A9A299"
      />
      <TextInput
        style={[s.caixaNumero, inputStyle]}
        value={formatarNumeroLocalTelefone(numero)}
        onChangeText={(t) => atualizar(ddi, ddd, apenasDigitos(t).slice(0, 9))}
        keyboardType="number-pad"
        maxLength={11}
        placeholder="9 9999-9999"
        placeholderTextColor="#A9A299"
      />
    </View>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 8 },
  caixaDDI: { width: 62 },
  textoDDI: {
    backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 10,
    paddingVertical: 12, fontSize: 15, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC', textAlign: 'center',
  },
  caixaDDD: {
    width: 56, backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 8,
    paddingVertical: 12, fontSize: 15, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC', textAlign: 'center',
  },
  caixaNumero: {
    flex: 1, backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 12,
    paddingVertical: 12, fontSize: 15, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC',
  },
});
