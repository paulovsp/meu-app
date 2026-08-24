import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getSessoesCobrancaDoMes, getPatientById, confirmarPagamentoSessao,
  deletarPagamentoDeAppointment, parsePreco, converterParaBRL, formatarMoeda,
} from '../services/database';
import { dataISOParaBR } from '../services/validacao';
import { mensagemDeErro } from '../services/erros';
import CabecalhoTela from '../components/CabecalhoTela';

const MESES_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Drill-down de um analisante de cobrança "por sessão" (aberto ao tocar na
// linha dele em CobrancaScreen.js) — antes só mostrava o total já recebido
// no mês, sem nenhuma forma de ver ou mexer sessão a sessão. Aqui lista toda
// sessão cobrável do mês (realizada ou falta — cancelada nunca cobra) e
// permite marcar/desmarcar o pagamento de cada uma, tocando na própria linha.
export default function DetalheCobrancaSessaoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { patientId, patientNome, ano, mesIndex } = route.params;

  const [sessoes, setSessoes] = useState([]);
  const [paciente, setPaciente] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizandoId, setAtualizandoId] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [lista, pac] = await Promise.all([
        getSessoesCobrancaDoMes(patientId, ano, mesIndex),
        getPatientById(patientId),
      ]);
      setSessoes(lista);
      setPaciente(pac);
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [patientId, ano, mesIndex]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  async function alternarPagamento(sessao) {
    setAtualizandoId(sessao.appointmentId);
    try {
      if (sessao.pago) {
        // Num grupo, o compromisso tem um pagamento POR integrante — apagar
        // só pelo appointment_id derrubaria o de todo mundo. Por isso o
        // patient_id entra sempre.
        await deletarPagamentoDeAppointment(sessao.appointmentId, patientId);
      } else {
        // Sessão de grupo cobra o valor combinado pro grupo; individual, o
        // preço da ficha (convertido, se estiver em moeda estrangeira).
        const valor = sessao.valorSugerido != null
          ? Number(sessao.valorSugerido)
          : await converterParaBRL(parsePreco(paciente?.preco_sessao), paciente?.preco_moeda);
        await confirmarPagamentoSessao(sessao.appointmentId, patientId, sessao.date, valor);
      }
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
    } finally {
      setAtualizandoId(null);
    }
  }

  const pagas = sessoes.filter((item) => item.pago);
  const totalPago = pagas.reduce((soma, item) => soma + Number(item.valorPago || 0), 0);

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <CabecalhoTela titulo={patientNome || 'Cobrança por sessão'} onVoltar={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.subtitulo}>{MESES_LABEL[mesIndex]} de {ano}</Text>

        <View style={s.resumoCard}>
          <Text style={s.resumoLabel}>Recebido este mês</Text>
          <Text style={s.resumoValor}>{formatarMoeda(totalPago)}</Text>
          <Text style={s.resumoSub}>
            {pagas.length === 1 ? '1 sessão paga' : `${pagas.length} sessões pagas`} de {sessoes.length}
          </Text>
        </View>

        {carregando ? (
          <View style={s.carregandoWrap}>
            <ActivityIndicator size="large" color="#497363" />
          </View>
        ) : sessoes.length === 0 ? (
          <View style={s.vazio}>
            <Ionicons name="receipt-outline" size={36} color="#A9A299" />
            <Text style={s.vazioTexto}>Nenhuma sessão realizada neste mês ainda.</Text>
          </View>
        ) : (
          sessoes.map((item) => (
            <TouchableOpacity
              key={item.appointmentId}
              style={[s.linha, item.pago && s.linhaPaga]}
              onPress={() => alternarPagamento(item)}
              disabled={atualizandoId === item.appointmentId}
            >
              {atualizandoId === item.appointmentId ? (
                <ActivityIndicator size="small" color="#497363" style={s.checkIcon} />
              ) : (
                <Ionicons
                  name={item.pago ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={item.pago ? '#44745B' : '#756E66'}
                  style={s.checkIcon}
                />
              )}
              <View style={s.linhaInfo}>
                <Text style={s.linhaData}>
                  {dataISOParaBR(item.date)}
                  {item.emGrupo ? '  ·  em grupo' : ''}
                </Text>
                <Text style={s.linhaSub}>
                  {(item.startTime || '').slice(0, 5)} · {item.status === 'nao_realizado' ? 'Falta' : 'Realizada'}
                  {item.emGrupo && item.presente === false ? ' (faltou)' : ''}
                  {item.pago
                    ? ` · ${formatarMoeda(item.valorPago)}`
                    : item.valorSugerido != null
                      ? ` · Pendente ${formatarMoeda(item.valorSugerido)}`
                      : ' · Pendente'}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  scroll: { padding: 16, paddingBottom: 32, gap: 12 },

  subtitulo: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8C857B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  resumoCard: {
    backgroundColor: '#FDFCFA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EAE5DC',
    padding: 18,
    alignItems: 'center',
  },
  resumoLabel: { fontSize: 12, color: '#8C857B', lineHeight: 17 },
  resumoValor: { fontSize: 28, fontWeight: '600', color: '#302C28', marginTop: 2, lineHeight: 34 },
  resumoSub: { fontSize: 12.5, color: '#8C857B', marginTop: 4, lineHeight: 18 },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FDFCFA',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  linhaPaga: { backgroundColor: 'rgba(30, 158, 99, 0.08)' },
  checkIcon: { width: 26 },
  linhaInfo: { flex: 1 },
  linhaData: { fontSize: 14, fontWeight: '500', color: '#302C28', lineHeight: 20 },
  linhaSub: { fontSize: 12.5, color: '#8C857B', marginTop: 2, lineHeight: 18 },

  vazio: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#8C857B', textAlign: 'center', lineHeight: 19 },
  carregandoWrap: { alignItems: 'center', paddingVertical: 24 },
});
