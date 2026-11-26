// Lista das férias: as do analista e as de cada cliente. Aberta pela Agenda
// (botão "Férias") ou pela ficha do cliente, que passa `patientId` para
// mostrar só as dele e já abrir o cadastro no nome dele.
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { getFerias } from '../services/database';
import { formatarPeriodoFerias, resumoPagamentoFerias } from '../services/ferias';
import { hojeISO } from '../services/validacao';
import { mensagemDeErro } from '../services/erros';

const COR = {
  fundo: '#F7F5F0', cartao: '#FDFCFA', linha: '#EAE5DC',
  t900: '#302C28', t700: '#4E4941', t500: '#756E66',
  salvia: '#497363', salviaVeu: '#E4EFE9', lavanda: '#6E5A8A', lavandaVeu: '#EEE8F5',
};

function situacao(f, hoje) {
  if (f.data_fim < hoje) return 'Já passou';
  if (f.data_inicio <= hoje) return 'Acontecendo agora';
  return 'Programada';
}

export default function FeriasScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const patientId = route.params?.patientId || null;
  const patientNome = route.params?.patientNome || null;
  const [ferias, setFerias] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useFocusEffect(useCallback(() => {
    let ativo = true;
    setCarregando(true);
    getFerias()
      .then((lista) => { if (ativo) setFerias(lista); })
      .catch((e) => Alert.alert('Erro ao carregar as férias', mensagemDeErro(e)))
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []));

  const hoje = hojeISO();
  const visiveis = patientId ? ferias.filter((f) => f.patient_id === patientId) : ferias;
  const doAnalista = visiveis.filter((f) => f.tipo === 'analista');
  const deClientes = visiveis.filter((f) => f.tipo === 'cliente');

  function abrir(f) {
    navigation.navigate('FormularioFerias', { feriasId: f.id });
  }

  function renderItem(f) {
    const agora = situacao(f, hoje);
    return (
      <TouchableOpacity key={f.id} style={styles.cartao} onPress={() => abrir(f)} activeOpacity={0.75}>
        <View style={{ flex: 1 }}>
          {f.tipo === 'cliente' && !patientId && <Text style={styles.nome}>{f.patient_nome || 'Cliente'}</Text>}
          <Text style={styles.periodo}>{formatarPeriodoFerias(f.data_inicio, f.data_fim)}</Text>
          <Text style={styles.detalhe}>{resumoPagamentoFerias(f)}</Text>
          {f.observacao ? <Text style={styles.obs} numberOfLines={2}>{f.observacao}</Text> : null}
        </View>
        <View style={[styles.selo, agora === 'Acontecendo agora' && styles.seloAgora, agora === 'Já passou' && styles.seloPassou]}>
          <Text style={[styles.seloTxt, agora === 'Acontecendo agora' && { color: COR.lavanda }]}>{agora}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <CabecalhoTela titulo={patientNome ? `Férias · ${patientNome}` : 'Férias'} onVoltar={() => navigation.goBack()} />
      {carregando ? (
        <View style={styles.centro}><ActivityIndicator size="large" color={COR.salvia} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + 24 }]}>
          {!patientId && (
            <>
              <TouchableOpacity
                style={styles.botaoPrincipal}
                onPress={() => navigation.navigate('FormularioFerias', { tipo: 'analista' })}
              >
                <Ionicons name="sunny-outline" size={18} color="#FFFFFF" />
                <Text style={styles.botaoPrincipalTxt}>Marcar minhas férias</Text>
              </TouchableOpacity>
              <Text style={styles.secao}>Minhas férias</Text>
              {doAnalista.length === 0
                ? <Text style={styles.vazio}>Nenhuma férias marcada.</Text>
                : doAnalista.map(renderItem)}
            </>
          )}

          <TouchableOpacity
            style={[styles.botaoSecundario, patientId && { marginTop: 0 }]}
            onPress={() => navigation.navigate('FormularioFerias', { tipo: 'cliente', patientId, patientNome })}
          >
            <Ionicons name="person-outline" size={17} color={COR.salvia} />
            <Text style={styles.botaoSecundarioTxt}>
              {patientNome ? `Marcar férias de ${patientNome}` : 'Marcar férias de um cliente'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.secao}>{patientId ? 'Férias marcadas' : 'Férias de clientes'}</Text>
          {deClientes.length === 0
            ? <Text style={styles.vazio}>Nenhuma férias marcada.</Text>
            : deClientes.map(renderItem)}

          <Text style={styles.nota}>
            Nas férias, a agenda mostra os horários como férias e o financeiro se ajusta sozinho:
            férias paga é cobrada como sessão feita; não paga sai da conta. Quem paga mensalidade
            fixa tem desconto proporcional às sessões de férias não pagas.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COR.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lista: { padding: 16, gap: 10 },
  botaoPrincipal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COR.salvia, borderRadius: 12, padding: 14,
  },
  botaoPrincipalTxt: { color: '#FFFFFF', fontWeight: '500', fontSize: 15, lineHeight: 21 },
  botaoSecundario: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COR.salviaVeu, borderRadius: 12, padding: 13, marginTop: 14,
    borderWidth: 1, borderColor: '#A8CBBA',
  },
  botaoSecundarioTxt: { color: COR.salvia, fontWeight: '500', fontSize: 14, lineHeight: 20 },
  secao: { fontSize: 12, fontWeight: '600', color: COR.t500, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, lineHeight: 17 },
  vazio: { color: COR.t500, fontStyle: 'italic', fontSize: 13, lineHeight: 19 },
  cartao: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COR.cartao, borderRadius: 14, padding: 14,
    borderLeftWidth: 4, borderLeftColor: '#8E7BAA',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  nome: { fontSize: 15, fontWeight: '500', color: COR.t900, lineHeight: 21 },
  periodo: { fontSize: 15, color: COR.t900, lineHeight: 21 },
  detalhe: { fontSize: 13, color: COR.t700, marginTop: 2, lineHeight: 19 },
  obs: { fontSize: 12, color: COR.t500, marginTop: 4, lineHeight: 17 },
  selo: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COR.salviaVeu },
  seloAgora: { backgroundColor: COR.lavandaVeu },
  seloPassou: { backgroundColor: '#F1EDE5' },
  seloTxt: { fontSize: 11, color: COR.salvia, fontWeight: '500', lineHeight: 15 },
  nota: { fontSize: 12, color: COR.t500, marginTop: 18, lineHeight: 18 },
});
