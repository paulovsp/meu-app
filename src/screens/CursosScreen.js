import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { listarCursos } from '../services/cursos';
import { mensagemDeErro } from '../services/erros';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  btnBlue: '#497363',
};

const FORMATO_LABEL = {
  presencial: 'Presencial',
  online_ao_vivo: 'Online ao vivo',
  gravado: 'Gravado/EAD',
};

function formatarMoeda(valor) {
  if (!valor) return null;
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return null;
  return iso.split('-').reverse().join('/');
}

export default function CursosScreen() {
  const navigation = useNavigation();
  const [cursos, setCursos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useFocusEffect(
    useCallback(() => {
      listarCursos()
        .then(setCursos)
        .catch((err) => Alert.alert('Erro', mensagemDeErro(err)))
        .finally(() => setCarregando(false));
    }, [])
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Meus cursos" onVoltar={() => navigation.goBack()} />
      {carregando ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.btnBlue} />
        </View>
      ) : (
        <FlatList
          data={cursos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.lista}
          ListEmptyComponent={
            <Text style={s.vazio}>Nenhum curso no currículo ainda. Adicione o primeiro abaixo.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card} onPress={() => navigation.navigate('FormularioCurso', { curso: item })}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitulo}>{item.titulo}</Text>
                {item.transcricao_status === 'concluida' && (
                  <Ionicons name="document-text-outline" size={16} color={COLORS.btnBlue} />
                )}
              </View>
              {(item.professor || item.instituicao) && (
                <Text style={s.cardSub}>
                  {[item.professor, item.instituicao].filter(Boolean).join(' · ')}
                </Text>
              )}
              <View style={s.cardMetaRow}>
                {item.carga_horaria ? <Text style={s.cardMeta}>{item.carga_horaria}h</Text> : null}
                {formatarData(item.data) ? <Text style={s.cardMeta}>{formatarData(item.data)}</Text> : null}
                {item.formato ? <Text style={s.cardMeta}>{FORMATO_LABEL[item.formato] || item.formato}</Text> : null}
                {formatarMoeda(item.custo) ? <Text style={s.cardMeta}>{formatarMoeda(item.custo)}</Text> : null}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={s.fab} onPress={() => navigation.navigate('FormularioCurso', {})}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lista: { padding: 16, paddingBottom: 90 },
  vazio: { textAlign: 'center', color: COLORS.textMid, fontSize: 13, marginTop: 40, lineHeight: 19 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitulo: { flex: 1, fontSize: 15, fontWeight: '500', color: COLORS.textDark, lineHeight: 22 },
  cardSub: { fontSize: 13, color: COLORS.textMid, marginTop: 4, lineHeight: 19 },
  cardMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  cardMeta: { fontSize: 12, color: COLORS.textMid, fontWeight: '600', lineHeight: 17 },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.btnBlue, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 6,
  },
});
