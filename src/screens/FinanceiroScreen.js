import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getPlanoFinanceiro, formatarMoeda } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal';
import MenuLateral from '../components/MenuLateral';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PERIODOS = [
  { valor: 'diario',  label: 'Diário'  },
  { valor: 'semanal', label: 'Semanal' },
  { valor: 'mensal',  label: 'Mensal'  },
];

function labelModalidade(modality) {
  if (modality === 'online') return '💻 Online';
  if (modality === 'presencial') return '🏠 Presencial';
  return '🏠💻 Ambos';
}

function CardTotal({ label, valor }) {
  return (
    <View style={s.cardTotal}>
      <Text style={s.cardTotalLabel}>{label}</Text>
      <Text style={s.cardTotalValor}>{formatarMoeda(valor)}</Text>
    </View>
  );
}

function LinhaItem({ icon, titulo, subtitulo, valor }) {
  return (
    <View style={s.linha}>
      <View style={s.linhaIconBadge}>
        <Ionicons name={icon} size={18} color="#3D5A80" />
      </View>
      <View style={s.linhaInfo}>
        <Text style={s.linhaTitulo} numberOfLines={1}>{titulo}</Text>
        {subtitulo ? <Text style={s.linhaSubtitulo}>{subtitulo}</Text> : null}
      </View>
      <Text style={s.linhaValor}>{formatarMoeda(valor)}</Text>
    </View>
  );
}

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="cash-outline" size={36} color="#C7CDD6" />
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

