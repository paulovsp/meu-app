// Bloco de endereço que se preenche sozinho a partir do CEP.
//
// A pessoa digita oito dígitos; rua, bairro, cidade e estado aparecem.
// Sobra número e complemento — a única parte que os Correios não sabem.
//
// Nada aqui é obrigatório e nada trava: se o CEP não for encontrado, ou
// não houver internet, os campos ficam editáveis e o cadastro segue. Um
// endereço é conveniência, não pode ser uma porta fechada.
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { papel, tinta, salvia, semantica } from '../theme';
import { mascararCep, cepCompleto, buscarEnderecoPorCep } from '../services/cep';

/**
 * @param valor           { cep, logradouro, numero, complemento, bairro, cidade, uf }
 * @param aoMudar         recebe o objeto inteiro a cada alteração
 * @param mostrarCidadeUf false onde a tela já tem um seletor de cidade —
 *                        o CEP continua preenchendo os dois, só não os
 *                        mostra aqui, pra não haver dois lugares dizendo
 *                        a mesma coisa com valores possivelmente
 *                        diferentes.
 */
export default function EnderecoPorCep({ valor, aoMudar, estilos = {}, mostrarCidadeUf = true }) {
  const [buscando, setBuscando] = useState(false);
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  const v = valor || {};
  const mudar = (campos) => aoMudar({ ...v, ...campos });

  async function aoDigitarCep(texto) {
    const cep = mascararCep(texto);
    mudar({ cep });
    setNaoEncontrado(false);
    if (!cepCompleto(cep)) return;

    setBuscando(true);
    const achado = await buscarEnderecoPorCep(cep);
    setBuscando(false);

    if (!achado) {
      // Sem alarde: só destrava os campos e diz que vai ter que ser à mão.
      setNaoEncontrado(true);
      return;
    }
    // O número e o complemento nunca são sobrescritos — são o que a pessoa
    // já pode ter digitado antes de completar o CEP.
    mudar({
      cep: achado.cep,
      logradouro: achado.logradouro,
      bairro: achado.bairro,
      cidade: achado.cidade,
      uf: achado.uf,
    });
  }

  return (
    <View style={estilos.bloco}>
      <Text style={[s.rotulo, estilos.rotulo]}>CEP</Text>
      <View style={s.linhaCep}>
        <TextInput
          style={[s.campo, estilos.campo, s.campoCep]}
          value={v.cep || ''}
          onChangeText={aoDigitarCep}
          placeholder="00000-000"
          placeholderTextColor={tinta.t400}
          keyboardType="numeric"
          maxLength={9}
        />
        {buscando && <ActivityIndicator size="small" color={salvia.tinta} />}
      </View>

      {naoEncontrado && (
        <Text style={s.aviso}>
          Não achamos esse CEP. Pode preencher o endereço à mão.
        </Text>
      )}

      <Text style={[s.rotulo, estilos.rotulo]}>Rua</Text>
      <TextInput
        style={[s.campo, estilos.campo]}
        value={v.logradouro || ''}
        onChangeText={(t) => mudar({ logradouro: t })}
        placeholder="Preenchido pelo CEP"
        placeholderTextColor={tinta.t400}
      />

      <View style={s.linhaDupla}>
        <View style={s.metadeMenor}>
          <Text style={[s.rotulo, estilos.rotulo]}>Número</Text>
          <TextInput
            style={[s.campo, estilos.campo]}
            value={v.numero || ''}
            onChangeText={(t) => mudar({ numero: t })}
            placeholder="123"
            placeholderTextColor={tinta.t400}
            keyboardType="numeric"
          />
        </View>
        <View style={s.metadeMaior}>
          <Text style={[s.rotulo, estilos.rotulo]}>Complemento</Text>
          <TextInput
            style={[s.campo, estilos.campo]}
            value={v.complemento || ''}
            onChangeText={(t) => mudar({ complemento: t })}
            placeholder="Sala, andar, bloco"
            placeholderTextColor={tinta.t400}
          />
        </View>
      </View>

      <Text style={[s.rotulo, estilos.rotulo]}>Bairro</Text>
      <TextInput
        style={[s.campo, estilos.campo]}
        value={v.bairro || ''}
        onChangeText={(t) => mudar({ bairro: t })}
        placeholder="Preenchido pelo CEP"
        placeholderTextColor={tinta.t400}
      />

      {mostrarCidadeUf && (
      <View style={s.linhaDupla}>
        <View style={s.metadeMaior}>
          <Text style={[s.rotulo, estilos.rotulo]}>Cidade</Text>
          <TextInput
            style={[s.campo, estilos.campo]}
            value={v.cidade || ''}
            onChangeText={(t) => mudar({ cidade: t })}
            placeholder="Preenchida pelo CEP"
            placeholderTextColor={tinta.t400}
          />
        </View>
        <View style={s.metadeMenor}>
          <Text style={[s.rotulo, estilos.rotulo]}>UF</Text>
          <TextInput
            style={[s.campo, estilos.campo]}
            value={v.uf || ''}
            onChangeText={(t) => mudar({ uf: t.toUpperCase().slice(0, 2) })}
            placeholder="RS"
            placeholderTextColor={tinta.t400}
            autoCapitalize="characters"
            maxLength={2}
          />
        </View>
      </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  rotulo: {
    fontSize: 13, fontWeight: '500', color: tinta.t500,
    marginBottom: 6, marginTop: 14, lineHeight: 18,
  },
  campo: {
    backgroundColor: papel.alto, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, color: tinta.t900,
    borderWidth: 1, borderColor: papel.linha,
  },
  linhaCep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campoCep: { flex: 1 },
  linhaDupla: { flexDirection: 'row', gap: 10 },
  metadeMenor: { flex: 1 },
  metadeMaior: { flex: 2 },
  aviso: {
    fontSize: 12.5, color: semantica.atencao.tinta, lineHeight: 18, marginTop: 7,
  },
});
