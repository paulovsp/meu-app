// Proteção da gravação — o que o Android precisa liberar pro áudio de uma
// sessão não ser interrompido no meio.
//
// Existe porque avisar depois não resolve: quando a gravação é derrubada, a
// sessão já foi. Aqui cada pendência vira um botão que abre exatamente a
// tela do sistema onde ela se resolve, e a lista se refaz sozinha quando a
// pessoa volta — então o próprio ecrã serve de confirmação de que ficou OK.
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { diagnosticarProtecao } from '../services/protecaoGravacao';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  verde: '#44745B',
  ambar: '#B36B00',
  vermelho: '#975451',
};

export default function ProtecaoGravacaoScreen() {
  const navigation = useNavigation();
  const [carregando, setCarregando] = useState(true);
  const [pendencias, setPendencias] = useState([]);

  // Recarrega a cada foco: o ajuste acontece FORA do app, nas configurações
  // do Android. Voltar pra cá tem que refletir o que mudou lá.
  useFocusEffect(useCallback(() => {
    let ativo = true;
    setCarregando(true);
    diagnosticarProtecao()
      .then((lista) => { if (ativo) setPendencias(lista); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []));

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Proteção da gravação" onVoltar={() => navigation.goBack()} />
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.intro}>
          Durante uma sessão o Dr.Sig mantém um serviço em primeiro plano — é
          ele que segura o microfone quando você bloqueia a tela ou abre outro
          aplicativo. Alguns ajustes do Android podem derrubar esse serviço.
        </Text>

        {carregando ? (
          <ActivityIndicator color={COLORS.verde} style={{ marginTop: 30 }} />
        ) : pendencias.length === 0 ? (
          <View style={s.tudoCerto}>
            <Ionicons name="shield-checkmark" size={34} color={COLORS.verde} />
            <Text style={s.tudoCertoTitulo}>Tudo liberado</Text>
            <Text style={s.tudoCertoTexto}>
              Nada no sistema está restringindo a gravação. Você pode bloquear a
              tela e usar outros aplicativos durante a sessão.
            </Text>
          </View>
        ) : (
          pendencias.map((p) => (
            <View key={p.id} style={s.card}>
              <View style={s.cardTopo}>
                <Ionicons
                  name={p.gravidade === 'impede' ? 'close-circle' : 'alert-circle'}
                  size={20}
                  color={p.gravidade === 'impede' ? COLORS.vermelho : COLORS.ambar}
                />
                <Text style={s.cardTitulo}>{p.titulo}</Text>
              </View>
              <Text style={s.cardDescricao}>{p.descricao}</Text>
              <TouchableOpacity
                style={s.botao}
                onPress={() => { p.abrir()?.catch?.(() => {}); }}
              >
                <Text style={s.botaoTexto}>{p.acaoLabel}</Text>
                <Ionicons name="open-outline" size={15} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={s.nota}>
          <Text style={s.notaTexto}>
            Mesmo com tudo liberado, uma coisa continua fora do alcance do app:
            uma ligação telefônica. A telefonia toma o microfone com
            exclusividade, sempre. Se atender uma chamada durante a sessão, a
            gravação para — e o Dr.Sig avisa quando você voltar, com o áudio já
            captado guardado.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 18 },
  intro: { fontSize: 14, color: COLORS.textMid, lineHeight: 21, marginTop: 14, marginBottom: 18 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 15, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardTopo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitulo: { flex: 1, fontSize: 15.5, fontWeight: '600', color: COLORS.textDark, lineHeight: 22 },
  cardDescricao: { fontSize: 13, color: COLORS.textMid, lineHeight: 19, marginTop: 6 },
  botao: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: COLORS.verde, borderRadius: 10, paddingVertical: 11, marginTop: 12,
  },
  botaoTexto: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  tudoCerto: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 20, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tudoCertoTitulo: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, marginTop: 8 },
  tudoCertoTexto: { fontSize: 13, color: COLORS.textMid, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  nota: { backgroundColor: '#F2E9DC', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#E3D5BC' },
  notaTexto: { fontSize: 12.5, color: '#6B5A3A', lineHeight: 19 },
});
