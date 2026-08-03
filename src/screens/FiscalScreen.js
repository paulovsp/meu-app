import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getRecebimentosDoMes, salvarConfiguracaoFiscal, formatarMoeda } from '../services/database';
import { emitirParaPaciente, composePeriodoMensal, MESES_LABEL, capitalizar } from '../services/fiscalEmissao';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { mensagemDeErro } from '../services/erros';
import { assinaturaEstaAtiva, MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="document-text-outline" size={36} color="#C7CDD6" />
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

function ToggleTipoEmissao({ valor, onChange }) {
  return (
    <View style={s.toggle}>
      <TouchableOpacity
        style={[s.toggleOpcao, valor === 'recibo' && s.toggleOpcaoAtiva]}
        onPress={() => onChange('recibo')}
      >
        <Text style={[s.toggleTexto, valor === 'recibo' && s.toggleTextoAtivo]}>Recibo</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.toggleOpcao, valor === 'nota' && s.toggleOpcaoAtiva]}
        onPress={() => onChange('nota')}
      >
        <Text style={[s.toggleTexto, valor === 'nota' && s.toggleTextoAtivo]}>Nota</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FiscalScreen() {
  const { session } = useAuth();
  const navigation = useNavigation();
  const hoje = new Date();
  const [refDate, setRefDate] = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [recebimentos, setRecebimentos] = useState([]);
  const [user, setUser] = useState(null);
  const [emitindo, setEmitindo] = useState(null);

  const ano = refDate.getFullYear();
  const mesIndex = refDate.getMonth();
  const mesLabel = capitalizar(MESES_LABEL[mesIndex]);

  const carregar = useCallback(async () => {
    try {
      setRecebimentos(await getRecebimentosDoMes(ano, mesIndex));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    setUser(data || null);
  }, [ano, mesIndex, session.user.id]);

  useEffect(() => { carregar(); }, [carregar]);
  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function mudarMes(delta) {
    setRefDate(new Date(ano, mesIndex + delta, 1));
  }

  async function alterarTipoEmissao(item, novoTipo) {
    setRecebimentos((prev) => prev.map((r) => (
      r.patient_id === item.patient_id ? { ...r, tipo_emissao_fiscal: novoTipo } : r
    )));
    try {
      await salvarConfiguracaoFiscal(item.patient_id, { tipo_emissao_fiscal: novoTipo });
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
      await carregar();
    }
  }

  function abrirConfiguracaoAutomatica(item) {
    navigation.navigate('ConfiguracaoFiscalAutomatica', {
      patientId: item.patient_id,
      patientNome: item.nome,
    });
  }

  // Emissão manual, via botão "Emitir": sempre agrega o mês inteiro (mesmo
  // pra cobrança por sessão) — o recorte semanal só existe no catch-up
  // automático, que dispara com o contexto de "essa semana específica".
  async function emitir(item) {
    if (!user) return;
    if (!(await assinaturaEstaAtiva())) {
      Alert.alert('Assinatura inativa', MENSAGEM_ASSINATURA_INATIVA);
      return;
    }
    setEmitindo(item.patient_id);
    try {
      const periodo = composePeriodoMensal(MESES_LABEL[mesIndex], ano);
      const data = await emitirParaPaciente(item.tipo_emissao_fiscal, {
        profissional: user,
        paciente: item,
        valor: item.valorPrevisto,
        periodo,
      });

      if (item.tipo_emissao_fiscal === 'nota') {
        Alert.alert('Nota solicitada', `Resumo enviado para ${user.contador_email}, que vai emitir a nota fiscal e enviá-la a ${item.nome}.`);
      } else {
        const destinos = [];
        if (data?.enviadoPaciente) destinos.push(item.email);
        if (data?.enviadoContador) destinos.push(user.contador_email);

        if (destinos.length === 0) {
          Alert.alert('Nada enviado', 'Nenhum e-mail foi enviado. Confira os e-mails cadastrados do analisante e do contador.');
        } else {
          Alert.alert('Recibo enviado', `Enviado automaticamente para: ${destinos.join(' e ')}.`);
        }
      }
    } catch (e) {
      Alert.alert('Erro ao enviar', e?.message || 'Tente novamente.');
    } finally {
      setEmitindo(null);
    }
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.navMes}>
          <TouchableOpacity onPress={() => mudarMes(-1)}>
            <Ionicons name="chevron-back" size={22} color="#3D5A80" />
          </TouchableOpacity>
          <Text style={s.navMesTexto}>{mesLabel} de {ano}</Text>
          <TouchableOpacity onPress={() => mudarMes(1)}>
            <Ionicons name="chevron-forward" size={22} color="#3D5A80" />
          </TouchableOpacity>
        </View>

        <View style={s.secao}>
          <Text style={s.secaoTitulo}>Recibos/Notas por analisante</Text>
          {recebimentos.length === 0 ? (
            <Vazio texto={'Nenhum analisante com cobrança definida para este mês.'} />
          ) : (
            recebimentos.map((item) => (
              <View key={item.patient_id} style={s.linha}>
                <View style={s.linhaTopo}>
                  <View style={s.linhaInfo}>
                    <Text style={s.linhaNome} numberOfLines={1}>{item.nome}</Text>
                    <Text style={s.linhaSub}>
                      {item.recebido ? 'Recebido' : 'Aguardando confirmação de recebimento'} · {formatarMoeda(item.valorPrevisto)}
                    </Text>
                  </View>
                  <ToggleTipoEmissao
                    valor={item.tipo_emissao_fiscal}
                    onChange={(tipo) => alterarTipoEmissao(item, tipo)}
                  />
                </View>

                <View style={s.linhaAcoes}>
                  <TouchableOpacity
                    style={[s.automaticoBtn, item.fiscal_frequencia_automatica && s.automaticoBtnAtivo]}
                    onPress={() => abrirConfiguracaoAutomatica(item)}
                  >
                    {item.fiscal_frequencia_automatica ? (
                      <Ionicons name="checkmark-circle" size={14} color="#fff" />
                    ) : (
                      <Ionicons name="repeat-outline" size={14} color="#3D5A80" />
                    )}
                    <Text style={[s.automaticoBtnTexto, item.fiscal_frequencia_automatica && s.automaticoBtnTextoAtivo]}>
                      Automático
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.emitirBtn, !item.recebido && s.emitirBtnDesabilitado]}
                    disabled={!item.recebido || emitindo === item.patient_id}
                    onPress={() => emitir(item)}
                  >
                    {emitindo === item.patient_id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Ionicons name="receipt-outline" size={15} color="#fff" />
                        <Text style={s.emitirBtnTexto}>Emitir</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
          <Text style={s.secaoHint}>
            Recibo: enviado direto ao analisante (e cópia ao contador). Nota: só um
            resumo é enviado ao contador{!!user?.contador_email && ` (${user.contador_email})`},
            que emite a nota fiscal e a envia ao analisante.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { padding: 16, paddingBottom: 32, gap: 16 },

  navMes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  navMesTexto: { fontSize: 15, fontWeight: '700', color: '#1A1A2E' },

  secao: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  secaoTitulo: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  secaoHint: { fontSize: 13, color: '#6B6860', lineHeight: 18, marginTop: 4 },

  linha: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    gap: 8,
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linhaInfo: { flex: 1 },
  linhaNome: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  linhaSub: { fontSize: 12, color: '#888', marginTop: 2 },

  toggle: {
    flexDirection: 'row',
    backgroundColor: '#F0F2F5',
    borderRadius: 10,
    padding: 2,
  },
  toggleOpcao: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  toggleOpcaoAtiva: { backgroundColor: '#3D5A80' },
  toggleTexto: { fontSize: 11, fontWeight: '700', color: '#777' },
  toggleTextoAtivo: { color: '#fff' },

  linhaAcoes: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  automaticoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3D5A80',
  },
  automaticoBtnAtivo: {
    backgroundColor: '#1e9e63',
    borderColor: '#1e9e63',
  },
  automaticoBtnTexto: { color: '#3D5A80', fontSize: 12, fontWeight: '700' },
  automaticoBtnTextoAtivo: { color: '#fff' },

  emitirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3D5A80',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  emitirBtnDesabilitado: { backgroundColor: '#C7CDD6' },
  emitirBtnTexto: { color: '#fff', fontSize: 13, fontWeight: '700' },

  vazio: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 19 },
});