export default function FinanceiroScreen() {
  const navigation = useNavigation();
  const [periodo, setPeriodo] = useState('mensal');
  const [plano, setPlano] = useState(null);
  const [menuAberto, setMenuAberto] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuAberto(true)} style={{ paddingHorizontal: 12 }}>
          <Ionicons name="menu-outline" size={26} color="#1A1A2E" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          setPlano(await getPlanoFinanceiro(new Date()));
        } catch (e) {
          Alert.alert('Erro ao carregar', mensagemDeErro(e));
        }
      })();
    }, [])
  );

  // Deslize horizontal troca de período (diário ⇄ semanal ⇄ mensal),
  // seguindo a ordem de PERIODOS — mesma sensação de arraste ao vivo
  // usada na Início e na Agenda.
  const indicePeriodo = PERIODOS.findIndex((p) => p.valor === periodo);
  const { panHandlers, animatedStyle } = useSwipeHorizontal({
    onSwipeLeft: () => {
      if (indicePeriodo < PERIODOS.length - 1) setPeriodo(PERIODOS[indicePeriodo + 1].valor);
    },
    onSwipeRight: () => {
      if (indicePeriodo > 0) setPeriodo(PERIODOS[indicePeriodo - 1].valor);
    },
  });

  if (!plano) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.carregandoWrap}>
          <ActivityIndicator size="large" color="#3D5A80" />
        </View>
      </SafeAreaView>
    );
  }

  const semAgenda = plano.itensSemanal.length === 0;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <View style={s.toggleWrap}>
        {PERIODOS.map((p) => (
          <TouchableOpacity
            key={p.valor}
            style={[s.toggleBtn, periodo === p.valor && s.toggleBtnAtivo]}
            onPress={() => setPeriodo(p.valor)}
          >
            <Text style={[s.toggleTxt, periodo === p.valor && s.toggleTxtAtivo]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...panHandlers}>
        <Animated.View style={animatedStyle}>
        {semAgenda ? (
          <Vazio texto={'Nenhum horário fixo com analisante vinculado ainda.\nCadastre a agenda e o preço da sessão na ficha do analisante para ver o plano financeiro aqui.'} />
        ) : (
          <>
            {periodo === 'diario' && (
              <>
                <CardTotal label={`Previsto hoje (${DIAS_LABEL[plano.diaSemanaHoje]})`} valor={plano.totalDiario} />
                <View style={s.secao}>
                  <Text style={s.secaoTitulo}>Sessões de hoje</Text>
                  {plano.itensDiario.length === 0 ? (
                    <Vazio texto="Nenhuma sessão fixa prevista para hoje." />
                  ) : (
                    plano.itensDiario.map((item, i) => (
                      <LinhaItem
                        key={`${item.patient_id}-${i}`}
                        icon="mic-outline"
                        titulo={item.nome}
                        subtitulo={`${item.start_time}${item.end_time ? `–${item.end_time}` : ''} · ${labelModalidade(item.modality)}`}
                        valor={item.preco}
                      />
                    ))
                  )}
                </View>
              </>
            )}

            {periodo === 'semanal' && (
              <>
                <CardTotal label="Previsto esta semana" valor={plano.totalSemanal} />
                <View style={s.secao}>
                  <Text style={s.secaoTitulo}>Sessões fixas da semana</Text>
                  {plano.itensSemanal.map((item, i) => (
                    <LinhaItem
                      key={`${item.patient_id}-${i}`}
                      icon="calendar-outline"
                      titulo={item.nome}
                      subtitulo={`${DIAS_LABEL[item.day_of_week]} ${item.start_time}${item.end_time ? `–${item.end_time}` : ''} · ${labelModalidade(item.modality)}`}
                      valor={item.preco}
                    />
                  ))}
                </View>
              </>
            )}

            {periodo === 'mensal' && (
              <>
                <CardTotal label="Previsto neste mês" valor={plano.totalMensal} />
                <View style={s.secao}>
                  <Text style={s.secaoTitulo}>Por analisante</Text>
                  {plano.itensMensal.map((item) => (
                    <LinhaItem
                      key={item.patient_id}
                      icon="person-outline"
                      titulo={item.nome}
                      subtitulo={`${item.sessoesMes} sessão${item.sessoesMes === 1 ? '' : 'ões'} no mês${item.dia_pagamento ? ` · paga todo dia ${item.dia_pagamento}` : ''}`}
                      valor={item.subtotal}
                    />
                  ))}
                </View>

                <View style={s.secao}>
                  <Text style={s.secaoTitulo}>Cronograma de recebimentos</Text>
                  {plano.cronogramaRecebimentos.length === 0 ? (
                    <Vazio texto={'Nenhum analisante com dia de pagamento definido.\nAdicione o "Dia de pagamento" na ficha de cada analisante para ver aqui a previsão de quando o valor deve entrar.'} />
                  ) : (
                    plano.cronogramaRecebimentos.map((item) => (
                      <LinhaItem
                        key={item.patient_id}
                        icon="wallet-outline"
                        titulo={item.nome}
                        subtitulo={`Recebimento previsto todo dia ${item.dia_pagamento}`}
                        valor={item.subtotal}
                      />
                    ))
                  )}
                </View>
              </>
            )}
          </>
        )}
        </Animated.View>
      </ScrollView>

      <MenuLateral
        visible={menuAberto}
        onClose={() => setMenuAberto(false)}
        navigation={navigation}
        clinicaButtons={CLINICA_BUTTONS}
        adminButtons={ADMIN_BUTTONS}
        contextual={{
          titulo: 'Financeiro',
          itens: PERIODOS.map((p) => ({
            icon: periodo === p.valor ? 'radio-button-on-outline' : 'radio-button-off-outline',
            label: `Ver ${p.label.toLowerCase()}`,
            onPress: () => setPeriodo(p.valor),
          })),
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  carregandoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  toggleWrap: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  toggleBtnAtivo: { backgroundColor: '#3D5A80' },
  toggleTxt: { fontSize: 13, fontWeight: '600', color: '#6B6860' },
  toggleTxtAtivo: { color: '#fff' },

  scroll: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },

  cardTotal: {
    backgroundColor: '#3D5A80',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  cardTotalLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardTotalValor: { fontSize: 30, color: '#fff', fontWeight: '800' },

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
    marginBottom: 10,
  },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
  },
  linhaIconBadge: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#EBF3FB',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  linhaInfo: { flex: 1 },
  linhaTitulo: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  linhaSubtitulo: { fontSize: 12, color: '#888', marginTop: 2 },
  linhaValor: { fontSize: 14, fontWeight: '700', color: '#1e9e63', marginLeft: 8 },

  vazio: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 19 },
});
