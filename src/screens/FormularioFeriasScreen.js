// Cadastro e edição de uma férias.
//   • Minhas férias (analista): período e quem paga — "pagas" (todos),
//     "não pagas" (ninguém) ou "parcialmente pagas" (escolhe cliente a
//     cliente).
//   • Férias de um cliente: período e se é paga ou não.
// Ao salvar, a agenda do período passa a mostrar as férias e o financeiro
// se ajusta sozinho (database.js → salvarFerias).
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import CabecalhoTela from '../components/CabecalhoTela';
import { getFerias, salvarFerias, excluirFerias, listarPacientes } from '../services/database';
import { validarFerias, formatarPeriodoFerias } from '../services/ferias';
import {
  mascararDataBR, interpretarDataDigitada, dataBRParaISO, dataISOParaBR,
} from '../services/validacao';
import { mensagemDeErro } from '../services/erros';

const COR = {
  fundo: '#F7F5F0', cartao: '#FDFCFA', linha: '#EAE5DC',
  t900: '#302C28', t700: '#4E4941', t500: '#756E66', t400: '#8C857B',
  salvia: '#497363', salviaVeu: '#E4EFE9', erro: '#975451',
};

const MODOS_ANALISTA = [
  { id: 'pagas', label: 'Pagas', ajuda: 'Todos os clientes pagam as sessões do período.' },
  { id: 'nao_pagas', label: 'Não pagas', ajuda: 'Ninguém paga as sessões do período.' },
  { id: 'parcial', label: 'Parcialmente pagas', ajuda: 'Você escolhe, abaixo, quem paga e quem não paga.' },
];

