import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  listarPacientes, deletarPaciente, getModalidadesPorPaciente, contarDadosDoPaciente,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { calcularAnosEMeses, formatarAnosEMeses } from '../services/validacao';
import MenuLateral from '../components/MenuLateral';
import CabecalhoTela from '../components/CabecalhoTela';
import { CLINICA_BUTTONS, ADMIN_BUTTONS } from '../constants/menuBotoes';

export default function AnalisantesScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const [pacientes, setPacientes] = useState([]);
  const [modalidades, setModalidades] = useState({});
  const [removendoId, setRemovendoId] = useState(null);
  const [carregando, setCarregando] = useState(true);
  // Permite abrir direto na aba certa (ex: vindo do card "Supervisionandos" do Perfil).
  const [aba, setAba] = useState(route.params?.aba === 'supervisionandos' ? 'supervisionandos' : 'analisantes');
  const [menuAberto, setMenuAberto] = useState(false);

  const listaFiltrada = pacientes.filter((p) =>
    aba === 'analisantes' ? p.eh_analisante !== false : p.eh_supervisionando === true
  );

  async function carregar() {
    try {
      const [lista, modalidadesLista] = await Promise.all([
        listarPacientes(),
        getModalidadesPorPaciente(),
      ]);
      setPacientes(lista);
      setModalidades(modalidadesLista);
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [])
  );

  function irParaFormulario(paciente = null) {
    navigation.navigate('PatientForm', paciente ? { paciente } : {});
  }

  /** Lista só o que existe de verdade, na ordem em que dói mais. */
  function descreverPerda(c) {
    const partes = [];
    const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
    if (c.sessoes) partes.push(plural(c.sessoes, 'sessão gravada', 'sessões gravadas'));
    if (c.registros) partes.push(plural(c.registros, 'registro escrito', 'registros escritos'));
    if (c.compromissos) partes.push(plural(c.compromissos, 'compromisso', 'compromissos'));
    if (c.relatorios) partes.push(plural(c.relatorios, 'relatório', 'relatórios'));
    if (c.pagamentos) partes.push(plural(c.pagamentos, 'registro de pagamento', 'registros de pagamento'));
    return partes;
  }

  /**
   * Apagar um analisante derruba, em cascata, tudo que existe sobre ele:
   * sessões, transcrições, registros, compromissos, relatórios,
   * pagamentos e a elaboração dos núcleos. Até aqui a tela perguntava
   * apenas `Deseja remover "Fulana"?` — a frase de tirar uma linha de uma
   * lista, para a ação mais destrutiva do app inteiro.
   *
   * Agora são dois passos: o primeiro DIZ o tamanho, com os números
   * contados no banco; o segundo existe para que ninguém chegue no fim
   * por reflexo.
   */
  function confirmarDelecao(id, nome) {
    (async () => {
      let contagem = null;
      setRemovendoId(id);
      try {
        contagem = await contarDadosDoPaciente(id);
      } catch (_) {
        // Não deu pra contar: seguir sem número é aceitável, seguir sem
        // aviso não. O texto abaixo cobre os dois casos.
      } finally {
        setRemovendoId(null);
      }

      const perdas = contagem ? descreverPerda(contagem) : [];
      const detalhe = perdas.length > 0
        ? `Isto apaga em definitivo:\n\n${perdas.map((t) => `• ${t}`).join('\n')}\n\nMais as transcrições e a elaboração clínica ligadas a esses itens.`
        : 'Isto apaga em definitivo tudo que existe sobre esta pessoa: sessões, transcrições, registros, compromissos, relatórios e histórico financeiro.';

      const seguir = await new Promise((resolve) => {
        Alert.alert(
          `Apagar ${nome} e todo o histórico?`,
          `${detalhe}\n\nNão há como desfazer.`,
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continuar', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
      if (!seguir) return;

      const confirmado = await new Promise((resolve) => {
        Alert.alert(
          'Tem certeza?',
          `O prontuário de ${nome} será apagado do servidor e não poderá ser recuperado — nem por nós.\n\nSe a intenção for apenas parar de atender, use "Paralisação da análise" na ficha: o histórico fica preservado.`,
          [
            { text: 'Não apagar', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Apagar tudo', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
      if (!confirmado) return;

      setRemovendoId(id);
      try {
        await deletarPaciente(id);
        await carregar();
      } catch (e) {
        Alert.alert('Erro ao remover', mensagemDeErro(e));
      } finally {
        setRemovendoId(null);
      }
    })();
  }

  // ⚠️ CORRIGIDO: não existe mais campo "codinome" — usa sempre o nome real
  function getInicial(item) {
    const ref = item.nome || 'A';
    return ref.charAt(0).toUpperCase();
  }

  function getNomeExibido(item) {
    return item.nome || '—';
  }

  function getModalidadeLabel(modalidade) {
    switch (modalidade) {
      case 'online':     return 'Online';
      case 'presencial': return 'Presencial';
      case 'hibrido':    return 'Híbrido';
      default:           return null;
    }
  }

  function renderItem({ item }) {
    const idadeTexto = formatarAnosEMeses(calcularAnosEMeses(item.nascimento));
    const tempoAnaliseTexto = formatarAnosEMeses(calcularAnosEMeses(item.data_inicio));
    const modalidadeLabel = getModalidadeLabel(modalidades[item.id]);

    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardMain}
          onPress={() => navigation.navigate('PatientDetail', { paciente: item })}
        >
          <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
            {getNomeExibido(item)}
          </Text>

          <View style={styles.cardBody}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInicial(item)}</Text>
            </View>
            <View style={styles.cardInfo}>
              {modalidadeLabel ? <Text style={styles.cardInfoLinha}>{modalidadeLabel}</Text> : null}
              {idadeTexto ? <Text style={styles.cardInfoLinha}>{idadeTexto}</Text> : null}
              {tempoAnaliseTexto ? <Text style={styles.cardInfoLinha}>{tempoAnaliseTexto}</Text> : null}
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => irParaFormulario(item)}
            disabled={removendoId === item.id}
          >
            <Ionicons name="pencil-outline" size={18} color="#497363" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => confirmarDelecao(item.id, getNomeExibido(item))}
            disabled={removendoId === item.id}
          >
            {removendoId === item.id
              ? <ActivityIndicator size="small" color="#975451" />
              : <Ionicons name="trash-outline" size={18} color="#A9A299" />}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <CabecalhoTela
        titulo={aba === 'analisantes' ? 'Analisantes' : 'Supervisionandos'}
        onVoltar={() => navigation.goBack()}
        acoes={(
          <>
            <TouchableOpacity style={styles.headerAcaoBtn} onPress={() => irParaFormulario()}>
              <Ionicons name="person-add-outline" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerAcaoBtn} onPress={() => setMenuAberto(true)}>
              <Ionicons name="menu-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}
      />

      <View style={styles.abas}>
        <TouchableOpacity
          style={[styles.abaBtn, aba === 'analisantes' && styles.abaBtnAtiva]}
          onPress={() => setAba('analisantes')}
        >
          <Text style={[styles.abaBtnText, aba === 'analisantes' && styles.abaBtnTextAtiva]}>Analisantes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.abaBtn, aba === 'supervisionandos' && styles.abaBtnAtiva]}
          onPress={() => setAba('supervisionandos')}
        >
          <Text style={[styles.abaBtnText, aba === 'supervisionandos' && styles.abaBtnTextAtiva]}>Supervisionandos</Text>
        </TouchableOpacity>
      </View>

      {carregando ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#497363" />
        </View>
      ) : listaFiltrada.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="leaf-outline" size={34} color="#A8CBBA" style={styles.emptyIcon} />
          <Text style={styles.emptyText}>
            {aba === 'analisantes' ? 'Nenhum analisante cadastrado' : 'Nenhum supervisionando cadastrado'}
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => irParaFormulario()}>
            <Text style={styles.emptyBtnText}>
              {aba === 'analisantes' ? 'Cadastrar primeiro analisante' : 'Cadastrar primeiro supervisionando'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={listaFiltrada}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
        />
      )}

      <MenuLateral
        visible={menuAberto}
        onClose={() => setMenuAberto(false)}
        navigation={navigation}
        clinicaButtons={CLINICA_BUTTONS}
        adminButtons={ADMIN_BUTTONS}
        contextual={{
          titulo: aba === 'analisantes' ? 'Analisantes' : 'Supervisionandos',
          itens: [
            { icon: 'person-add-outline', label: 'Novo cadastro', onPress: () => irParaFormulario() },
          ],
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  headerAcaoBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  abas: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: '#FDFCFA', borderBottomWidth: 1, borderBottomColor: '#EAE5DC', paddingBottom: 12,
  },
  abaBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center',
    backgroundColor: '#F7F5F0', borderWidth: 1, borderColor: '#EAE5DC',
  },
  abaBtnAtiva:  { backgroundColor: '#497363', borderColor: '#497363' },
  abaBtnText: { fontSize: 13, fontWeight: '500', color: '#756E66', lineHeight: 19 },
  abaBtnTextAtiva: { color: '#fff' },
  list:         { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  cardMain:     { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '500', color: '#302C28', marginBottom: 8, lineHeight: 23 },
  cardBody:     { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#497363',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText:   { color: '#fff', fontSize: 18, fontWeight: '500' },
  cardInfo:     { flex: 1, gap: 2 },
  cardInfoLinha: { fontSize: 13, color: '#756E66', lineHeight: 19 },
  cardActions:  { flexDirection: 'column', gap: 2, marginLeft: 6 },
  actionBtn:    { padding: 4 },
  actionBtnText: { fontSize: 15, lineHeight: 22 },
  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:    { marginBottom: 16 },
  emptyText: { fontSize: 16, color: '#A9A299', marginBottom: 24, lineHeight: 23 },
  emptyBtn:     { backgroundColor: '#497363', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  emptyBtnText: { color: '#fff', fontWeight: '500', fontSize: 15, lineHeight: 22 },
});