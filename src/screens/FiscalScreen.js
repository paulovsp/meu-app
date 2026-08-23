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
import MenuLateral from '../components/MenuLateral';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="document-text-outline" size={36} color="#A9A299" />
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
  const [carregando, setCarregando] = useState(true);
  const [menuAberto, setMenuAberto] = useState(false);

  const ano = refDate.getFullYear();
  const mesIndex = refDate.getMonth();
  const mesLabel = capitalizar(MESES_LABEL[mesIndex]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuAberto(true)} style={{ paddingHorizontal: 12 }}>
          <Ionicons name="menu-outline" size={26} color="#302C28" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [recebimentosResultado, perfilResultado] = await Promise.allSettled([
      getRecebimentosDoMes(ano, mesIndex),
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
    ]);
    if (recebimentosResultado.status === 'fulfilled') {
      setRecebimentos(recebimentosResultado.value);
    } else {
      Alert.alert('Erro ao carregar', mensagemDeErro(recebimentosResultado.reason));
    }
    if (perfilResultado.status === 'fulfilled') {
      setUser(perfilResultado.value.data || null);
    }
    setCarregando(false);
  }, [ano, mesIndex, session.user.id]);

  // useFocusEffect já cobre a montagem inicial e o retorno de foco — um
  // useEffect adicional aqui rodava carregar() em dobro logo na abertura
  // da tela, dobrando as consultas ao Supabase à toa.
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
            <Ionicons name="chevron-back" size={22} color="#497363" />
          </TouchableOpacity>
          <Text style={s.navMesTexto}>{mesLabel} de {ano}</Text>
          <TouchableOpacity onPress={() => mudarMes(1)}>
            <Ionicons name="chevron-forward" size={22} color="#497363" />
          </TouchableOpacity>
        </View>

        <View style={s.secao}>
          <Text style={s.secaoTitulo}>Recibos/Notas por analisante</Text>
          {carregando ? (
            <View style={s.carregandoWrap}>
              <ActivityIndicator size="large" color="#497363" />
            </View>
          ) : recebimentos.length === 0 ? (
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
                      <Ionicons name="repeat-outline" size={14} color="#497363" />
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

      <MenuLateral
        visible={menuAberto}
        onClose={() => setMenuAberto(false)}
        navigation={navigation}
        clinicaButtons={CLINICA_BUTTONS}
        adminButtons={ADMIN_BUTTONS}
        contextual={{
          titulo: 'Fiscal',
          itens: [
            { icon: 'today-outline', label: 'Ir para o mês atual', onPress: () => setRefDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1)) },
          ],
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  scroll: { padding: 16, paddingBottom: 32, gap: 16 },

  navMes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FDFCFA',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  navMesTexto: { fontSize: 15, fontWeight: '500', color: '#302C28', lineHeight: 22 },

  secao: {
    backgroundColor: '#FDFCFA',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  secaoTitulo: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8C857B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  secaoHint: { fontSize: 13, color: '#756E66', lineHeight: 18, marginTop: 4 },

  linha: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#EAE5DC',
    gap: 8,
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linhaInfo: { flex: 1 },
  linhaNome: { fontSize: 14, fontWeight: '500', color: '#302C28', lineHeight: 20 },
  linhaSub: { fontSize: 12, color: '#8C857B', marginTop: 2, lineHeight: 17 },

  toggle: {
    flexDirection: 'row',
    backgroundColor: '#EAE5DC',
    borderRadius: 10,
    padding: 2,
  },
  toggleOpcao: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  toggleOpcaoAtiva: { backgroundColor: '#497363' },
  toggleTexto: { fontSize: 11, fontWeight: '500', color: '#8C857B', lineHeight: 16 },
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
    borderColor: '#497363',
  },
  automaticoBtnAtivo: {
    backgroundColor: '#44745B',
    borderColor: '#44745B',
  },
  automaticoBtnTexto: { color: '#497363', fontSize: 12, fontWeight: '500', lineHeight: 17 },
  automaticoBtnTextoAtivo: { color: '#fff' },

  emitirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#497363',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  emitirBtnDesabilitado: { backgroundColor: '#A9A299' },
  emitirBtnTexto: { color: '#fff', fontSize: 13, fontWeight: '500', lineHeight: 19 },

  vazio: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#8C857B', textAlign: 'center', lineHeight: 19 },
  carregandoWrap: { alignItems: 'center', paddingVertical: 24 },
});
