import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  getConsentimentoPerfil, setConsentimentoPerfil,
  getRegistrosNaoAnalisados, analisarRegistroNucleos, analisarRegistroObjetivo,
  getEvidenciasNucleos, getEvidenciasObjetivo, getTransicoesNucleos,
  validarStatusEvidenciaNucleo, validarStatusEvidenciaObjetivo, reclassificarEvidenciaNucleo,
  getPerguntasPendentes, gerarPerguntasPorAusencia, responderPergunta, descartarPergunta,
  getSnapshots, criarSnapshot, getSessions,
  getSessionById, getRecordById,
} from '../services/database';
import { CATEGORIAS_OBJETIVO } from '../services/perfilObjetivo';
import { getRubricaSemente } from '../services/rubricas';
import {
  calcularDensidadePorNucleo, calcularDefesasPorAsa, calcularIndiceRetorno,
  calcularMobilidade, rankearGatilhos,
} from '../services/metricas';
import MandalaNucleos from './components/MandalaNucleos';

const MODOS = [
  { valor: 'objetivo', label: 'Objetivo' },
  { valor: 'subjetivo', label: 'Subjetivo' },
];

const RUBRICA = getRubricaSemente();
const NUCLEO_ORDEM = ['bem', 'mal', 'mau', 'bom'];
const ASA_ORDEM = ['ego', 'id', 'superego', 'superid'];

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
  const navigation = useNavigation();
  const route = useRoute();
  const paciente = route.params?.paciente;

  const [modo, setModo] = useState('objetivo');
  const [consentimento, setConsentimentoState] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [evidObjetivo, setEvidObjetivo] = useState([]);
  const [evidNucleos, setEvidNucleos] = useState([]);
  const [transicoes, setTransicoes] = useState([]);
  const [perguntas, setPerguntas] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [somenteValidado, setSomenteValidado] = useState(false);
  const [verComoTabela, setVerComoTabela] = useState(false);
  const [selecionado, setSelecionado] = useState(null);
  const [snapshotAberto, setSnapshotAberto] = useState(null);

  const carregar = useCallback(() => {
    setConsentimentoState(getConsentimentoPerfil(paciente.id));
    setEvidObjetivo(getEvidenciasObjetivo(paciente.id));
    setEvidNucleos(getEvidenciasNucleos(paciente.id));
    setTransicoes(getTransicoesNucleos(paciente.id));
    setPerguntas(getPerguntasPendentes(paciente.id));
    setSnapshots(getSnapshots(paciente.id));
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
        // Pausa entre chamadas: o tier gratuito do Gemini limita 15
        // requisições/minuto (1 a cada 4s) — analisar vários registros
        // seguidos sem pausa estoura o limite rapidamente.
        if (i < registros.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 4500));
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

  function abrirRegistroDaEvidencia(ev) {
    if (!ev) return;
    if (ev.origem_tipo === 'session') {
      const sessao = getSessionById(ev.registro_id);
      if (sessao) navigation.navigate('SessionDetail', { sessao, pacienteNome: paciente.nome });
    } else {
      const registro = getRecordById(ev.registro_id);
      if (registro) navigation.navigate('RecordDetail', { record: registro });
    }
  }

  function pedirPerguntas() {
    const criadas = gerarPerguntasPorAusencia(paciente.id, 5);
    carregar();
    if (criadas.length === 0) {
      Alert.alert('Sem novidades', 'Nenhum núcleo ausente detectado nas últimas 5 sessões (ou histórico ainda curto demais).');
    }
  }

  function responder(pergunta, resposta) {
    responderPergunta(pergunta.id, resposta);
    carregar();
  }

  function criarSnapshotAgora() {
    criarSnapshot(paciente.id);
    carregar();
    Alert.alert('Snapshot criado', 'O instantâneo atual do perfil foi salvo na linha do tempo.');
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
  const transicoesFiltradas = somenteValidado
    ? transicoes.filter((t) => t.status_validacao !== 'rejeitada')
    : transicoes;

  const porNucleo = { bem: 0, mal: 0, mau: 0, bom: 0 };
  evidenciasNucleosFiltradas.forEach((e) => { if (porNucleo[e.nucleo] !== undefined) porNucleo[e.nucleo]++; });
  const totalComNucleo = NUCLEO_ORDEM.reduce((acc, n) => acc + porNucleo[n], 0);
  const pendentesNucleos = evidNucleos.filter((e) => e.status_validacao === 'pendente');
  const indizíveis = evidenciasNucleosFiltradas.filter((e) => e.nucleo === 'eu_nuclear').length;

  const densidadePct = calcularDensidadePorNucleo(evidenciasNucleosFiltradas);
  const asas = calcularDefesasPorAsa(transicoesFiltradas);
  const indiceRetorno = calcularIndiceRetorno(transicoesFiltradas);
  const totalSessoes = getSessions(paciente.id).length;
  const mobilidade = calcularMobilidade(transicoesFiltradas.length, totalSessoes);
  const gatilhos = rankearGatilhos(transicoesFiltradas).slice(0, 5);

  function renderPainelSelecao() {
    if (!selecionado) return null;
    let titulo = '';
    let itens = [];
    if (selecionado.tipo === 'nucleo') { titulo = labelNucleo(selecionado.chave); itens = selecionado.evidencias; }
    else if (selecionado.tipo === 'asa') { titulo = `Instância ${selecionado.chave.toUpperCase()} — ${selecionado.valor.toFixed(1)} defesa(s) mediada(s)`; }
    else if (selecionado.tipo === 'eu_nuclear') { titulo = 'Eu Nuclear — indizíveis'; itens = selecionado.evidencias; }
    else if (selecionado.tipo === 'evidencia') { titulo = labelNucleo(selecionado.evidencia.nucleo); itens = [selecionado.evidencia]; }
    else if (selecionado.tipo === 'transicao') {
      titulo = `${labelNucleo(selecionado.de)} → ${labelNucleo(selecionado.para)} (${selecionado.contagem}x)${selecionado.anomala ? ' · anômala, via Eu nuclear' : ''}`;
    }

    return (
      <View style={s.painelSelecao}>
        <View style={s.painelSelecaoHeader}>
          <Text style={s.painelSelecaoTitulo}>{titulo}</Text>
          <TouchableOpacity onPress={() => setSelecionado(null)}>
            <Ionicons name="close" size={18} color="#888" />
          </TouchableOpacity>
        </View>
        {itens.length === 0 ? (
          <Text style={s.itemVazio}>Toque num círculo, asa, seta ou ponto pra ver os trechos.</Text>
        ) : (
          itens.map((ev) => (
            <TouchableOpacity key={ev.id} style={s.painelEvidencia} onPress={() => abrirRegistroDaEvidencia(ev)}>
              <Text style={s.itemTrecho}>"{ev.trecho_literal}"</Text>
              <Text style={s.itemData}>
                {formatarData(ev.data_sessao)}{ev.indicador ? ` · ${ev.indicador}` : ''} · abrir registro ↗
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    );
  }

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

            <TouchableOpacity style={s.linkTabela} onPress={() => setVerComoTabela((v) => !v)}>
              <Ionicons name={verComoTabela ? 'pie-chart-outline' : 'list-outline'} size={14} color="#3D5A80" />
              <Text style={s.linkTabelaTexto}>{verComoTabela ? 'Ver como mandala' : 'Ver como tabela (acessibilidade)'}</Text>
            </TouchableOpacity>

            {!verComoTabela && (
              <View style={s.secao}>
                <Text style={s.secaoTitulo}>Mandala dos núcleos</Text>
                {totalComNucleo === 0 && indizíveis === 0 ? (
                  <Vazio texto="Ainda sem evidências pra desenhar a mandala." />
                ) : (
                  <MandalaNucleos
                    rubrica={RUBRICA}
                    evidencias={evidenciasNucleosFiltradas}
                    transicoes={transicoesFiltradas}
                    asas={asas}
                    onSelecionar={setSelecionado}
                  />
                )}
                {renderPainelSelecao()}
              </View>
            )}

            <View style={s.secao}>
              <Text style={s.secaoTitulo}>Densidade de referências por núcleo</Text>
              {totalComNucleo === 0 ? (
                <Vazio texto="Ainda sem evidências suficientes para calcular densidade." />
              ) : (
                NUCLEO_ORDEM.map((n) => (
                  <View key={n} style={s.barraRow}>
                    <Text style={s.barraLabel}>{labelNucleo(n)}</Text>
                    <View style={s.barraTrilho}>
                      <View style={[s.barraFill, { width: `${densidadePct[n]}%`, backgroundColor: corNucleo(n) }]} />
                    </View>
                    <Text style={s.barraValor}>{densidadePct[n]}%</Text>
                  </View>
                ))
              )}
              {indizíveis > 0 && (
                <Text style={s.notaIndizivel}>{indizíveis} trecho(s) no Eu nuclear (indizíveis).</Text>
              )}
            </View>

            <View style={s.secao}>
              <Text style={s.secaoTitulo}>Asas · defesas mediadas por instância</Text>
              <View style={s.asasGrid}>
                {ASA_ORDEM.map((a) => (
                  <View key={a} style={s.asaCartao}>
                    <Text style={s.asaNome}>{a.toUpperCase()}</Text>
                    <Text style={s.asaValor}>{asas[a].toFixed(1)}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.notaIndizivel}>
                Transições diagonais anômalas (Bem⇄Bom, Mal⇄Mau): {asas.eu_nuclear.toFixed(0)}
              </Text>
            </View>

            <View style={s.secao}>
              <Text style={s.secaoTitulo}>Itinerário e índices</Text>
              <Text style={s.indiceTexto}>
                Índice de retorno (Mal→Bem): {indiceRetorno == null ? '— sem dados ainda' : indiceRetorno}
              </Text>
              <Text style={s.indiceTexto}>
                Mobilidade entre núcleos: {mobilidade} ({transicoesFiltradas.length} transições em {totalSessoes} sessões)
              </Text>
            </View>

            {gatilhos.length > 0 && (
              <View style={s.secao}>
                <Text style={s.secaoTitulo}>Gatilhos de virada</Text>
                {gatilhos.map((g, i) => (
                  <View key={i} style={s.gatilhoRow}>
                    <Text style={s.gatilhoTexto} numberOfLines={1}>"{g.trecho}"</Text>
                    <Text style={s.gatilhoContagem}>{g.contagem}x</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={s.secao}>
              <View style={s.secaoTituloRow}>
                <Text style={s.secaoTitulo}>Perguntas do app</Text>
                <TouchableOpacity onPress={pedirPerguntas}>
                  <Ionicons name="refresh-outline" size={16} color="#3D5A80" />
                </TouchableOpacity>
              </View>
              {perguntas.length === 0 ? (
                <Text style={s.itemVazio}>Nenhuma pergunta pendente. Toque no ícone pra checar ausências.</Text>
              ) : (
                perguntas.map((p) => (
                  <View key={p.id} style={s.perguntaCard}>
                    <Text style={s.perguntaTexto}>{p.pergunta}</Text>
                    <View style={s.perguntaBtns}>
                      {JSON.parse(p.opcoes || '[]').map((op) => (
                        <TouchableOpacity key={op} style={s.perguntaBtn} onPress={() => responder(p, op)}>
                          <Text style={s.perguntaBtnTexto}>{op}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity onPress={() => { descartarPergunta(p.id); carregar(); }}>
                        <Ionicons name="close" size={16} color="#999" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
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

            <View style={s.secao}>
              <View style={s.secaoTituloRow}>
                <Text style={s.secaoTitulo}>Evolução do perfil</Text>
                <TouchableOpacity onPress={criarSnapshotAgora}>
                  <Ionicons name="camera-outline" size={16} color="#3D5A80" />
                </TouchableOpacity>
              </View>
              {snapshots.length === 0 ? (
                <Text style={s.itemVazio}>Nenhum instantâneo salvo ainda. Toque na câmera pra criar um agora.</Text>
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.snapshotStrip}>
                    {snapshots.map((snap) => (
                      <TouchableOpacity
                        key={snap.id}
                        style={[s.snapshotCard, snapshotAberto?.id === snap.id && s.snapshotCardAtivo]}
                        onPress={() => setSnapshotAberto(snap)}
                      >
                        <Text style={s.snapshotData}>{formatarData(snap.criado_em)}</Text>
                        <Text style={s.snapshotSessoes}>{snap.sessoes_incluidas} sessões</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {snapshotAberto && (
                    <View style={s.snapshotDetalhe}>
                      {NUCLEO_ORDEM.map((n) => (
                        <Text key={n} style={s.snapshotDetalheTexto}>
                          {labelNucleo(n)}: {snapshotAberto.metricas.densidade[n]}%
                        </Text>
                      ))}
                      <Text style={s.snapshotDetalheTexto}>
                        {snapshotAberto.metricas.totalEvidencias} evidências · {snapshotAberto.metricas.totalIndizíveis} indizíveis
                      </Text>
                    </View>
                  )}
                </>
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

  linkTabela: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  linkTabelaTexto: { fontSize: 12, fontWeight: '600', color: '#3D5A80' },

  painelSelecao: {
    marginTop: 10, backgroundColor: '#F0F4F8', borderRadius: 10, padding: 10, gap: 6,
  },
  painelSelecaoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  painelSelecaoTitulo: { fontSize: 12.5, fontWeight: '700', color: '#1A1A2E', flex: 1 },
  painelEvidencia: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#E0E4EA' },

  barraRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  barraLabel: { width: 118, fontSize: 12, color: '#6B6860' },
  barraTrilho: { flex: 1, height: 12, borderRadius: 6, backgroundColor: '#F0F2F5', overflow: 'hidden' },
  barraFill: { height: 12, borderRadius: 6 },
  barraValor: { width: 38, textAlign: 'right', fontSize: 12, color: '#1A1A2E', fontVariant: ['tabular-nums'] },
  notaIndizivel: { fontSize: 11.5, color: '#999', marginTop: 4, fontStyle: 'italic' },

  asasGrid: { flexDirection: 'row', gap: 8 },
  asaCartao: {
    flex: 1, alignItems: 'center', backgroundColor: '#F5F7FA', borderRadius: 10,
    paddingVertical: 10, borderWidth: 1, borderColor: '#E0E4EA',
  },
  asaNome: { fontSize: 10.5, fontWeight: '700', color: '#6B6860' },
  asaValor: { fontSize: 18, fontWeight: '700', color: '#1A1A2E', marginTop: 2 },

  indiceTexto: { fontSize: 13, color: '#1A1A2E', marginBottom: 6 },

  gatilhoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  gatilhoTexto: { flex: 1, fontSize: 12.5, color: '#1A1A2E', fontStyle: 'italic', marginRight: 8 },
  gatilhoContagem: { fontSize: 12, color: '#888', fontWeight: '700' },

  perguntaCard: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  perguntaTexto: { fontSize: 13, color: '#1A1A2E', lineHeight: 18, marginBottom: 8 },
  perguntaBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  perguntaBtn: { backgroundColor: '#EBF3FB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  perguntaBtnTexto: { fontSize: 12, color: '#3D5A80', fontWeight: '600' },

  itemNucleo: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F0F2F5', gap: 4 },
  itemNucleoBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4 },
  itemNucleoBadgeTexto: { fontSize: 11, fontWeight: '700', color: '#fff' },

  snapshotStrip: { gap: 8, paddingVertical: 4 },
  snapshotCard: {
    alignItems: 'center', backgroundColor: '#F5F7FA', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E0E4EA',
  },
  snapshotCardAtivo: { borderColor: '#3D5A80', backgroundColor: '#EBF3FB' },
  snapshotData: { fontSize: 12, fontWeight: '700', color: '#1A1A2E' },
  snapshotSessoes: { fontSize: 10.5, color: '#888', marginTop: 2 },
  snapshotDetalhe: { marginTop: 10, gap: 4 },
  snapshotDetalheTexto: { fontSize: 12, color: '#6B6860' },

  vazio: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  vazioTexto: { fontSize: 12.5, color: '#999', textAlign: 'center' },

  linkRevogar: { alignItems: 'center', paddingVertical: 12 },
  linkRevogarTexto: { fontSize: 12, color: '#c0392b' },
});
