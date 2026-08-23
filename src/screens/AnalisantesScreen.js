import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listarPacientes, deletarPaciente, getModalidadesPorPaciente } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { calcularAnosEMeses, formatarAnosEMeses } from '../services/validacao';
import MenuLateral from '../components/MenuLateral';
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

  function confirmarDelecao(id, nome) {
    Alert.alert('Remover analisante', `Deseja remover "${nome}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: async () => {
          setRemovendoId(id);
          try {
            await deletarPaciente(id);
            await carregar();
          } catch (e) {
            Alert.alert('Erro ao remover', mensagemDeErro(e));
          } finally {
            setRemovendoId(null);
          }
        }
      }
    ]);
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{aba === 'analisantes' ? 'Analisantes' : 'Supervisionandos'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity style={styles.addBtn} onPress={() => irParaFormulario()}>
            <Text style={styles.addBtnText}>+ Novo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuAberto(true)}>
            <Ionicons name="menu-outline" size={26} color="#302C28" />
          </TouchableOpacity>
        </View>
      </View>

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
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 24, paddingBottom: 16, backgroundColor: '#FDFCFA',
    borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  title:        { fontSize: 26, fontWeight: '500', color: '#302C28' },
  addBtn:       { backgroundColor: '#497363', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '500', fontSize: 14, lineHeight: 20 },
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