import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getConsentimentoPerfil, setConsentimentoPerfil,
  getRegistrosNaoAnalisados, analisarRegistroNucleos, analisarRegistroObjetivo,
  getEvidenciasNucleos, getEvidenciasObjetivo,
  validarStatusEvidenciaNucleo, validarStatusEvidenciaObjetivo, reclassificarEvidenciaNucleo,
} from '../services/database';
import { CATEGORIAS_OBJETIVO } from '../services/perfilObjetivo';
import { getRubricaSemente } from '../services/rubricas';

const MODOS = [
  { valor: 'objetivo', label: 'Objetivo' },
  { valor: 'subjetivo', label: 'Subjetivo' },
];

const RUBRICA = getRubricaSemente();
const NUCLEO_ORDEM = ['bem', 'mal', 'mau', 'bom'];

function labelNucleo(chave) {
  const n = RUBRICA.nucleos[chave];
  return n ? `${n.nome} · ${n.moral}` : chave;
}
function corNucleo(chave) {
  return RUBRICA.nucleos[chave]?.cor || '#888';
}

function formatarData(dataStr) {
  if (!dataStr) return '';
  try {
    return new Date(dataStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return dataStr; }
}

function Vazio({ texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name="document-text-outline" size={32} color="#C7CDD6" />
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

export default function PerfilPsicossomaticoScreen() {
  const route = useRoute();
  const paciente = route.params?.paciente;

  const [modo, setModo] = useState('objetivo');
  const [consentimento, setConsentimentoState] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [evidObjetivo, setEvidObjetivo] = useState([]);
  const [evidNucleos, setEvidNucleos] = useState([]);
  const [somenteValidado, setSomenteValidado] = useState(false);

  const carregar = useCallback(() => {
    setConsentimentoState(getConsentimentoPerfil(paciente.id));
    setEvidObjetivo(getEvidenciasObjetivo(paciente.id));
    setEvidNucleos(getEvidenciasNucleos(paciente.id));
  }, [paciente.id]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  function concederConsentimento() {
    Alert.alert(
      'Conceder consentimento',
      `${paciente.nome} concorda em ter registros e transcrições analisados por IA externa ` +
      '(o nome do analisante é substituído por um token antes de qualquer envio) para gerar o ' +
      'Perfil Psicossomático?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Conceder', onPress: () => { setConsentimentoPerfil(paciente.id, true); carregar(); } },
      ]
    );
  }

  function revogarConsentimento() {
    Alert.alert(
      'Revogar consentimento',
      'Bloqueia novas análises. As evidências já geradas continuam salvas até serem apagadas manualmente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Revogar', style: 'destructive', onPress: () => { setConsentimentoPerfil(paciente.id, false); carregar(); } },
      ]
    );
  }

  async function analisarNovos() {
    setAnalisando(true);
    try {
      const motor = modo === 'objetivo' ? 'objetivo' : 'nucleos';
      const registros = getRegistrosNaoAnalisados(paciente.id, motor);
      if (registros.length === 0) {
        Alert.alert('Tudo em dia', 'Não há registros novos para analisar nesta aba.');
        return;
      }
      for (let i = 0; i < registros.length; i++) {
        setProgresso(`Analisando ${i + 1} de ${registros.length}...`);
        if (motor === 'objetivo') {
          await analisarRegistroObjetivo(paciente, registros[i]);
        } else {
          await analisarRegistroNucleos(paciente, registros[i]);
        }
      }
      carregar();
    } catch (e) {
      Alert.alert('Erro na análise', e?.message || 'Tente novamente.');
    } finally {
      setAnalisando(false);
      setProgresso('');
    }
  }

  function reclassificar(evidencia) {
    const opcoes = NUCLEO_ORDEM
      .filter((n) => n !== evidencia.nucleo)
      .map((n) => ({ text: labelNucleo(n), onPress: () => { reclassificarEvidenciaNucleo(evidencia.id, n, null); carregar(); } }));
    Alert.alert('Reclassificar para qual núcleo?', evidencia.trecho_literal, [
      ...opcoes,
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  if (!paciente) return null;
  if (!consentimento) return null;

  if (!consentimento.concedido) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.bloqueio}>
          <Ionicons name="shield-checkmark-outline" size={48} color="#C7CDD6" />
          <Text style={s.bloqueioTitulo}>Consentimento necessário</Text>
          <Text style={s.bloqueioTexto}>
            O Perfil Psicossomático analisa registros e transcrições de {paciente.nome} com IA
            externa (o nome é substituído por um token antes do envio, nunca enviado em texto
            puro). Antes de usar, é preciso o consentimento do analisante.
          </Text>
          <TouchableOpacity style={s.btnConsentir} onPress={concederConsentimento}>
            <Text style={s.btnConsentirTexto}>Conceder consentimento</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const evidenciasNucleosFiltradas = somenteValidado
    ? evidNucleos.filter((e) => e.status_validacao === 'confirmada')
    : evidNucleos;
  const porNucleo = { bem: 0, mal: 0, mau: 0, bom: 0 };
  evidenciasNucleosFiltradas.forEach((e) => { if (porNucleo[e.nucleo] !== undefined) porNucleo[e.nucleo]++; });
  const totalComNucleo = NUCLEO_ORDEM.reduce((acc, n) => acc + porNucleo[n], 0);
  const pendentesNucleos = evidNucleos.filter((e) => e.status_validacao === 'pendente');
  const indizíveis = evidenciasNucleosFiltradas.filter((e) => e.nucleo === 'eu_nuclear').length;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <View style={s.toggleWrap}>
        {MODOS.map((m) => (
          <TouchableOpacity
            key={m.valor}
            style={[s.toggleBtn, modo === m.valor && s.toggleBtnAtivo]}
            onPress={() => setModo(m.valor)}
          >
            <Text style={[s.toggleTxt, modo === m.valor && s.toggleTxtAtivo]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.disclaimer}>
          <Ionicons name="information-circle-outline" size={16} color="#6B6860" />
          <Text style={s.disclaimerTexto}>
            Mapa de hipóteses baseado em densidade de referências — instrumento de apoio à
            hipótese diagnóstica do clínico; não constitui diagnóstico.
          </Text>
        </View>

        <TouchableOpacity style={s.btnAnalisar} onPress={analisarNovos} disabled={analisando}>
          {analisando ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={s.btnAnalisarTexto}>{progresso || 'Analisando...'}</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={16} color="#fff" />
              <Text style={s.btnAnalisarTexto}>Analisar registros novos</Text>
            </>
          )}
        </TouchableOpacity>

        {modo === 'objetivo' ? (
          <>
            {CATEGORIAS_OBJETIVO.map((cat) => {
              const itens = evidObjetivo.filter((e) => e.categoria === cat.chave);
              return (
                <View key={cat.chave} style={s.secao}>
                  <View style={s.secaoTituloRow}>
                    <Ionicons name={cat.icon} size={16} color="#3D5A80" />
                    <Text style={s.secaoTitulo}>{cat.label}</Text>
                  </View>
                  {itens.length === 0 ? (
                    <Text style={s.itemVazio}>Nenhuma menção encontrada ainda.</Text>
                  ) : (
                    itens.map((item) => (
                      <View key={item.id} style={s.itemObjetivo}>
                        <Text style={s.itemTrecho}>"{item.trecho_literal}"</Text>
                        <View style={s.itemRodape}>
                          <Text style={s.itemData}>{formatarData(item.data_registro)}</Text>
                          {item.status_validacao === 'pendente' ? (
                            <View style={s.itemAcoes}>
                              <TouchableOpacity onPress={() => { validarStatusEvidenciaObjetivo(item.id, 'confirmada'); carregar(); }}>
                                <Ionicons name="checkmark-circle" size={20} color="#1e9e63" />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => { validarStatusEvidenciaObjetivo(item.id, 'rejeitada'); carregar(); }}>
                                <Ionicons name="close-circle" size={20} color="#c0392b" />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <Text style={[s.itemStatus, item.status_validacao === 'rejeitada' && s.itemStatusRejeitado]}>
                              {item.status_validacao === 'confirmada' ? 'validado' : 'rejeitado'}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              );
            })}
          </>
        ) : (
          <>
            <View style={s.filtroRow}>
              <TouchableOpacity
                style={[s.filtroChip, !somenteValidado && s.filtroChipAtivo]}
                onPress={() => setSomenteValidado(false)}
              >
                <Text style={[s.filtroTxt, !somenteValidado && s.filtroTxtAtivo]}>Tudo que a IA marcou</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.filtroChip, somenteValidado && s.filtroChipAtivo]}
                onPress={() => setSomenteValidado(true)}
              >
                <Text style={[s.filtroTxt, somenteValidado && s.filtroTxtAtivo]}>Só validado</Text>
              </TouchableOpacity>
            </View>

            <View style={s.secao}>
              <Text style={s.secaoTitulo}>Densidade de referências por núcleo</Text>
              {totalComNucleo === 0 ? (
                <Vazio texto="Ainda sem evidências suficientes para calcular densidade." />
              ) : (
                NUCLEO_ORDEM.map((n) => {
                  const pct = totalComNucleo ? Math.round((porNucleo[n] / totalComNucleo) * 100) : 0;
                  return (
                    <View key={n} style={s.barraRow}>
                      <Text style={s.barraLabel}>{labelNucleo(n)}</Text>
                      <View style={s.barraTrilho}>
                        <View style={[s.barraFill, { width: `${pct}%`, backgroundColor: corNucleo(n) }]} />
                      </View>
                      <Text style={s.barraValor}>{pct}%</Text>
                    </View>
                  );
                })
              )}
              {indizíveis > 0 && (
                <Text style={s.notaIndizivel}>{indizíveis} trecho(s) no Eu nuclear (indizíveis).</Text>
              )}
            </View>

            <View style={s.secao}>
              <View style={s.secaoTituloRow}>
                <Text style={s.secaoTitulo}>Fila de validação</Text>
                <Text style={s.contadorPendentes}>{pendentesNucleos.length} pendente(s)</Text>
              </View>
              {pendentesNucleos.length === 0 ? (
                <Vazio texto="Nenhuma evidência pendente de validação." />
              ) : (
                pendentesNucleos.map((ev) => (
                  <View key={ev.id} style={s.itemNucleo}>
                    <View style={[s.itemNucleoBadge, { backgroundColor: corNucleo(ev.nucleo) }]}>
                      <Text style={s.itemNucleoBadgeTexto}>{labelNucleo(ev.nucleo)}</Text>
                    </View>
                    <Text style={s.itemTrecho}>"{ev.trecho_literal}"</Text>
                    {!!ev.justificativa && <Text style={s.itemJustificativa}>{ev.justificativa}</Text>}
                    <View style={s.itemRodape}>
                      <Text style={s.itemData}>
                        {formatarData(ev.data_sessao)}{ev.indicador ? ` · ${ev.indicador}` : ''}
                        {ev.intensidade != null ? ` · intensidade ${ev.intensidade}` : ''}
                      </Text>
                      <View style={s.itemAcoes}>
                        <TouchableOpacity onPress={() => { validarStatusEvidenciaNucleo(ev.id, 'confirmada'); carregar(); }}>
                          <Ionicons name="checkmark-circle" size={20} color="#1e9e63" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => reclassificar(ev)}>
                          <Ionicons name="swap-horizontal-outline" size={20} color="#3D5A80" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { validarStatusEvidenciaNucleo(ev.id, 'rejeitada'); carregar(); }}>
                          <Ionicons name="close-circle" size={20} color="#c0392b" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={s.linkRevogar} onPress={revogarConsentimento}>
        <Text style={s.linkRevogarTexto}>Revogar consentimento</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },

  bloqueio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  bloqueioTitulo: { fontSize: 18, fontWeight: '700', color: '#1A1A2E' },
  bloqueioTexto: { fontSize: 14, color: '#6B6860', textAlign: 'center', lineHeight: 20 },
  btnConsentir: { backgroundColor: '#3D5A80', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, marginTop: 8 },
  btnConsentirTexto: { color: '#fff', fontSize: 15, fontWeight: '700' },

  toggleWrap: {
    flexDirection: 'row', margin: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: '#E0E4EA',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  toggleBtnAtivo: { backgroundColor: '#3D5A80' },
  toggleTxt: { fontSize: 13, fontWeight: '600', color: '#6B6860' },
  toggleTxtAtivo: { color: '#fff' },

  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },

  disclaimer: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#F0F4F8', borderRadius: 10, padding: 10,
  },
  disclaimerTexto: { flex: 1, fontSize: 12, color: '#6B6860', lineHeight: 17 },

  btnAnalisar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3D5A80', borderRadius: 12, paddingVertical: 13,
  },
  btnAnalisarTexto: { color: '#fff', fontSize: 14, fontWeight: '700' },

  secao: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: '#E0E4EA',
  },
  secaoTituloRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'space-between', marginBottom: 10 },
  secaoTitulo: {
    fontSize: 12, fontWeight: '700', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  contadorPendentes: { fontSize: 12, color: '#E0A030', fontWeight: '700' },

  itemVazio: { fontSize: 13, color: '#aaa', fontStyle: 'italic' },

  itemObjetivo: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  itemTrecho: { fontSize: 13.5, color: '#1A1A2E', fontStyle: 'italic', lineHeight: 19 },
  itemJustificativa: { fontSize: 12, color: '#888', marginTop: 4 },
  itemRodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  itemData: { fontSize: 11, color: '#999' },
  itemAcoes: { flexDirection: 'row', gap: 10 },
  itemStatus: { fontSize: 11, fontWeight: '700', color: '#1e9e63', textTransform: 'uppercase' },
  itemStatusRejeitado: { color: '#c0392b' },

  filtroRow: { flexDirection: 'row', gap: 8 },
  filtroChip: {
    flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E4EA',
  },
  filtroChipAtivo: { backgroundColor: '#1A1A2E', borderColor: '#1A1A2E' },
  filtroTxt: { fontSize: 12, fontWeight: '600', color: '#6B6860' },
  filtroTxtAtivo: { color: '#fff' },

  barraRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  barraLabel: { width: 118, fontSize: 12, color: '#6B6860' },
  barraTrilho: { flex: 1, height: 12, borderRadius: 6, backgroundColor: '#F0F2F5', overflow: 'hidden' },
  barraFill: { height: 12, borderRadius: 6 },
  barraValor: { width: 38, textAlign: 'right', fontSize: 12, color: '#1A1A2E', fontVariant: ['tabular-nums'] },
  notaIndizivel: { fontSize: 11.5, color: '#999', marginTop: 4, fontStyle: 'italic' },

  itemNucleo: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F0F2F5', gap: 4 },
  itemNucleoBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4 },
  itemNucleoBadgeTexto: { fontSize: 11, fontWeight: '700', color: '#fff' },

  vazio: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  vazioTexto: { fontSize: 12.5, color: '#999', textAlign: 'center' },

  linkRevogar: { alignItems: 'center', paddingVertical: 12 },
  linkRevogarTexto: { fontSize: 12, color: '#c0392b' },
});
