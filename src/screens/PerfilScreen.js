import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, Image, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  getPlanoFinanceiro, getRecebimentosDoMes, getPrecoMedioSessao,
  getContagemPacientes, getContagemSessoesSemRelato, getResumoHorariosSemanais,
} from '../services/database';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validarCPF, dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { mensagemDeErro } from '../services/erros';
import { enviarFotoPerfil } from '../services/avatar';
import { exportarDadosUsuario } from '../services/exportacaoDados';
import {
  formatarSaldoBRL, chamarRenovarCreditos, PLANOS_CREDITO_MENSAL_BRL, PLANO_LABEL,
} from '../services/creditosIA';
import { excluirConta, alterarEmailLogin } from '../services/conta';
import {
  biometriaDisponivelNoAparelho, loginBiometricoEstaAtivo,
  ativarLoginBiometrico, desativarLoginBiometrico,
} from '../services/biometria';

// "Ganhos do mês" só faz sentido em números inteiros aqui (sem casas
// decimais) — e usa Math.round em vez de truncar as casas via toLocaleString
// direto, senão R$ 10,99 viraria R$ 10 (errado) em vez de R$ 11.
function formatarMoedaInteira(valor) {
  return Math.round(valor || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  });
}

export default function PerfilScreen({ navigation }) {
  const { session, sairLocalmente } = useAuth();
  const [user, setUser] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [plano, setPlano] = useState(null);
  const [estatisticas, setEstatisticas] = useState({
    precoMedio: 0, totalPacientes: 0, sessoesSemRelato: 0, pagamentosEmAberto: 0,
    horariosOcupados: 0, horariosTotal: 0,
  });
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [bioSuportada, setBioSuportada] = useState(false);
  const [bioAtiva, setBioAtiva] = useState(false);
  const [bioProcessando, setBioProcessando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [notifTranscricaoPush, setNotifTranscricaoPush] = useState(true);
  const [notifAtrasoEmail, setNotifAtrasoEmail] = useState(true);
  const [notifSalvando, setNotifSalvando] = useState(null);
  const [exportando, setExportando] = useState(false);

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [crp, setCrp] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [contadorNome, setContadorNome] = useState('');
  const [contadorEmail, setContadorEmail] = useState('');
  const [contadorTelefone, setContadorTelefone] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data: u, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    if (error) {
      console.error('Erro ao carregar profile (Perfil):', error.message, error);
      Alert.alert('Erro', `Não foi possível carregar seu perfil.\n\n${error.message}`);
    } else {
      setUser(u);
      setNome(u.nome || '');
      setCpf(u.cpf || '');
      setDataNascimento(dataISOParaBR(u.data_nascimento));
      setCidade(u.cidade || '');
      setUf(u.uf || '');
      setCrp(u.crp || '');
      setEmail(u.email || '');
      setTelefone(u.telefone || '');
      setPixKey(u.pix_key || '');
      setContadorNome(u.contador_nome || '');
      setContadorEmail(u.contador_email || '');
      setContadorTelefone(u.contador_telefone || '');
      setNotifTranscricaoPush(u.notif_transcricao_push !== false);
      setNotifAtrasoEmail(u.notif_atraso_email !== false);

      // Checagem silenciosa de renovação mensal de créditos — se houver
      // renovação pendente, já reflete o saldo/data novos sem recarregar tudo.
      chamarRenovarCreditos().then((resultado) => {
        if (resultado?.renovado) {
          setUser((atual) => (atual ? {
            ...atual,
            creditos_ia: resultado.saldoAtual,
            proxima_renovacao_credito: resultado.proximaRenovacao,
          } : atual));
        }
      });
    }
    try {
      setPlano(await getPlanoFinanceiro(new Date()));
    } catch (e) {
      Alert.alert('Erro ao carregar', mensagemDeErro(e));
    }
    try {
      const hoje = new Date();
      const [precoMedio, totalPacientes, sessoesSemRelato, horarios, recebimentos] = await Promise.all([
        getPrecoMedioSessao(),
        getContagemPacientes(),
        getContagemSessoesSemRelato(),
        getResumoHorariosSemanais(),
        getRecebimentosDoMes(hoje.getFullYear(), hoje.getMonth()),
      ]);
      setEstatisticas({
        precoMedio,
        totalPacientes,
        sessoesSemRelato,
        pagamentosEmAberto: recebimentos.filter((r) => !r.recebido).length,
        horariosOcupados: horarios.ocupados,
        horariosTotal: horarios.total,
      });
    } catch (e) {
      console.error('Erro ao carregar estatísticas de atividade:', e?.message || e);
    }
    setCarregando(false);
  }, [session.user.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    (async () => {
      setBioSuportada(await biometriaDisponivelNoAparelho());
      setBioAtiva(await loginBiometricoEstaAtivo());
    })();
  }, []);

  async function alternarBiometria(valor) {
    setBioProcessando(true);
    try {
      if (valor) {
        await ativarLoginBiometrico(user.email);
        setBioAtiva(true);
      } else {
        await desativarLoginBiometrico();
        setBioAtiva(false);
      }
    } catch (err) {
      Alert.alert('Não foi possível ativar', mensagemDeErro(err));
    } finally {
      setBioProcessando(false);
    }
  }

  async function alternarNotif(campo, valor, setter) {
    setNotifSalvando(campo);
    setter(valor);
    const { error } = await supabase
      .from('profiles')
      .update({ [campo]: valor })
      .eq('id', session.user.id);
    setNotifSalvando(null);
    if (error) {
      setter(!valor);
      Alert.alert('Erro', 'Não foi possível salvar a preferência.');
    }
  }

  async function escolherFoto(deCamera) {
    const perm = deCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permissão negada', deCamera ? 'Precisamos de acesso à câmera.' : 'Precisamos de acesso à galeria.');
      return;
    }
    const opcoes = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    };
    const result = deCamera
      ? await ImagePicker.launchCameraAsync(opcoes)
      : await ImagePicker.launchImageLibraryAsync(opcoes);
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    setEnviandoFoto(true);
    try {
      const novaUrl = await enviarFotoPerfil(uri);
      setUser((atual) => (atual ? { ...atual, avatar_url: novaUrl } : atual));
    } catch (err) {
      Alert.alert('Erro ao enviar foto', mensagemDeErro(err));
    } finally {
      setEnviandoFoto(false);
    }
  }

  function trocarFoto() {
    Alert.alert('Foto de perfil', 'Escolha de onde pegar a foto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Galeria', onPress: () => escolherFoto(false) },
      { text: 'Câmera', onPress: () => escolherFoto(true) },
    ]);
  }

  function formatarCpf(texto) {
    const numeros = texto.replace(/\D/g, '').slice(0, 11);
    let formatado = numeros;
    if (numeros.length > 9) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6, 9)}-${numeros.slice(9)}`;
    } else if (numeros.length > 6) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6)}`;
    } else if (numeros.length > 3) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3)}`;
    }
    setCpf(formatado);
  }

  function formatarData(texto, setter) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length >= 3 && numeros.length <= 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    } else if (numeros.length > 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
    }
    setter(formatado);
  }

  function formatarTelefone(texto, setter) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length > 2 && numeros.length <= 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    } else if (numeros.length > 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7, 11)}`;
    }
    setter(formatado);
  }

  async function salvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Informe seu nome.');
      return;
    }
    if (!validarCPF(cpf)) {
      Alert.alert('CPF inválido', 'Confira o CPF digitado.');
      return;
    }
    const dataNascimentoISO = dataBRParaISO(dataNascimento);
    if (!dataNascimentoISO) {
      Alert.alert('Campo obrigatório', 'Informe sua data de nascimento completa.');
      return;
    }
    if (!cidade.trim() || !uf.trim()) {
      Alert.alert('Campo obrigatório', 'Informe sua cidade e UF.');
      return;
    }

    // E-mail de LOGIN (não é o mesmo que profiles.email) só muda depois de
    // confirmação por link — nunca sai daqui direto no update em lote, pra
    // não dessincronizar os dois enquanto a confirmação está pendente
    // (ver alterarEmailLogin e a migration 0033). Item A.1/A.3.
    const novoEmail = email.trim();
    const emailMudou = novoEmail && novoEmail !== (user.email || '');
    if (emailMudou && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) {
      Alert.alert('E-mail inválido', 'Confira o e-mail digitado.');
      return;
    }

    setSalvando(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        nome: nome.trim(),
        cpf: cpf.trim(),
        data_nascimento: dataNascimentoISO,
        cidade: cidade.trim(),
        uf: uf.trim(),
        crp: crp.trim(),
        telefone: telefone.trim(),
        pix_key: pixKey.trim() || null,
        contador_nome: contadorNome.trim(),
        contador_email: contadorEmail.trim(),
        contador_telefone: contadorTelefone.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);
    if (error) {
      setSalvando(false);
      Alert.alert('Erro', 'Não foi possível salvar seu perfil.');
      return;
    }

    if (emailMudou) {
      try {
        await alterarEmailLogin(novoEmail);
      } catch (e) {
        setSalvando(false);
        Alert.alert('Erro ao trocar e-mail', mensagemDeErro(e));
        return;
      }
    }

    setSalvando(false);
    setEditando(false);
    carregar();

    if (emailMudou) {
      Alert.alert(
        'Confirme a troca de e-mail',
        `Enviamos um link de confirmação pra ${novoEmail}. Seu e-mail de login só muda depois que você confirmar — até lá, continue entrando com o e-mail atual.`
      );
    }
  }

  function sair() {
    Alert.alert('Sair', 'Tem certeza que deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: sairLocalmente },
    ]);
  }

  async function exportarDados() {
    setExportando(true);
    try {
      await exportarDadosUsuario();
    } catch (e) {
      Alert.alert('Erro ao exportar', mensagemDeErro(e));
    } finally {
      setExportando(false);
    }
  }

  function excluirContaHandler() {
    Alert.alert(
      'Excluir conta permanentemente',
      'Isso apaga sua conta e TODOS os dados ligados a ela — analisantes, sessões, registros, agenda, financeiro, perfil psicossomático e relatórios. Não tem como desfazer. Confirma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir permanentemente',
          style: 'destructive',
          onPress: async () => {
            try {
              await excluirConta();
              await desativarLoginBiometrico();
              await supabase.auth.signOut();
            } catch (e) {
              Alert.alert('Erro ao excluir conta', mensagemDeErro(e));
            }
          },
        },
      ]
    );
  }

  if (carregando) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.loadingWrap}>
          <ActivityIndicator size="large" color="#3D5A80" />
        </View>
      </SafeAreaView>
    );
  }

  // Perfil não carregou (conta removida, sessão velha, problema de rede,
  // etc.) — antes disso deixava a tela presa num spinner pra sempre, sem
  // nenhum jeito de sair. Agora sempre sobra pelo menos a opção de sair.
  if (!user) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.loadingWrap}>
          <Text style={st.erroTitulo}>Não foi possível carregar seu perfil</Text>
          <Text style={st.erroTexto}>
            Isso pode acontecer se a conta foi removida ou a sessão expirou.
          </Text>
          <TouchableOpacity style={st.sairBtn} onPress={sair}>
            <Text style={st.sairBtnText}>Sair da conta</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={st.scrollInner}>
        {/* ── Cabeçalho ── */}
        <View style={st.headerCard}>
          <TouchableOpacity
            style={st.avatar}
            onPress={trocarFoto}
            disabled={enviandoFoto}
            activeOpacity={0.8}
          >
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={st.avatarImg} />
            ) : (
              <Text style={st.avatarText}>
                {(user.nome || '?')
                  .split(' ')
                  .map(p => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </Text>
            )}
            {enviandoFoto && (
              <View style={st.avatarLoadingOverlay}>
                <ActivityIndicator color="#FFFFFF" size="small" />
              </View>
            )}
          </TouchableOpacity>
          <Text style={st.avatarHint}>Toque pra trocar a foto</Text>
          <Text style={st.nomeHeader}>{user.nome || 'Sem nome'}</Text>
          {user.crp ? <Text style={st.crpHeader}>{user.crp}</Text> : null}
        </View>

        {/* ── Sua atividade ── */}
        <Text style={st.sectionTitle}>📊 Sua atividade</Text>
        <View style={st.statsRow}>
          <View style={st.statCard}>
            <Text style={st.statNumber}>{plano?.itensDiario?.length ?? 0}</Text>
            <Text style={st.statLabel}>Sessões hoje</Text>
          </View>
          <View style={st.statCard}>
            <Text style={st.statNumber} numberOfLines={1} adjustsFontSizeToFit>
              {estatisticas.horariosOcupados}/{estatisticas.horariosTotal}
            </Text>
            <Text style={st.statLabel}>Horários semanais</Text>
          </View>
        </View>
        <View style={st.statsRow}>
          <View style={st.statCard}>
            <Text style={st.statNumber} numberOfLines={1} adjustsFontSizeToFit>
              {formatarMoedaInteira(plano?.totalMensal ?? 0)}
            </Text>
            <Text style={st.statLabel}>Ganhos do mês</Text>
          </View>
          <View style={[st.statCard, Number(user.creditos_ia) <= 0 && st.statCardAlerta]}>
            <Text style={[st.statNumber, Number(user.creditos_ia) <= 0 && st.statNumberAlerta]}>
              {formatarSaldoBRL(Number(user.creditos_ia ?? 0))}
            </Text>
            <Text style={st.statLabel}>Créditos de IA</Text>
          </View>
        </View>
        <View style={st.statsRow}>
          <View style={st.statCard}>
            <Text style={st.statNumber} numberOfLines={1} adjustsFontSizeToFit>
              {formatarMoedaInteira(estatisticas.precoMedio)}
            </Text>
            <Text style={st.statLabel}>Preço médio da sessão</Text>
          </View>
          <View style={st.statCard}>
            <Text style={st.statNumber}>{estatisticas.totalPacientes}</Text>
            <Text style={st.statLabel}>Analisante{estatisticas.totalPacientes === 1 ? '' : 's'}</Text>
          </View>
        </View>
        <View style={st.statsRow}>
          <View style={st.statCard}>
            <Text style={st.statNumber}>{estatisticas.sessoesSemRelato}</Text>
            <Text style={st.statLabel}>Sessões sem relatos</Text>
          </View>
          <View style={st.statCard}>
            <Text style={st.statNumber}>{estatisticas.pagamentosEmAberto}</Text>
            <Text style={st.statLabel}>Pagamentos em aberto</Text>
          </View>
        </View>

        {/* ── Dados cadastrais ── */}
        <View style={st.sectionTitleRow}>
          <Text style={st.sectionTitle}>👤 Dados cadastrais</Text>
          {!editando && (
            <TouchableOpacity style={st.editBtn} onPress={() => setEditando(true)}>
              <Text style={st.editBtnText}>✏️ Editar</Text>
            </TouchableOpacity>
          )}
        </View>

        {editando ? (
          <>
            <Text style={st.label}>Nome completo *</Text>
            <TextInput style={st.input} value={nome} onChangeText={setNome} />

            <Text style={st.label}>CPF *</Text>
            <TextInput
              style={st.input}
              value={cpf}
              onChangeText={formatarCpf}
              keyboardType="numeric"
              placeholder="000.000.000-00"
              maxLength={14}
            />

            <Text style={st.label}>Data de nascimento *</Text>
            <TextInput
              style={st.input}
              value={dataNascimento}
              onChangeText={(t) => formatarData(t, setDataNascimento)}
              keyboardType="numeric"
              placeholder="00/00/0000"
              maxLength={10}
            />

            <View style={st.linhaDupla}>
              <View style={{ flex: 2 }}>
                <Text style={st.label}>Cidade *</Text>
                <TextInput
                  style={st.input}
                  value={cidade}
                  onChangeText={setCidade}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.label}>UF *</Text>
                <TextInput
                  style={st.input}
                  value={uf}
                  onChangeText={(t) => setUf(t.toUpperCase().slice(0, 2))}
                  autoCapitalize="characters"
                  maxLength={2}
                />
              </View>
            </View>

            <Text style={st.label}>CRP</Text>
            <TextInput style={st.input} value={crp} onChangeText={setCrp} />

            <Text style={st.label}>E-mail</Text>
            <TextInput
              style={st.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={st.label}>Telefone</Text>
            <TextInput
              style={st.input}
              value={telefone}
              onChangeText={(t) => formatarTelefone(t, setTelefone)}
              keyboardType="phone-pad"
              maxLength={15}
              placeholder="(11) 99999-9999"
            />

            <Text style={st.label}>Chave Pix</Text>
            <TextInput
              style={st.input}
              value={pixKey}
              onChangeText={setPixKey}
              autoCapitalize="none"
              placeholder="CPF, e-mail, telefone ou chave aleatória"
            />

            {/* ── Contador (para envio do resumo mensal de recebimentos) ── */}
            <Text style={st.sectionTitle}>📊 Contador</Text>

            <Text style={st.label}>Nome do contador</Text>
            <TextInput style={st.input} value={contadorNome} onChangeText={setContadorNome} />

            <Text style={st.label}>E-mail do contador</Text>
            <TextInput
              style={st.input}
              value={contadorEmail}
              onChangeText={setContadorEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={st.label}>WhatsApp do contador</Text>
            <TextInput
              style={st.input}
              value={contadorTelefone}
              onChangeText={(t) => formatarTelefone(t, setContadorTelefone)}
              keyboardType="phone-pad"
              maxLength={15}
              placeholder="(11) 99999-9999"
            />

            <View style={st.btnRow}>
              <TouchableOpacity
                style={[st.btn, st.btnCancel]}
                onPress={() => {
                  setEditando(false);
                  setNome(user.nome || '');
                  setCpf(user.cpf || '');
                  setDataNascimento(dataISOParaBR(user.data_nascimento));
                  setCidade(user.cidade || '');
                  setUf(user.uf || '');
                  setCrp(user.crp || '');
                  setEmail(user.email || '');
                  setTelefone(user.telefone || '');
                  setPixKey(user.pix_key || '');
                  setContadorNome(user.contador_nome || '');
                  setContadorEmail(user.contador_email || '');
                  setContadorTelefone(user.contador_telefone || '');
                }}
              >
                <Text style={st.btnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.btn, st.btnSave, salvando && { opacity: 0.7 }]}
                onPress={salvar}
                disabled={salvando}
              >
                <Text style={st.btnSaveText}>{salvando ? 'Salvando...' : 'Salvar'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Nome</Text>
              <Text style={st.infoValue}>{user.nome || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>CPF</Text>
              <Text style={st.infoValue}>{user.cpf || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Data de nascimento</Text>
              <Text style={st.infoValue}>{dataISOParaBR(user.data_nascimento) || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Cidade/Estado</Text>
              <Text style={st.infoValue}>{user.cidade ? `${user.cidade} - ${user.uf}` : '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>CRP</Text>
              <Text style={st.infoValue}>{user.crp || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>E-mail</Text>
              <Text style={st.infoValue}>{user.email || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Telefone</Text>
              <Text style={st.infoValue}>{user.telefone || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Chave Pix</Text>
              <Text style={st.infoValue}>{user.pix_key || '—'}</Text>
            </View>

            <TouchableOpacity
              style={st.mensagensLink}
              onPress={() => navigation.navigate('MensagensPersonalizadas')}
            >
              <Text style={st.mensagensLinkText}>✉️ Mensagens personalizadas</Text>
            </TouchableOpacity>

            <Text style={st.sectionTitle}>✍️ Assinatura</Text>
            <View style={st.assinaturaBox}>
              {user.assinatura ? (
                <Image source={{ uri: user.assinatura }} style={st.assinaturaImg} resizeMode="contain" />
              ) : (
                <Text style={st.assinaturaVazia}>Nenhuma assinatura salva</Text>
              )}
              <TouchableOpacity
                style={st.assinaturaBtn}
                onPress={() => navigation.navigate('Assinatura')}
              >
                <Text style={st.assinaturaBtnTexto}>
                  {user.assinatura ? 'Editar assinatura' : 'Desenhar assinatura'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={st.sectionTitle}>🤖 Créditos de IA</Text>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Saldo disponível</Text>
              <Text style={[st.infoValue, Number(user.creditos_ia) <= 0 && st.infoValueAlerta]}>
                {formatarSaldoBRL(Number(user.creditos_ia ?? 0))}
              </Text>
            </View>
            {Number(user.creditos_ia) <= 0 && (
              <Text style={st.creditosAviso}>
                Sem créditos — transcrição, análise e o assistente clínico ficam bloqueados até recarregar.
              </Text>
            )}

            <View style={st.creditosDetalheBox}>
              <View style={st.infoRow}>
                <Text style={st.infoLabel}>Plano</Text>
                <Text style={st.infoValue}>{PLANO_LABEL[user.plano_ia] || 'Nenhum plano definido'}</Text>
              </View>
              <View style={st.infoRow}>
                <Text style={st.infoLabel}>Próxima renovação</Text>
                <Text style={st.infoValue}>
                  {user.proxima_renovacao_credito ? dataISOParaBR(user.proxima_renovacao_credito) : '—'}
                </Text>
              </View>
              <View style={st.infoRow}>
                <Text style={st.infoLabel}>Créditos na próxima renovação</Text>
                <Text style={st.infoValue}>
                  {user.plano_ia
                    ? (PLANOS_CREDITO_MENSAL_BRL[user.plano_ia] || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </Text>
              </View>

              <TouchableOpacity
                style={st.assinaturaBtn}
                onPress={() => Alert.alert(
                  'Adicionar créditos',
                  'Pra adicionar mais créditos ou mudar de plano, entre em contato com quem administra sua assinatura.'
                )}
              >
                <Text style={st.assinaturaBtnTexto}>Adicionar créditos</Text>
              </TouchableOpacity>
            </View>

            <Text style={st.sectionTitle}>📊 Contador</Text>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Nome</Text>
              <Text style={st.infoValue}>{user.contador_nome || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>E-mail</Text>
              <Text style={st.infoValue}>{user.contador_email || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>WhatsApp</Text>
              <Text style={st.infoValue}>{user.contador_telefone || '—'}</Text>
            </View>

            <Text style={st.sectionTitle}>🔒 Segurança</Text>
            <View style={st.bioRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.bioLabel}>Entrar com digital</Text>
                <Text style={st.bioSub}>
                  {bioSuportada
                    ? 'Use sua digital ou Face ID pra entrar sem digitar e-mail e senha.'
                    : 'Este aparelho não tem digital/Face ID configurados.'}
                </Text>
              </View>
              {bioProcessando ? (
                <ActivityIndicator color="#3D5A80" />
              ) : (
                <Switch
                  value={bioAtiva}
                  onValueChange={alternarBiometria}
                  disabled={!bioSuportada}
                />
              )}
            </View>

            <Text style={st.sectionTitle}>🔔 Notificações</Text>
            <View style={st.bioRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.bioLabel}>Transcrição pronta</Text>
                <Text style={st.bioSub}>Aviso no app quando a transcrição de uma sessão terminar (ou falhar).</Text>
              </View>
              {notifSalvando === 'notif_transcricao_push' ? (
                <ActivityIndicator color="#3D5A80" />
              ) : (
                <Switch
                  value={notifTranscricaoPush}
                  onValueChange={(v) => alternarNotif('notif_transcricao_push', v, setNotifTranscricaoPush)}
                />
              )}
            </View>
            <View style={st.bioRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.bioLabel}>Recebimento em atraso</Text>
                <Text style={st.bioSub}>E-mail avisando quando um pagamento mensal passar do vencimento.</Text>
              </View>
              {notifSalvando === 'notif_atraso_email' ? (
                <ActivityIndicator color="#3D5A80" />
              ) : (
                <Switch
                  value={notifAtrasoEmail}
                  onValueChange={(v) => alternarNotif('notif_atraso_email', v, setNotifAtrasoEmail)}
                />
              )}
            </View>

            <TouchableOpacity style={st.exportarBtn} onPress={exportarDados} disabled={exportando}>
              {exportando ? (
                <ActivityIndicator color="#3D5A80" />
              ) : (
                <Text style={st.exportarBtnText}>📤 Exportar meus dados</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={st.sairBtn} onPress={sair}>
              <Text style={st.sairBtnText}>Sair da conta</Text>
            </TouchableOpacity>

            <TouchableOpacity style={st.excluirContaBtn} onPress={excluirContaHandler}>
              <Text style={st.excluirContaBtnText}>Excluir minha conta</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 20,
  },
  bioLabel: { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },
  bioSub: { fontSize: 12, color: '#6B6860', marginTop: 4, lineHeight: 17 },
  safe: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollInner: { padding: 20, paddingBottom: 50 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  erroTitulo: { fontSize: 17, fontWeight: '700', color: '#1C1C1E', textAlign: 'center' },
  erroTexto: { fontSize: 14, color: '#6B6860', textAlign: 'center', lineHeight: 20 },

  // Header
  headerCard: {
    backgroundColor: '#3D5A80',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#1A2D45',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 6,
    borderWidth: 3, borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: {
    fontSize: 24, fontWeight: '700', color: '#FFFFFF',
  },
  avatarHint: {
    fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8,
  },
  nomeHeader: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  crpHeader: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  // Seção
  sectionTitle: {
    fontSize: 17, fontWeight: '700', color: '#1C1C1E',
    marginBottom: 14, marginTop: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },

  // Stats
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
    padding: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#E8E4DD',
  },
  statCardAlerta: { backgroundColor: '#FCEBEA', borderColor: '#F0C4C0' },
  statNumber: { fontSize: 20, fontWeight: '700', color: '#3D5A80' },
  statNumberAlerta: { color: '#C0392B' },
  statLabel: { fontSize: 12, color: '#6B6860', marginTop: 4 },

  // Info rows
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E8E4DD',
  },
  infoLabel: { fontSize: 14, color: '#6B6860' },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  infoValueAlerta: { color: '#C0392B' },
  creditosAviso: {
    fontSize: 12, color: '#C0392B', lineHeight: 17, marginTop: -6, marginBottom: 12,
  },
  creditosDetalheBox: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#E8E4DD', marginBottom: 8, gap: 4,
  },

  // Assinatura
  assinaturaBox: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#E8E4DD', alignItems: 'center', gap: 10,
    marginBottom: 8,
  },
  assinaturaImg: { width: '100%', height: 80 },
  assinaturaVazia: { fontSize: 13, color: '#A5A19A', fontStyle: 'italic' },
  assinaturaBtn: {
    borderWidth: 1, borderColor: '#3D5A80', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  assinaturaBtnTexto: { color: '#3D5A80', fontWeight: '700', fontSize: 13 },

  // Edit
  editBtn: { paddingVertical: 4, paddingLeft: 12 },
  mensagensLink: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 20,
  },
  mensagensLinkText: { fontSize: 15, fontWeight: '700', color: '#3D5A80' },
  editBtnText: { fontSize: 14, color: '#3D5A80', fontWeight: '600' },

  sairBtn: { alignItems: 'center', marginTop: 24 },
  sairBtnText: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  exportarBtn: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#E8E4DD',
  },
  exportarBtnText: { fontSize: 14, color: '#3D5A80', fontWeight: '700' },
  excluirContaBtn: { alignItems: 'center', marginTop: 16, paddingBottom: 8 },
  excluirContaBtnText: { fontSize: 12, color: '#999', fontWeight: '600', textDecorationLine: 'underline' },

  // Edit mode
  label: { fontSize: 13, fontWeight: '600', color: '#1C1C1E', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 12, fontSize: 15, color: '#1C1C1E',
    borderWidth: 1, borderColor: '#E8E4DD',
  },
  linhaDupla: { flexDirection: 'row', gap: 12 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnCancel: { backgroundColor: '#F0F0F0' },
  btnCancelText: { fontSize: 15, fontWeight: '600', color: '#6B6860' },
  btnSave: { backgroundColor: '#3D5A80' },
  btnSaveText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