function Opcoes({ opcoes, valor, onChange }) {
  return (
    <View style={styles.opcoes}>
      {opcoes.map((o) => (
        <TouchableOpacity
          key={o.id}
          style={[styles.opcao, valor === o.id && styles.opcaoAtiva]}
          onPress={() => onChange(o.id)}
        >
          <Text style={[styles.opcaoTxt, valor === o.id && styles.opcaoTxtAtiva]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function FormularioFeriasScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const feriasId = route.params?.feriasId || null;
  const [tipo, setTipo] = useState(route.params?.tipo || 'analista');
  const [patientId, setPatientId] = useState(route.params?.patientId || null);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [modo, setModo] = useState('pagas');
  const [pagaCliente, setPagaCliente] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [escolhas, setEscolhas] = useState({});
  const [clientes, setClientes] = useState([]);
  const [existentes, setExistentes] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [lista, pacientes] = await Promise.all([getFerias(), listarPacientes()]);
        setExistentes(lista);
        // Só quem está em atendimento: análise paralisada não tem sessão.
        const ativos = (pacientes || []).filter((p) => !p.data_paralizacao);
        setClientes(ativos);
        const atual = feriasId ? lista.find((f) => f.id === feriasId) : null;
        if (atual) {
          setTipo(atual.tipo);
          setPatientId(atual.patient_id);
          setInicio(dataISOParaBR(atual.data_inicio));
          setFim(dataISOParaBR(atual.data_fim));
          setObservacao(atual.observacao || '');
          setPagaCliente(!!atual.paga);
          const mapa = {};
          ativos.forEach((p) => { mapa[p.id] = !!atual.paga; });
          (atual.pacientes || []).forEach((p) => { mapa[p.patient_id] = !!p.paga; });
          setEscolhas(mapa);
          const valores = ativos.map((p) => mapa[p.id]);
          setModo(valores.every(Boolean) ? 'pagas' : valores.some(Boolean) ? 'parcial' : 'nao_pagas');
        } else {
          const mapa = {};
          ativos.forEach((p) => { mapa[p.id] = true; });
          setEscolhas(mapa);
        }
      } catch (e) {
        Alert.alert('Erro ao abrir', mensagemDeErro(e));
      } finally {
        setCarregando(false);
      }
    })();
  }, [feriasId]);

  const clienteEscolhido = useMemo(() => clientes.find((c) => c.id === patientId) || null, [clientes, patientId]);
  const nomeCliente = clienteEscolhido?.nome || route.params?.patientNome || null;

  function trocarModo(novo) {
    setModo(novo);
    if (novo === 'parcial') return;
    const mapa = {};
    clientes.forEach((c) => { mapa[c.id] = novo === 'pagas'; });
    setEscolhas(mapa);
  }

  async function salvar() {
    const dataInicio = dataBRParaISO(interpretarDataDigitada(inicio) || inicio);
    const dataFim = dataBRParaISO(interpretarDataDigitada(fim) || fim);
    const nova = { id: feriasId, tipo, patient_id: tipo === 'cliente' ? patientId : null, data_inicio: dataInicio, data_fim: dataFim };
    const problema = !dataInicio || !dataFim
      ? 'Confira as datas (dia/mês/ano).'
      : validarFerias(nova, existentes);
    if (problema) {
      Alert.alert('Confira as férias', problema);
      return;
    }
    setSalvando(true);
    try {
      await salvarFerias({
        id: feriasId,
        tipo,
        patientId,
        dataInicio,
        dataFim,
        // Nas férias do analista, `paga` é o padrão para quem não está na
        // lista (cliente cadastrado depois): segue "pagas" ou "não pagas".
        paga: tipo === 'cliente' ? pagaCliente : modo === 'pagas',
        observacao,
        pacientes: tipo === 'analista'
          ? clientes.map((c) => ({ patient_id: c.id, paga: !!escolhas[c.id] }))
          : [],
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar as férias', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  function confirmarExclusao() {
    Alert.alert(
      'Apagar estas férias?',
      'Os horários do período voltam ao normal na agenda e no financeiro. Pagamentos já registrados continuam como estão.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            setSalvando(true);
            try {
              await excluirFerias(feriasId);
              navigation.goBack();
            } catch (e) {
              setSalvando(false);
              Alert.alert('Erro ao apagar', mensagemDeErro(e));
            }
          },
        },
      ]
    );
  }

  const titulo = feriasId ? 'Editar férias' : (tipo === 'analista' ? 'Minhas férias' : 'Férias de cliente');
  const ajudaModo = MODOS_ANALISTA.find((m) => m.id === modo)?.ajuda;
  const clientesFiltrados = clientes.filter((c) => c.nome.toLowerCase().includes(filtro.toLowerCase()));
  const pagantes = clientes.filter((c) => escolhas[c.id]).length;
  const inicioISO = dataBRParaISO(inicio);
  const fimISO = dataBRParaISO(fim);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <CabecalhoTela titulo={titulo} onVoltar={() => navigation.goBack()} />
      {carregando ? (
        <View style={styles.centro}><ActivityIndicator size="large" color={COR.salvia} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            contentContainerStyle={[styles.corpo, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
          >
            {!feriasId && !route.params?.tipo && (
              <Opcoes
                opcoes={[{ id: 'analista', label: 'Minhas férias' }, { id: 'cliente', label: 'De um cliente' }]}
                valor={tipo}
                onChange={setTipo}
              />
            )}

            {tipo === 'cliente' && (
              <View style={styles.bloco}>
                <Text style={styles.rotulo}>De quem são as férias</Text>
                {patientId ? (
                  <View style={styles.escolhido}>
                    <Text style={styles.escolhidoNome}>{nomeCliente || 'Cliente'}</Text>
                    {!feriasId && !route.params?.patientId && (
                      <TouchableOpacity onPress={() => setPatientId(null)}>
                        <Text style={styles.link}>Trocar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={styles.campo}
                      placeholder="Buscar pelo nome"
                      placeholderTextColor={COR.t400}
                      value={filtro}
                      onChangeText={setFiltro}
                    />
                    {clientesFiltrados.slice(0, 30).map((c) => (
                      <TouchableOpacity key={c.id} style={styles.itemCliente} onPress={() => setPatientId(c.id)}>
                        <Text style={styles.itemClienteTxt}>{c.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}

            <View style={styles.bloco}>
              <Text style={styles.rotulo}>Período</Text>
              <View style={styles.linhaDatas}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subrotulo}>Início</Text>
                  <TextInput
                    style={styles.campo}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor={COR.t400}
                    keyboardType="number-pad"
                    value={inicio}
                    onChangeText={(t) => setInicio(mascararDataBR(t))}
                    onBlur={() => setInicio((v) => interpretarDataDigitada(v) || v)}
                    maxLength={10}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subrotulo}>Fim (último dia de férias)</Text>
                  <TextInput
                    style={styles.campo}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor={COR.t400}
                    keyboardType="number-pad"
                    value={fim}
                    onChangeText={(t) => setFim(mascararDataBR(t))}
                    onBlur={() => setFim((v) => interpretarDataDigitada(v) || v)}
                    maxLength={10}
                  />
                </View>
              </View>
              {inicioISO && fimISO && fimISO >= inicioISO ? (
                <Text style={styles.ajuda}>Férias de {formatarPeriodoFerias(inicioISO, fimISO)}.</Text>
              ) : null}
            </View>

            {tipo === 'analista' ? (
              <View style={styles.bloco}>
                <Text style={styles.rotulo}>As sessões do período são</Text>
                <Opcoes opcoes={MODOS_ANALISTA} valor={modo} onChange={trocarModo} />
                {ajudaModo ? <Text style={styles.ajuda}>{ajudaModo}</Text> : null}
                {modo === 'parcial' && (
                  <View style={styles.listaPagantes}>
                    <Text style={styles.subrotulo}>{pagantes} de {clientes.length} pagam</Text>
                    {clientes.map((c) => (
                      <View key={c.id} style={styles.linhaPagante}>
                        <Text style={styles.itemClienteTxt}>{c.nome}</Text>
                        <View style={styles.linhaSwitch}>
                          <Text style={[styles.estadoPaga, !escolhas[c.id] && { color: COR.t500 }]}>
                            {escolhas[c.id] ? 'Paga' : 'Não paga'}
                          </Text>
                          <Switch
                            value={!!escolhas[c.id]}
                            onValueChange={(v) => setEscolhas((e) => ({ ...e, [c.id]: v }))}
                            trackColor={{ true: '#A8CBBA', false: '#DDD6CA' }}
                            thumbColor={escolhas[c.id] ? COR.salvia : '#FDFCFA'}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.bloco}>
                <Text style={styles.rotulo}>As sessões do período são</Text>
                <Opcoes
                  opcoes={[{ id: 'paga', label: 'Pagas' }, { id: 'nao_paga', label: 'Não pagas' }]}
                  valor={pagaCliente ? 'paga' : 'nao_paga'}
                  onChange={(v) => setPagaCliente(v === 'paga')}
                />
              </View>
            )}

            <View style={styles.bloco}>
              <Text style={styles.rotulo}>Observação (opcional)</Text>
              <TextInput
                style={[styles.campo, { minHeight: 70, textAlignVertical: 'top' }]}
                multiline
                value={observacao}
                onChangeText={setObservacao}
                placeholder="Ex.: viagem de fim de ano"
                placeholderTextColor={COR.t400}
              />
            </View>

            <TouchableOpacity style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
              {salvando
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.botaoSalvarTxt}>Salvar férias</Text>}
            </TouchableOpacity>
            {feriasId && (
              <TouchableOpacity style={styles.botaoApagar} onPress={confirmarExclusao} disabled={salvando}>
                <Text style={styles.botaoApagarTxt}>Apagar estas férias</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COR.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corpo: { padding: 16, gap: 14 },
  bloco: { backgroundColor: COR.cartao, borderRadius: 14, padding: 14, gap: 8 },
  rotulo: { fontSize: 14, fontWeight: '600', color: COR.t900, lineHeight: 20 },
  subrotulo: { fontSize: 12, color: COR.t500, marginBottom: 4, lineHeight: 17 },
  ajuda: { fontSize: 12.5, color: COR.t500, lineHeight: 18 },
  campo: {
    borderWidth: 1, borderColor: COR.linha, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: COR.t900, backgroundColor: '#FFFFFF',
  },
  linhaDatas: { flexDirection: 'row', gap: 10 },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcao: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#EAE5DC' },
  opcaoAtiva: { backgroundColor: COR.salvia },
  opcaoTxt: { color: COR.t700, fontSize: 13.5, lineHeight: 19 },
  opcaoTxtAtiva: { color: '#FFFFFF', fontWeight: '500' },
  escolhido: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  escolhidoNome: { fontSize: 16, color: COR.t900, fontWeight: '500', lineHeight: 22 },
  link: { color: COR.salvia, textDecorationLine: 'underline', fontSize: 13, lineHeight: 19 },
  itemCliente: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COR.linha },
  itemClienteTxt: { fontSize: 14.5, color: COR.t700, flexShrink: 1, lineHeight: 20 },
  listaPagantes: { marginTop: 6 },
  linhaPagante: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COR.linha, gap: 8,
  },
  linhaSwitch: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  estadoPaga: { fontSize: 12, color: COR.salvia, lineHeight: 17 },
  botaoSalvar: { backgroundColor: COR.salvia, borderRadius: 12, padding: 15, alignItems: 'center' },
  botaoSalvarTxt: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, lineHeight: 21 },
  botaoApagar: { padding: 12, alignItems: 'center' },
  botaoApagarTxt: { color: COR.erro, fontSize: 14, lineHeight: 20 },
});
