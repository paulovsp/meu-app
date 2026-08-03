import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, Image, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getPlanoFinanceiro, getRecebimentosDoMes, getPrecoMedioSessao,
  getContagemPacientes, getContagemSessoesSemRelato, getResumoHorariosSemanais,
} from '../services/database';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validarCPF, buscarEnderecoPorCep, dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { mensagemDeErro } from '../services/erros';
import {
  formatarSaldoBRL, chamarRenovarCreditos, PLANOS_CREDITO_MENSAL_BRL, PLANO_LABEL,
} from '../services/creditosIA';
import { excluirConta } from '../services/conta';
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

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [cepTravado, setCepTravado] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [crp, setCrp] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
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
      setCep(u.cep || '');
      setLogradouro(u.logradouro || '');
      setNumero(u.numero || '');
      setComplemento(u.complemento || '');
      setBairro(u.bairro || '');
      setCidade(u.cidade || '');
      setUf(u.uf || '');
      setCepTravado(!!u.logradouro);
      setCrp(u.crp || '');
      setEmail(u.email || '');
      setTelefone(u.telefone || '');
      setContadorNome(u.contador_nome || '');
      setContadorEmail(u.contador_email || '');
      setContadorTelefone(u.contador_telefone || '');

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

  async function formatarCep(texto) {
    const numeros = texto.replace(/\D/g, '').slice(0, 8);
    let formatado = numeros;
    if (numeros.length > 5) formatado = `${numeros.slice(0, 5)}-${numeros.slice(5)}`;
    setCep(formatado);

    if (numeros.length === 8) {
      setBuscandoCep(true);
      const resultado = await buscarEnderecoPorCep(numeros);
      setBuscandoCep(false);
      if (!resultado) {
        Alert.alert('CEP não encontrado', 'Confira o CEP ou toque em "preencher manualmente" abaixo.');
        return;
      }
      setLogradouro(resultado.logradouro);
      setBairro(resultado.bairro);
      setCidade(resultado.cidade);
      setUf(resultado.uf);
      setCepTravado(true);
    }
  }

  function refazerCep() {
    setCepTravado(false);
    setCep('');
    setLogradouro('');
    setBairro('');
    setCidade('');
    setUf('');
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
    if (!logradouro.trim() || !bairro.trim() || !cidade.trim() || !uf.trim()) {
      Alert.alert('Campo obrigatório', 'Informe seu endereço (CEP ou preenchimento manual).');
      return;
    }
    if (!numero.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o número do seu endereço.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        nome: nome.trim(),
        cpf: cpf.trim(),
        data_nascimento: dataNascimentoISO,
        cep: cep.trim() || null,
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        complemento: complemento.trim() || null,
        bairro: bairro.trim(),
        cidade: cidade.trim(),
        uf: uf.trim(),
        crp: crp.trim(),
        email: email.trim(),
        telefone: telefone.trim(),
        contador_nome: contadorNome.trim(),
        contador_email: contadorEmail.trim(),
        contador_telefone: contadorTelefone.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);
    setSalvando(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível salvar seu perfil.');
      return;
    }
    setEditando(false);
    carregar();
  }

  function sair() {
    Alert.alert('Sair', 'Tem certeza que deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: sairLocalmente },
    ]);
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
          <View style={st.avatar}>
            <Text style={st.avatarText}>
              {(user.nome || '?')
                .split(' ')
                .map(p => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>
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
        <Text style={st.sectionTitle}>👤 Dados cadastrais</Text>

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

            <Text style={st.label}>CEP *</Text>
            <View style={st.cepRow}>
              <TextInput
                style={[st.input, { flex: 1 }, cepTravado && st.inputTravado]}
                value={cep}
                onChangeText={formatarCep}
                keyboardType="numeric"
                placeholder="00000-000"
                maxLength={9}
                editable={!cepTravado}
              />
              {buscandoCep && <ActivityIndicator style={st.cepLoading} color="#3D5A80" />}
            </View>
            {cepTravado ? (
              <TouchableOpacity onPress={refazerCep}>
                <Text style={st.linkRefazer}>Endereço errado? Buscar outro CEP</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setCepTravado(false)}>
                <Text style={st.linkRefazer}>Não encontrou seu CEP? Preencher manualmente</Text>
              </TouchableOpacity>
            )}

            <Text style={st.label}>Logradouro *</Text>
            <TextInput
              style={[st.input, cepTravado && st.inputTravado]}
              value={logradouro}
              onChangeText={setLogradouro}
              placeholder="Rua, avenida..."
              editable={!cepTravado}
            />

            <View style={st.linhaDupla}>
              <View style={{ flex: 1 }}>
                <Text style={st.label}>Número *</Text>
                <TextInput
                  style={st.input}
                  value={numero}
                  onChangeText={setNumero}
                  keyboardType="numeric"
                  placeholder="Ex: 123"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.label}>Complemento</Text>
                <TextInput
                  style={st.input}
                  value={complemento}
                  onChangeText={setComplemento}
                  placeholder="Apto, bloco..."
                />
              </View>
            </View>

            <Text style={st.label}>Bairro *</Text>
            <TextInput
              style={[st.input, cepTravado && st.inputTravado]}
              value={bairro}
              onChangeText={setBairro}
              editable={!cepTravado}
            />

            <View style={st.linhaDupla}>
              <View style={{ flex: 2 }}>
                <Text style={st.label}>Cidade *</Text>
                <TextInput
                  style={[st.input, cepTravado && st.inputTravado]}
                  value={cidade}
                  onChangeText={setCidade}
                  editable={!cepTravado}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.label}>UF *</Text>
                <TextInput
                  style={[st.input, cepTravado && st.inputTravado]}
                  value={uf}
                  onChangeText={(t) => setUf(t.toUpperCase().slice(0, 2))}
                  autoCapitalize="characters"
                  maxLength={2}
                  editable={!cepTravado}
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
                  setCep(user.cep || '');
                  setLogradouro(user.logradouro || '');
                  setNumero(user.numero || '');
                  setComplemento(user.complemento || '');
                  setBairro(user.bairro || '');
                  setCidade(user.cidade || '');
                  setUf(user.uf || '');
                  setCepTravado(!!user.logradouro);
                  setCrp(user.crp || '');
                  setEmail(user.email || '');
                  setTelefone(user.telefone || '');
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
              <Text style={st.infoLabel}>CEP</Text>
              <Text style={st.infoValue}>{user.cep || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Rua</Text>
              <Text style={st.infoValue}>{user.logradouro || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Número</Text>
              <Text style={st.infoValue}>{user.numero || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Complemento</Text>
              <Text style={st.infoValue}>{user.complemento || '—'}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Bairro</Text>
              <Text style={st.infoValue}>{user.bairro || '—'}</Text>
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

            <TouchableOpacity style={st.editBtn} onPress={() => setEditando(true)}>
              <Text style={st.editBtnText}>✏️ Editar dados</Text>
            </TouchableOpacity>

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
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 24, fontWeight: '700', color: '#FFFFFF',
  },
  nomeHeader: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  crpHeader: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  // Seção
  sectionTitle: {
    fontSize: 17, fontWeight: '700', color: '#1C1C1E',
    marginBottom: 14, marginTop: 8,
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
  editBtn: { alignSelf: 'flex-end', marginTop: 12, marginBottom: 8 },
  editBtnText: { fontSize: 14, color: '#3D5A80', fontWeight: '600' },

  sairBtn: { alignItems: 'center', marginTop: 24 },
  sairBtnText: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  excluirContaBtn: { alignItems: 'center', marginTop: 16, paddingBottom: 8 },
  excluirContaBtnText: { fontSize: 12, color: '#999', fontWeight: '600', textDecorationLine: 'underline' },

  // Edit mode
  label: { fontSize: 13, fontWeight: '600', color: '#1C1C1E', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 12, fontSize: 15, color: '#1C1C1E',
    borderWidth: 1, borderColor: '#E8E4DD',
  },
  inputTravado: {
    backgroundColor: '#F0EFEC', color: '#6B6860',
  },
  cepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cepLoading: { width: 24 },
  linkRefazer: { color: '#3D5A80', fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  linhaDupla: { flexDirection: 'row', gap: 12 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnCancel: { backgroundColor: '#F0F0F0' },
  btnCancelText: { fontSize: 15, fontWeight: '600', color: '#6B6860' },
  btnSave: { backgroundColor: '#3D5A80' },
  btnSaveText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
