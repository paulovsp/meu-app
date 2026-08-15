import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Calendar } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import {
  getRecebimentosDoMes,
  marcarPagamentoRecebido,
  desmarcarPagamentoRecebido,
  formatarMoeda,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { montarMensagemCobranca } from '../services/mensagens';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';

const MESES_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function diasNoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

function toISODia(ano, mesIndex, dia) {
  const diaClamped = Math.min(dia, diasNoMes(ano, mesIndex));
  const mm = String(mesIndex + 1).padStart(2, '0');
  const dd = String(diaClamped).padStart(2, '0');
  return `${ano}-${mm}-${dd}`;
}

// Quantos dias se passaram desde o dia de pagamento (negativo = ainda não
// chegou, 0 = é hoje, positivo = em atraso).
function diasDesdeVencimento(ano, mesIndex, diaPagamento) {
  const vencimento = new Date(ano, mesIndex, Math.min(diaPagamento, diasNoMes(ano, mesIndex)));
  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((hojeSemHora - vencimento) / 86400000);
}

// Status visual da caixa de recebimento: verde (em dia) → amarelo (vence
// hoje) → vermelho (atrasado) → vermelho forte + borda (atrasado há mais
// de 7 dias). "Recebido" sempre vence os outros estados.
function statusRecebimento(item, ano, mesIndex) {
  if (item.recebido) return 'recebido';
  const diasAtraso = diasDesdeVencimento(ano, mesIndex, item.dia_pagamento);
  if (diasAtraso < 0) return 'em_dia';
  if (diasAtraso === 0) return 'no_dia';
  if (diasAtraso <= 7) return 'atrasado';
  return 'atrasado_grave';
}

const CORES_STATUS = {
  recebido:       { backgroundColor: 'rgba(30, 158, 99, 0.22)' },
  em_dia:         { backgroundColor: 'rgba(30, 158, 99, 0.08)' },
  no_dia:         { backgroundColor: 'rgba(224, 160, 48, 0.18)' },
  atrasado:       { backgroundColor: 'rgba(198, 57, 43, 0.10)' },
  atrasado_grave: { backgroundColor: 'rgba(198, 57, 43, 0.38)', borderWidth: 2, borderColor: '#E0A030' },
};

function limparTelefoneParaWhatsapp(telefone) {
  const digitos = (telefone || '').replace(/\D/g, '');
  if (!digitos) return null;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

function mensagemLembrete(item, profissional) {
  return montarMensagemCobranca(profissional, {
    nome: item.nome,
    valor: formatarMoeda(item.valorPrevisto),
    diaPagamento: item.dia_pagamento,
  });
}

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="wallet-outline" size={36} color="#C7CDD6" />
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

function LinhaSessao({ item }) {
  const rotuloSessoes = item.sessoesPagas === 1 ? '1 sessão paga' : `${item.sessoesPagas} sessões pagas`;
  return (
    <View style={s.linha}>
      <Ionicons name="receipt-outline" size={22} color={item.recebido ? '#1e9e63' : '#C7CDD6'} style={s.checkBtn} />
      <View style={s.linhaInfo}>
        <Text style={s.linhaNome} numberOfLines={1}>{item.nome}</Text>
        <Text style={s.linhaSub}>
          {rotuloSessoes} este mês · {formatarMoeda(item.valorPrevisto)}
        </Text>
      </View>
    </View>
  );
}

function LinhaRecebimento({ item, status, onToggle, onWhatsapp, onEmail, atualizando }) {
  // Cobrar (WhatsApp/e-mail) só faz sentido enquanto a sessão/mês ainda não
  // foi marcado como recebido — depois disso, insistir seria um lembrete
  // sem propósito.
  const podeCobrar = !item.recebido;

  return (
    <View style={[s.linhaRecebimento, CORES_STATUS[status]]}>
      <TouchableOpacity onPress={() => onToggle(item)} style={s.checkBtn} disabled={atualizando}>
        {atualizando ? (
          <ActivityIndicator size="small" color="#3D5A80" />
        ) : (
          <Ionicons
            name={item.recebido ? 'checkmark-circle' : 'ellipse-outline'}
            size={26}
            color={item.recebido ? '#1e9e63' : '#6B6860'}
          />
        )}
      </TouchableOpacity>

      <View style={s.linhaInfo}>
        <Text style={s.linhaNome} numberOfLines={1}>{item.nome}</Text>
        <Text style={s.linhaSub}>
          {item.recebido ? 'Recebido' : `Previsto dia ${item.dia_pagamento}`} · {formatarMoeda(item.valorPrevisto)}
        </Text>
      </View>

      <View style={s.linhaAcoes}>
        <TouchableOpacity
          style={[s.acaoBtn, !podeCobrar && s.acaoBtnDesabilitado]}
          onPress={() => onWhatsapp(item)}
          disabled={!podeCobrar}
        >
          <Ionicons name="logo-whatsapp" size={20} color={podeCobrar ? '#25D366' : '#C7CDD6'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.acaoBtn, !podeCobrar && s.acaoBtnDesabilitado]}
          onPress={() => onEmail(item)}
          disabled={!podeCobrar}
        >
          <Ionicons name="mail-outline" size={20} color={podeCobrar ? '#3D5A80' : '#C7CDD6'} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CobrancaScreen() {
  const { session } = useAuth();
  const hoje = new Date();
  const [refDate, setRefDate] = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [recebimentos, setRecebimentos] = useState([]);
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [atualizandoId, setAtualizandoId] = useState(null);
  const [profissional, setProfissional] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const ano = refDate.getFullYear();
  const mesIndex = refDate.getMonth();

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setRecebimentos(await getRecebimentosDoMes(ano, mesIndex));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [ano, mesIndex]);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('nome, pix_key, template_cobranca')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfissional(data || null));
  }, [session.user.id]);

  // Recarrega ao mudar de mês/ano (navegação dentro do calendário)...
  useEffect(() => { carregar(); }, [carregar]);
  // ...e também ao voltar o foco pra esta tela (ex: após editar um analisante).
  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function onMonthChange(m) {
    setRefDate(new Date(m.year, m.month - 1, 1));
    setDiaSelecionado(null);
  }

  async function alternarRecebido(item) {
    setAtualizandoId(item.patient_id);
    try {
      if (item.recebido) {
        await desmarcarPagamentoRecebido(item.patient_id, ano, mesIndex);
      } else {
        await marcarPagamentoRecebido(item.patient_id, ano, mesIndex, item.valorPrevisto);
      }
      await carregar();
    } catch (e) {
      Alert.alert('Erro ao atualizar', mensagemDeErro(e));
    } finally {
      setAtualizandoId(null);
    }
  }

  function enviarWhatsapp(item) {
    const numero = limparTelefoneParaWhatsapp(item.telefone);
    if (!numero) {
      Alert.alert('Sem telefone', `${item.nome} não tem telefone cadastrado na ficha.`);
      return;
    }
    Linking.openURL(`https://wa.me/${numero}?text=${encodeURIComponent(mensagemLembrete(item, profissional))}`);
  }

  function enviarEmail(item) {
    if (!item.email) {
      Alert.alert('Sem e-mail', `${item.nome} não tem e-mail cadastrado na ficha.`);
      return;
    }
    const assunto = encodeURIComponent('Lembrete de contribuição financeira');
    const corpo = encodeURIComponent(mensagemLembrete(item, profissional));
    Linking.openURL(`mailto:${item.email}?subject=${assunto}&body=${corpo}`);
  }

  // Cobrança "por sessão" não tem dia_pagamento — confirmada sessão a
  // sessão no Detalhe do Compromisso — então entra num resumo à parte,
  // sem toggle manual nem marcação no calendário.
  const recebimentosMensal = recebimentos.filter((r) => r.tipo_cobranca !== 'por_sessao');
  const recebimentosSessao = recebimentos.filter((r) => r.tipo_cobranca === 'por_sessao');

  // ── Marcações do calendário: um ponto por dia com recebimento previsto ──
  const markedDates = {};
  recebimentosMensal.forEach((r) => {
    const iso = toISODia(ano, mesIndex, r.dia_pagamento);
    const jaPendente = markedDates[iso]?.dotColor === '#E0A030';
    markedDates[iso] = {
      marked: true,
      dotColor: (jaPendente || !r.recebido) ? '#E0A030' : '#1e9e63',
    };
  });
  if (diaSelecionado) {
    markedDates[diaSelecionado] = {
      ...(markedDates[diaSelecionado] || {}),
      selected: true,
      selectedColor: '#3D5A80',
    };
  }

  // ── Alerta de hoje ──
  const ehMesAtual = ano === hoje.getFullYear() && mesIndex === hoje.getMonth();
  const recebimentosHoje = ehMesAtual
    ? recebimentosMensal.filter((r) => Math.min(r.dia_pagamento, diasNoMes(ano, mesIndex)) === hoje.getDate())
    : [];
  const pendentesHoje = recebimentosHoje.filter((r) => !r.recebido);

  const listaDoDia = diaSelecionado
    ? recebimentosMensal.filter((r) => toISODia(ano, mesIndex, r.dia_pagamento) === diaSelecionado)
    : recebimentosMensal;

  const tituloLista = diaSelecionado
    ? `Recebimentos em ${diaSelecionado.split('-').reverse().join('/')}`
    : `Recebimentos previstos em ${MESES_LABEL[mesIndex]}`;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {pendentesHoje.length > 0 && (
          <View style={s.alerta}>
            <Ionicons name="alert-circle" size={20} color="#B45309" />
            <Text style={s.alertaTexto}>
              Hoje (dia {hoje.getDate()}) há {pendentesHoje.length === 1 ? 'recebimento previsto' : `${pendentesHoje.length} recebimentos previstos`} de{' '}
              {pendentesHoje.map((r) => r.nome).join(', ')}.
            </Text>
          </View>
        )}

        <View style={s.calendarioCard}>
          <Calendar
            current={toISODia(ano, mesIndex, 1)}
            onMonthChange={onMonthChange}
            enableSwipeMonths
            onDayPress={(day) => setDiaSelecionado(
              day.dateString === diaSelecionado ? null : day.dateString
            )}
            markedDates={markedDates}
            theme={{
              todayTextColor: '#3D5A80',
              arrowColor: '#3D5A80',
              selectedDayBackgroundColor: '#3D5A80',
              dotColor: '#E0A030',
            }}
          />
        </View>

        <View style={s.secao}>
          <View style={s.secaoTituloRow}>
            <Text style={s.secaoTitulo}>{tituloLista}</Text>
            {diaSelecionado && (
              <TouchableOpacity onPress={() => setDiaSelecionado(null)}>
                <Text style={s.limparFiltro}>Ver mês inteiro</Text>
              </TouchableOpacity>
            )}
          </View>

          {carregando ? (
            <View style={s.carregandoWrap}>
              <ActivityIndicator size="large" color="#3D5A80" />
            </View>
          ) : listaDoDia.length === 0 ? (
            <Vazio
              texto={
                diaSelecionado
                  ? 'Nenhum recebimento previsto neste dia.'
                  : 'Nenhum analisante com dia de pagamento definido.\nAdicione o "Dia de pagamento" na ficha de cada analisante.'
              }
            />
          ) : (
            listaDoDia.map((item) => (
              <LinhaRecebimento
                key={item.patient_id}
                item={item}
                status={statusRecebimento(item, ano, mesIndex)}
                onToggle={alternarRecebido}
                onWhatsapp={enviarWhatsapp}
                onEmail={enviarEmail}
                atualizando={atualizandoId === item.patient_id}
              />
            ))
          )}
        </View>

        {recebimentosSessao.length > 0 && (
          <View style={s.secao}>
            <Text style={s.secaoTitulo}>Cobrança por sessão em {MESES_LABEL[mesIndex]}</Text>
            {recebimentosSessao.map((item) => (
              <LinhaSessao key={item.patient_id} item={item} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { padding: 16, paddingBottom: 32, gap: 16 },

  alerta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFF8E7',
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#E0A030',
  },
  alertaTexto: { flex: 1, fontSize: 13, color: '#7a6000', lineHeight: 18 },

  calendarioCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    overflow: 'hidden',
  },

  secao: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  secaoTituloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  secaoTitulo: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  limparFiltro: { fontSize: 12, fontWeight: '700', color: '#3D5A80' },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    gap: 10,
  },
  linhaRecebimento: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 8,
    gap: 10,
  },
  checkBtn: { padding: 2 },
  linhaInfo: { flex: 1 },
  linhaNome: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  linhaSub: { fontSize: 12, color: '#888', marginTop: 2 },
  linhaAcoes: { flexDirection: 'row', gap: 4 },
  acaoBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F7FA',
  },
  acaoBtnDesabilitado: { opacity: 0.4 },

  vazio: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  vazioTexto: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 19 },
  carregandoWrap: { alignItems: 'center', paddingVertical: 24 },
});
