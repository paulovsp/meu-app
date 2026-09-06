import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { TIPOS_RELATORIO, deletarRelatorio } from '../services/relatorios';
import { mensagemDeErro } from '../services/erros';

function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR');
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

export default function DetalheRelatorioScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { relatorio } = route.params;
  const [apagando, setApagando] = useState(false);

  const titulo = TIPOS_RELATORIO.find((t) => t.valor === relatorio?.tipo)?.label || 'Relatório';

  // Um relatório custa crédito de IA e se acumula por analisante. Apagar
  // existia no serviço desde o início e não tinha por onde ser chamado —
  // a lista só crescia.
  function confirmarExclusao() {
    Alert.alert(
      'Apagar relatório',
      'Este relatório será removido definitivamente. O crédito de IA já gasto não volta.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            setApagando(true);
            try {
              await deletarRelatorio(relatorio.id);
              navigation.goBack();
            } catch (err) {
              setApagando(false);
              Alert.alert('Erro ao apagar', mensagemDeErro(err));
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo={titulo} onVoltar={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {!!relatorio?.criado_em && (
          <Text style={s.meta}>Gerado em {formatarDataHora(relatorio.criado_em)}</Text>
        )}
        {/* `selectable`: é texto clínico que a pessoa copia pra um laudo, um
            e-mail, um prontuário de outro sistema. Sem isso, só dava pra
            reler na tela e redigitar. */}
        <Text style={s.conteudo} selectable>{relatorio?.conteudo}</Text>

        <TouchableOpacity
          style={[s.btnApagar, apagando && { opacity: 0.7 }]}
          onPress={confirmarExclusao}
          disabled={apagando}
        >
          {apagando ? (
            <ActivityIndicator color="#975451" />
          ) : (
            <View style={s.btnApagarConteudo}>
              <Ionicons name="trash-outline" size={17} color="#975451" />
              <Text style={s.btnApagarTexto}>Apagar relatório</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F5F0' },
  scroll: { padding: 20, paddingBottom: 40 },
  meta: { fontSize: 12.5, color: '#8C857B', lineHeight: 18, marginBottom: 14 },
  conteudo: { fontSize: 14.5, color: '#302C28', lineHeight: 22 },
  btnApagar: {
    marginTop: 32, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#975451',
  },
  btnApagarConteudo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnApagarTexto: { color: '#975451', fontWeight: '500', fontSize: 14.5, lineHeight: 21 },
});
