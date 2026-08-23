import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { TIPOS_RELATORIO } from '../services/relatorios';

export default function DetalheRelatorioScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { relatorio } = route.params;

  const titulo = TIPOS_RELATORIO.find((t) => t.valor === relatorio?.tipo)?.label || 'Relatório';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo={titulo} onVoltar={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.conteudo}>{relatorio?.conteudo}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F5F0' },
  scroll: { padding: 20 },
  conteudo: { fontSize: 14.5, color: '#302C28', lineHeight: 22 },
});
