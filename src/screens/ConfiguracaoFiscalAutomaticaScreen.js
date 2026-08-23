import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getConfiguracaoFiscal, salvarConfiguracaoFiscal } from '../services/database';
import { mensagemDeErro } from '../services/erros';

const DIAS_SEMANA = [
  { valor: 1, label: 'Seg' },
  { valor: 2, label: 'Ter' },
  { valor: 3, label: 'Qua' },
  { valor: 4, label: 'Qui' },
  { valor: 5, label: 'Sex' },
  { valor: 6, label: 'Sáb' },
  { valor: 0, label: 'Dom' },
];

// Cadência disponível varia conforme o modelo de cobrança do analisante:
// "semanal" (agrega a semana num envio só) e "sessao" (dispara na hora) só
// fazem sentido pra quem é cobrado por sessão; "mensal" só pra quem tem
// cobrança mensal — não há como combinar as duas coisas.
function opcoesCadencia(tipoCobranca) {
  if (tipoCobranca === 'por_sessao') {
    return [
      { valor: 'sessao', label: 'A cada sessão confirmada' },
      { valor: 'semanal', label: '1x por semana' },
    ];
  }
  return [
    { valor: 'mensal', label: '1x por mês' },
  ];
}

export default function ConfiguracaoFiscalAutomaticaScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { patientId, patientNome } = route.params;

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [config, setConfig] = useState(null);
  const [frequencia, setFrequencia] = useState(null);
  const [diaSemana, setDiaSemana] = useState(1);
  const [diaMes, setDiaMes] = useState('');

  const carregar = useCallback(async () => {
    try {
      const dados = await getConfiguracaoFiscal(patientId);
      setConfig(dados);
      setFrequencia(dados.fiscal_frequencia_automatica || null);
      setDiaSemana(dados.fiscal_dia_semana ?? 1);
      setDiaMes(dados.fiscal_dia_mes ? String(dados.fiscal_dia_mes) : (dados.dia_pagamento ? String(dados.dia_pagamento) : ''));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [patientId]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function formatarDiaMes(texto) {
    const numeros = texto.replace(/\D/g, '').slice(0, 2);
    if (numeros.length === 2 && Number(numeros) > 30) {
      setDiaMes(numeros.slice(0, 1));
      return;
    }
    setDiaMes(numeros);
  }

  async function salvar() {
    if (frequencia === 'semanal' && (diaSemana === null || diaSemana === undefined)) {
      Alert.alert('Escolha o dia', 'Selecione o dia da semana para o envio.');
      return;
    }
    if (frequencia === 'mensal') {
      const dia = Number(diaMes);
      if (!dia || dia < 1 || dia > 30) {
        Alert.alert('Escolha o dia', 'Informe um dia do mês entre 1 e 30 para o envio.');
        return;
      }
    }

    setSalvando(true);
    try {
      await salvarConfiguracaoFiscal(patientId, {
        fiscal_frequencia_automatica: frequencia,
        fiscal_dia_semana: frequencia === 'semanal' ? diaSemana : null,
        fiscal_dia_mes: frequencia === 'mensal' ? Number(diaMes) : null,
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando || !config) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loading}>
          <ActivityIndicator color="#497363" />
        </View>
      </SafeAreaView>
    );
  }

  const opcoes = opcoesCadencia(config.tipo_cobranca);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.titulo}>Envio automático — {patientNome || config.nome}</Text>
        <Text style={styles.hint}>
          {config.tipo_cobranca === 'por_sessao'
            ? 'Este analisante tem cobrança por sessão: o envio pode ser feito a cada sessão confirmada, ou agregado 1x por semana.'
            : 'Este analisante tem cobrança mensal: o envio automático só pode acontecer 1x por mês.'}
        </Text>

        <View style={styles.opcoes}>
          <OpcaoFrequencia
            label="Desativado"
            ativo={!frequencia}
            onPress={() => setFrequencia(null)}
          />
          {opcoes.map((op) => (
            <OpcaoFrequencia
              key={op.valor}
              label={op.label}
              ativo={frequencia === op.valor}
              onPress={() => setFrequencia(op.valor)}
            />
          ))}
        </View>

        {frequencia === 'semanal' && (
          <View style={styles.bloco}>
            <Text style={styles.label}>Dia da semana</Text>
            <View style={styles.diasContainer}>
              {DIAS_SEMANA.map((dia) => {
                const ativo = diaSemana === dia.valor;
                return (
                  <TouchableOpacity
                    key={dia.valor}
                    style={[styles.diaChip, ativo && styles.diaChipAtivo]}
                    onPress={() => setDiaSemana(dia.valor)}
                  >
                    <Text style={[styles.diaChipText, ativo && styles.diaChipTextAtivo]}>{dia.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {frequencia === 'mensal' && (
          <View style={styles.bloco}>
            <Text style={styles.label}>Dia do mês</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 10"
              placeholderTextColor="#A9A299"
              value={diaMes}
              onChangeText={formatarDiaMes}
              keyboardType="numeric"
              maxLength={2}
            />
          </View>
        )}

        <TouchableOpacity style={styles.btnSalvar} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnSalvarTxt}>Salvar</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OpcaoFrequencia({ label, ativo, onPress }) {
  return (
    <TouchableOpacity style={[styles.opcao, ativo && styles.opcaoAtiva]} onPress={onPress}>
      <Text style={[styles.opcaoTexto, ativo && styles.opcaoTextoAtivo]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 16 },
  titulo: { fontSize: 18, fontWeight: '500', color: '#302C28' },
  hint: { fontSize: 13, color: '#756E66', lineHeight: 18 },
  opcoes: { gap: 8 },
  opcao: {
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: '#FDFCFA', borderWidth: 1, borderColor: '#EAE5DC',
  },
  opcaoAtiva: { backgroundColor: '#497363', borderColor: '#497363' },
  opcaoTexto: { fontSize: 14, fontWeight: '600', color: '#4E4941', lineHeight: 20 },
  opcaoTextoAtivo: { color: '#fff' },
  bloco: { gap: 8 },
  label: {
    fontSize: 12, fontWeight: '500', color: '#756E66',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  diasContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  diaChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FDFCFA', borderWidth: 1, borderColor: '#EAE5DC',
  },
  diaChipAtivo: { backgroundColor: '#497363', borderColor: '#497363' },
  diaChipText: { fontSize: 12, fontWeight: '600', color: '#756E66', lineHeight: 17 },
  diaChipTextAtivo: { color: '#fff' },
  input: {
    backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  btnSalvar: {
    backgroundColor: '#497363', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  btnSalvarTxt: { color: '#fff', fontSize: 16, fontWeight: '500', lineHeight: 23 },
});
