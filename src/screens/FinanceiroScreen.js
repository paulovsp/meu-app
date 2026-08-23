import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getPlanoFinanceiro, getRecebimentosDoMes, calcularStatusGeralRecebimentos,
  calcularStatusItemRecebimento, filtrarRecebimentosMensais, getSessoesPagasNoIntervalo,
  formatarMoeda,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { useSwipeHorizontal } from '../hooks/useSwipeHorizontal';
import MenuLateral from '../components/MenuLateral';
import CabecalhoTela from '../components/CabecalhoTela';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PERIODOS = [
  { valor: 'diario',  label: 'Diário'  },
  { valor: 'semanal', label: 'Semanal' },
  { valor: 'mensal',  label: 'Mensal'  },
];

function labelModalidade(modality) {
  if (modality === 'online') return 'Online';
  if (modality === 'presencial') return 'Presencial';
  return 'Ambos';
}

function toISO(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function getInicioSemana(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getFimSemana(inicioSemana) {
  const fim = new Date(inicioSemana);
  fim.setDate(fim.getDate() + 6);
  return fim;
}

function addDias(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Pior status entre uma lista (vermelho > amarelo > verde) — mesmo critério
// de calcularStatusGeralRecebimentos, aplicado à previsão de sessões por
// sessão (diário/semanal), que não passa pela tabela `pagamentos` do mesmo
// jeito que a cobrança mensal.
function piorStatus(statuses) {
  if (statuses.includes('vermelho')) return 'vermelho';
  if (statuses.includes('amarelo')) return 'amarelo';
  return 'verde';
}

// Status por ocorrência de sessão avulsa (cobrança "por sessão"): verde se
// já paga; senão, vermelho só se a data já passou (antes de hoje) — o
// próprio dia da sessão ainda conta como "não vencido", mesmo padrão usado
// pra cobrança mensal (calcularStatusItemRecebimento).
function statusSessaoPorData(dataISO, hojeISO, paga) {
  if (paga) return 'verde';
  return dataISO < hojeISO ? 'vermelho' : 'amarelo';
}

function CardTotal({ label, valor, cor, flex }) {
  // Amarelo de verdade (não um dourado escuro) só fica legível com texto
  // escuro em cima — os outros dois (verde/vermelho) continuam com texto
  // branco normalmente.
  const textoEscuro = cor === 'amarelo';
  return (
    <View
      style={[
        s.cardTotal,
        flex && { flex: 1 },
        cor === 'vermelho' && s.cardTotalVermelho,
        cor === 'amarelo' && s.cardTotalAmarelo,
        cor === 'verde' && s.cardTotalVerde,
      ]}
    >
      <Text style={[s.cardTotalLabel, textoEscuro && s.cardTotalLabelEscuro]}>{label}</Text>
      <Text style={[s.cardTotalValor, textoEscuro && s.cardTotalValorEscuro]}>{formatarMoeda(valor)}</Text>
    </View>
  );
}

const COR_VALOR = {
  verde: '#44745B',
  amarelo: '#7D6540',
  vermelho: '#975451',
};

function LinhaItem({ icon, titulo, subtitulo, valor, cor }) {
  return (
    <View style={s.linha}>
      <View style={s.linhaIconBadge}>
        <Ionicons name={icon} size={18} color="#497363" />
      </View>
      <View style={s.linhaInfo}>
        <Text style={s.linhaTitulo} numberOfLines={1}>{titulo}</Text>
        {subtitulo ? <Text style={s.linhaSubtitulo}>{subtitulo}</Text> : null}
      </View>
      <Text style={[s.linhaValor, { color: COR_VALOR[cor] || COR_VALOR.verde }]}>{formatarMoeda(valor)}</Text>
    </View>
  );
}

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="cash-outline" size={36} color="#A9A299" />
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

export default function FinanceiroScreen() {
  const navigation = useNavigation();
  const [periodo, setPeriodo] = useState('mensal');
  const [plano, setPlano] = useState(null);
  // "Recebido" (item 8) — só faz sentido no período mensal, cruzado com a
  // tabela `pagamentos` (o previsto sozinho já vem do plano financeiro).
  const [totalRecebido, setTotalRecebido] = useState(0);
  const [corRecebimento, setCorRecebimento] = useState('verde');
  // Status (verde/amarelo/vermelho) de cada analisante de cobrança mensal,
  // pra colorir o valor na lista "Por analisante" com a mesma lógica dos
  // cards de cima — chave patient_id.
  const [statusPorPaciente, setStatusPorPaciente] = useState({});
  // Ocorrências (patient_id_data_horaInicio) de cobrança "por sessão" já
  // pagas nesta semana — cobre tanto a visão diária quanto a semanal.
  const [sessoesPagas, setSessoesPagas] = useState(new Set());
  const [menuAberto, setMenuAberto] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const hoje = new Date();
          const inicioSemana = getInicioSemana(hoje);
          const fimSemana = getFimSemana(inicioSemana);
          const [planoResultado, recebimentos, pagas] = await Promise.all([
            getPlanoFinanceiro(hoje),
            getRecebimentosDoMes(hoje.getFullYear(), hoje.getMonth()),
            getSessoesPagasNoIntervalo(toISO(inicioSemana), toISO(fimSemana)),
          ]);
          setPlano(planoResultado);
          setSessoesPagas(pagas);

          // "Recebido" mensal só considera cobrança mensal/mensal-fixo — por
          // sessão tem sua própria dinâmica (diário/semanal), separada aqui.
          const recebimentosMensais = filtrarRecebimentosMensais(recebimentos);
          setTotalRecebido(
            recebimentosMensais.filter((r) => r.recebido).reduce((acc, r) => acc + (r.valorPrevisto || 0), 0)
          );
          setCorRecebimento(calcularStatusGeralRecebimentos(recebimentosMensais));
          const mapa = {};
          recebimentosMensais.forEach((r) => { mapa[r.patient_id] = calcularStatusItemRecebimento(r); });
          setStatusPorPaciente(mapa);
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

  const acoesHeader = (
    <TouchableOpacity onPress={() => setMenuAberto(true)} style={{ padding: 6 }}>
      <Ionicons name="menu-outline" size={24} color="#FFFFFF" />
    </TouchableOpacity>
  );

  if (!plano) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <CabecalhoTela titulo="Financeiro" onVoltar={() => navigation.goBack()} acoes={acoesHeader} />
        <View style={s.carregandoWrap}>
          <ActivityIndicator size="large" color="#497363" />
        </View>
      </SafeAreaView>
    );
  }

  const semAgenda = !plano.temAlgumHorario;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <CabecalhoTela titulo="Financeiro" onVoltar={() => navigation.goBack()} acoes={acoesHeader} />
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
            {periodo === 'diario' && (() => {
              const hojeISO = toISO(new Date());
              const itensPorSessao = plano.itensDiario
                .filter((item) => item.tipo_cobranca === 'por_sessao')
                .map((item) => {
                  const paga = sessoesPagas.has(`${item.patient_id}_${hojeISO}_${item.start_time}`);
                  return { ...item, cor: statusSessaoPorData(hojeISO, hojeISO, paga), paga };
                });
              const totalPrevisto = itensPorSessao.reduce((acc, item) => acc + item.preco, 0);
              const totalRecebidoHoje = itensPorSessao.filter((item) => item.paga).reduce((acc, item) => acc + item.preco, 0);
              const corGeral = piorStatus(itensPorSessao.map((item) => item.cor));

              return (
                <>
                  <View style={s.cardTotalRow}>
                    <CardTotal label={`Previsto hoje (${DIAS_LABEL[plano.diaSemanaHoje]})`} valor={totalPrevisto} flex />
                    <CardTotal label="Recebido hoje" valor={totalRecebidoHoje} cor={corGeral} flex />
                  </View>
                  <View style={s.secao}>
                    <Text style={s.secaoTitulo}>Sessões de hoje (pagamento por sessão)</Text>
                    {itensPorSessao.length === 0 ? (
                      <Vazio texto="Nenhuma sessão com pagamento por sessão prevista para hoje." />
                    ) : (
                      itensPorSessao.map((item, i) => (
                        <LinhaItem
                          key={`${item.patient_id}-${i}`}
                          icon="mic-outline"
                          titulo={item.nome}
                          subtitulo={`${item.start_time}${item.end_time ? `–${item.end_time}` : ''} · ${labelModalidade(item.modality)}`}
                          valor={item.preco}
                          cor={item.cor}
                        />
                      ))
                    )}
                  </View>
                </>
              );
            })()}

            {periodo === 'semanal' && (() => {
              const hojeISO = toISO(new Date());
              const inicioSemana = getInicioSemana(new Date());
              const itensPorSessao = plano.itensSemanal
                .filter((item) => item.tipo_cobranca === 'por_sessao')
                .map((item) => {
                  const dataItemISO = toISO(addDias(inicioSemana, item.day_of_week));
                  const paga = sessoesPagas.has(`${item.patient_id}_${dataItemISO}_${item.start_time}`);
                  return { ...item, cor: statusSessaoPorData(dataItemISO, hojeISO, paga), paga };
                });
              const totalPrevisto = itensPorSessao.reduce((acc, item) => acc + item.preco, 0);
              const totalRecebidoSemana = itensPorSessao.filter((item) => item.paga).reduce((acc, item) => acc + item.preco, 0);
              const corGeral = piorStatus(itensPorSessao.map((item) => item.cor));

              return (
                <>
                  <View style={s.cardTotalRow}>
                    <CardTotal label="Previsto esta semana" valor={totalPrevisto} flex />
                    <CardTotal label="Recebido esta semana" valor={totalRecebidoSemana} cor={corGeral} flex />
                  </View>
                  <View style={s.secao}>
                    <Text style={s.secaoTitulo}>Sessões da semana (pagamento por sessão)</Text>
                    {itensPorSessao.length === 0 ? (
                      <Vazio texto="Nenhuma sessão com pagamento por sessão prevista para esta semana." />
                    ) : (
                      itensPorSessao.map((item, i) => (
                        <LinhaItem
                          key={`${item.patient_id}-${i}`}
                          icon="calendar-outline"
                          titulo={item.nome}
                          subtitulo={`${DIAS_LABEL[item.day_of_week]} ${item.start_time}${item.end_time ? `–${item.end_time}` : ''} · ${labelModalidade(item.modality)}`}
                          valor={item.preco}
                          cor={item.cor}
                        />
                      ))
                    )}
                  </View>
                </>
              );
            })()}

            {periodo === 'mensal' && (() => {
              // Só cobrança mensal/mensal-fixo aqui — por sessão tem sua
              // própria previsão (diário/semanal), sem cronograma mensal.
              const itensMensalFiltrados = plano.itensMensal.filter((item) => item.tipo_cobranca !== 'por_sessao');
              const totalMensalFiltrado = itensMensalFiltrados.reduce((acc, item) => acc + item.subtotal, 0);

              return (
                <>
                  <View style={s.cardTotalRow}>
                    <CardTotal label="Previsto neste mês" valor={totalMensalFiltrado} flex />
                    <CardTotal label="Recebido" valor={totalRecebido} cor={corRecebimento} flex />
                  </View>
                  <View style={s.secao}>
                    <Text style={s.secaoTitulo}>Por analisante</Text>
                    {itensMensalFiltrados.length === 0 ? (
                      <Vazio texto="Nenhum analisante com cobrança mensal cadastrado ainda." />
                    ) : (
                      itensMensalFiltrados.map((item) => (
                        <LinhaItem
                          key={item.patient_id}
                          icon="person-outline"
                          titulo={item.nome}
                          subtitulo={`${item.sessoesMes} sessão${item.sessoesMes === 1 ? '' : 'ões'} no mês${item.dia_pagamento ? ` · paga todo dia ${item.dia_pagamento}` : ''}`}
                          valor={item.subtotal}
                          cor={statusPorPaciente[item.patient_id]}
                        />
                      ))
                    )}
                  </View>
                </>
              );
            })()}
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
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  carregandoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  toggleWrap: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#FDFCFA',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  toggleBtnAtivo: { backgroundColor: '#497363' },
  toggleTxt: { fontSize: 13, fontWeight: '600', color: '#756E66', lineHeight: 19 },
  toggleTxtAtivo: { color: '#fff' },

  scroll: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },

  cardTotalRow: { flexDirection: 'column', gap: 12 },
  cardTotal: {
    backgroundColor: '#497363',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTotalVermelho: { backgroundColor: '#975451' },
  cardTotalAmarelo: { backgroundColor: '#7D6540' },
  cardTotalVerde: { backgroundColor: '#44745B' },
  cardTotalLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
    marginRight: 12,
  },
  cardTotalValor: { fontSize: 26, color: '#fff', fontWeight: '600' },
  cardTotalLabelEscuro: { color: 'rgba(58,42,0,0.75)' },
  cardTotalValorEscuro: { color: '#6B5A3A' },

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
    marginBottom: 10,
  },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#EAE5DC',
  },
  linhaIconBadge: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#E3EAF1',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  linhaInfo: { flex: 1 },
  linhaTitulo: { fontSize: 14, fontWeight: '500', color: '#302C28', lineHeight: 20 },
  linhaSubtitulo: { fontSize: 12, color: '#8C857B', marginTop: 2, lineHeight: 17 },
  linhaValor: { fontSize: 14, fontWeight: '500', color: '#44745B', marginLeft: 8, lineHeight: 20 },

  vazio: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#8C857B', textAlign: 'center', lineHeight: 19 },
});
