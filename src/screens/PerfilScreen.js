import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, Image, Switch, Modal, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  getPlanoFinanceiro, getRecebimentosDoMes, getPrecoMedioSessao,
  getContagemAnalisantesESupervisionandos, getContagemSessoesSemRelato, getResumoHorariosSemanais,
} from '../services/database';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validarCPF, dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { mensagemDeErro } from '../services/erros';
import { enviarFotoPerfil, enviarFotoCapa } from '../services/avatar';
import { exportarDadosUsuario } from '../services/exportacaoDados';
import {
  formatarSaldoBRL, chamarRenovarCreditos, PLANOS_CREDITO_MENSAL_BRL, PLANO_LABEL,
  PACOTES_CREDITO_AVULSO_BRL, criarCheckoutCreditos,
} from '../services/creditosIA';
import { excluirConta, alterarEmailLogin, alterarSenha } from '../services/conta';
import SeletorCidadeEstado from '../components/SeletorCidadeEstado';
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
    precoMedio: 0, totalAnalisantes: 0, totalSupervisionandos: 0, sessoesSemRelato: 0, pagamentosEmAberto: 0,
    horariosOcupados: 0, horariosTotal: 0,
  });
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [bioSuportada, setBioSuportada] = useState(false);
  const [bioAtiva, setBioAtiva] = useState(false);
  const [bioProcessando, setBioProcessando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviandoCapa, setEnviandoCapa] = useState(false);
  const [notifTranscricaoPush, setNotifTranscricaoPush] = useState(true);
  const [notifTranscricaoEmail, setNotifTranscricaoEmail] = useState(false);
  const [notifAtrasoEmail, setNotifAtrasoEmail] = useState(true);
  const [notifAtrasoPush, setNotifAtrasoPush] = useState(false);
  const [notifSalvando, setNotifSalvando] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [abrindoCheckout, setAbrindoCheckout] = useState(false);
  const [modalSenhaVisivel, setModalSenhaVisivel] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [seletorCidadeAberto, setSeletorCidadeAberto] = useState(false);
  const [crp, setCrp] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [contadorNome, setContadorNome] = useState('');
  const [contadorEmail, setContadorEmail] = useState('');
  const [contadorTelefone, setContadorTelefone] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const hoje = new Date();

    // As 3 buscas abaixo são independentes entre si — antes rodavam uma
    // depois da outra (perfil, DEPOIS plano, DEPOIS estatísticas), somando
    // o tempo das três. Disparadas juntas com Promise.all, o tempo total
    // vira o da mais lenta, não a soma — é isso que fazia o Perfil demorar
    // tanto pra abrir.
    const [perfilResultado, planoResultado, statsResultado] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      getPlanoFinanceiro(hoje).catch((e) => ({ __erro: e })),
      // Promise.allSettled (não Promise.all) — uma consulta falhando não pode
      // zerar as OUTRAS estatísticas que carregaram normalmente. Cada card
      // mostra o que conseguiu buscar; erros individuais só vão pro console.
      Promise.allSettled([
        getPrecoMedioSessao(),
        getContagemAnalisantesESupervisionandos(),
        getContagemSessoesSemRelato(),
        getResumoHorariosSemanais(),
        getRecebimentosDoMes(hoje.getFullYear(), hoje.getMonth()),
      ]),
    ]);

    const { data: u, error } = perfilResultado;
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
      setNotifTranscricaoEmail(u.notif_transcricao_email === true);
      setNotifAtrasoEmail(u.notif_atraso_email !== false);
      setNotifAtrasoPush(u.notif_atraso_push === true);

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

    if (planoResultado?.__erro) {
      Alert.alert('Erro ao carregar', mensagemDeErro(planoResultado.__erro));
    } else {
      setPlano(planoResultado);
    }

    const [precoMedio, contagemAnalisantes, sessoesSemRelato, horarios, recebimentos] = statsResultado;
    [
      ['getPrecoMedioSessao', precoMedio],
      ['getContagemAnalisantesESupervisionandos', contagemAnalisantes],
      ['getContagemSessoesSemRelato', sessoesSemRelato],
      ['getResumoHorariosSemanais', horarios],
      ['getRecebimentosDoMes', recebimentos],
    ].forEach(([nome, resultado]) => {
      if (resultado.status === 'rejected') {
        console.error(`Erro ao carregar estatística (${nome}):`, resultado.reason?.message || resultado.reason);
      }
    });
    setEstatisticas((atual) => ({
      precoMedio: precoMedio.status === 'fulfilled' ? precoMedio.value : atual.precoMedio,
      totalAnalisantes: contagemAnalisantes.status === 'fulfilled' ? contagemAnalisantes.value.analisantes : atual.totalAnalisantes,
      totalSupervisionandos: contagemAnalisantes.status === 'fulfilled' ? contagemAnalisantes.value.supervisionandos : atual.totalSupervisionandos,
      sessoesSemRelato: sessoesSemRelato.status === 'fulfilled' ? sessoesSemRelato.value : atual.sessoesSemRelato,
      pagamentosEmAberto: recebimentos.status === 'fulfilled'
        ? recebimentos.value.filter((r) => !r.recebido).length
        : atual.pagamentosEmAberto,
      horariosOcupados: horarios.status === 'fulfilled' ? horarios.value.ocupados : atual.horariosOcupados,
      horariosTotal: horarios.status === 'fulfilled' ? horarios.value.total : atual.horariosTotal,
    }));
    setCarregando(false);
  }, [session.user.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function iniciarCheckoutCreditos(valorBRL) {
    setAbrindoCheckout(true);
    try {
      const initPoint = await criarCheckoutCreditos(valorBRL);
      if (initPoint) await Linking.openURL(initPoint);
    } catch (e) {
      Alert.alert('Erro ao gerar link de pagamento', mensagemDeErro(e));
    } finally {
      setAbrindoCheckout(false);
    }
  }

  function abrirRecargaCreditos() {
    Alert.alert(
      'Adicionar créditos',
      'Escolha o valor da recarga — você será levada ao checkout do Mercado Pago.',
      [
        ...PACOTES_CREDITO_AVULSO_BRL.map((valor) => ({
          text: `R$ ${valor}`,
          onPress: () => iniciarCheckoutCreditos(valor),
        })),
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  }

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

  function fecharModalSenha() {
    setModalSenhaVisivel(false);
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarNovaSenha('');
  }

  async function confirmarTrocaSenha() {
    if (!senhaAtual || !novaSenha || !confirmarNovaSenha) {
      Alert.alert('Campos obrigatórios', 'Preencha a senha atual e a nova senha (duas vezes).');
      return;
    }
    if (novaSenha.length < 6) {
      Alert.alert('Senha muito curta', 'A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (novaSenha !== confirmarNovaSenha) {
      Alert.alert('Senhas diferentes', 'A confirmação não bate com a nova senha.');
      return;
    }
    setTrocandoSenha(true);
    try {
      await alterarSenha(user.email, senhaAtual, novaSenha);
      fecharModalSenha();
      Alert.alert('Senha alterada', 'Sua senha foi atualizada com sucesso.');
    } catch (err) {
      Alert.alert('Não foi possível trocar a senha', mensagemDeErro(err));
    } finally {
      setTrocandoSenha(false);
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

  async function escolherFoto(deCamera, alvo) {
    const perm = deCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permissão negada', deCamera ? 'Precisamos de acesso à câmera.' : 'Precisamos de acesso à galeria.');
      return;
    }
    // Perfil é quadrado (avatar circular); capa é retangular, na proporção
    // do cabeçalho, pra a foto preencher a caixa inteira sem cortar errado.
    const opcoes = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: alvo === 'capa' ? [16, 9] : [1, 1],
      quality: 0.6,
    };
    const result = deCamera
      ? await ImagePicker.launchCameraAsync(opcoes)
      : await ImagePicker.launchImageLibraryAsync(opcoes);
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    if (alvo === 'capa') {
      setEnviandoCapa(true);
      try {
        const novaUrl = await enviarFotoCapa(uri);
        setUser((atual) => (atual ? { ...atual, capa_url: novaUrl } : atual));
      } catch (err) {
        Alert.alert('Erro ao enviar foto', mensagemDeErro(err));
      } finally {
        setEnviandoCapa(false);
      }
      return;
    }

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
      { text: 'Galeria', onPress: () => escolherFoto(false, 'perfil') },
      { text: 'Câmera', onPress: () => escolherFoto(true, 'perfil') },
    ]);
  }

  function trocarCapa() {
    Alert.alert('Foto de fundo', 'Escolha de onde pegar a foto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Galeria', onPress: () => escolherFoto(false, 'capa') },
      { text: 'Câmera', onPress: () => escolherFoto(true, 'capa') },
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
        <View style={st.headerMolduraGrossa}>
          <View style={st.headerMolduraFina}>
            <TouchableOpacity
              style={st.headerCard}
              onPress={trocarCapa}
              disabled={enviandoCapa}
              activeOpacity={0.9}
            >
              {user.capa_url ? (
                <Image source={{ uri: user.capa_url }} style={st.headerCapaImg} resizeMode="cover" />
              ) : (
                <View style={st.headerCapaVazia} />
              )}
              <View style={st.headerOverlay} />

              {enviandoCapa && (
                <View style={st.headerCapaLoadingOverlay}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
              <View style={st.headerCapaHint}>
                <Text style={st.headerCapaHintText}>📷 Toque pra trocar o fundo</Text>
              </View>

              <View style={st.headerConteudo} pointerEvents="box-none">
                <TouchableOpacity
                  style={st.avatarMolduraGrossa}
                  onPress={trocarFoto}
                  disabled={enviandoFoto}
                  activeOpacity={0.8}
                >
                  <View style={st.avatarMolduraFina}>
                    <View style={st.avatar}>
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
                    </View>
                  </View>
                </TouchableOpacity>
                <Text style={st.avatarHint}>Toque na foto pra trocar</Text>
                <Text style={st.nomeHeader}>{user.nome || 'Sem nome'}</Text>
                {user.crp ? <Text style={st.crpHeader}>{user.crp}</Text> : null}
              </View>
            </TouchableOpacity>
          </View>
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
          <TouchableOpacity
            style={[st.statCard, Number(user.creditos_ia) <= 0 && st.statCardAlerta]}
            onPress={abrirRecargaCreditos}
          >
            <Text style={[st.statNumber, Number(user.creditos_ia) <= 0 && st.statNumberAlerta]}>
              {formatarSaldoBRL(Number(user.creditos_ia ?? 0))}
            </Text>
            <Text style={st.statLabel}>Créditos de IA</Text>
          </TouchableOpacity>
        </View>
        <View style={st.statsRow}>
          <View style={st.statCard}>
            <Text style={st.statNumber} numberOfLines={1} adjustsFontSizeToFit>
              {formatarMoedaInteira(estatisticas.precoMedio)}
            </Text>
            <Text style={st.statLabel}>Preço médio da sessão</Text>
          </View>
          <TouchableOpacity
            style={st.statCard}
            onPress={() => navigation.navigate('Patients', { aba: 'analisantes' })}
          >
            <Text style={st.statNumber}>{estatisticas.totalAnalisantes}</Text>
            <Text style={st.statLabel}>Analisante{estatisticas.totalAnalisantes === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        </View>
        <View style={st.statsRow}>
          <TouchableOpacity
            style={st.statCard}
            onPress={() => navigation.navigate('Patients', { aba: 'supervisionandos' })}
          >
            <Text style={st.statNumber}>{estatisticas.totalSupervisionandos}</Text>
            <Text style={st.statLabel}>Supervisionando{estatisticas.totalSupervisionandos === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.statCard} onPress={() => navigation.navigate('SessoesStatus')}>
            <Text style={st.statNumber}>{estatisticas.sessoesSemRelato}</Text>
            <Text style={st.statLabel}>Sessões sem relatos</Text>
          </TouchableOpacity>
        </View>
        <View style={st.statsRow}>
          <TouchableOpacity style={st.statCard} onPress={() => navigation.navigate('Cobranca')}>
            <Text style={st.statNumber}>{estatisticas.pagamentosEmAberto}</Text>
            <Text style={st.statLabel}>Pagamentos em aberto</Text>
          </TouchableOpacity>
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

            <Text style={st.label}>Cidade e estado *</Text>
            <TouchableOpacity style={st.input} onPress={() => setSeletorCidadeAberto(true)}>
              <Text style={cidade ? st.inputSelecionadoTexto : st.inputPlaceholderTexto}>
                {cidade ? `${cidade} - ${uf}` : 'Toque para selecionar'}
              </Text>
            </TouchableOpacity>
            <SeletorCidadeEstado
              visible={seletorCidadeAberto}
              onClose={() => setSeletorCidadeAberto(false)}
              onConfirmar={({ cidade: c, uf: u }) => {
                setCidade(c);
                setUf(u);
                setSeletorCidadeAberto(false);
              }}
            />

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
                onPress={abrirRecargaCreditos}
                disabled={abrindoCheckout}
              >
                {abrindoCheckout ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={st.assinaturaBtnTexto}>Adicionar créditos</Text>
                )}
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

            <Text style={st.sectionTitle}>🎓 Cursos</Text>
            <TouchableOpacity style={st.trocarSenhaBtn} onPress={() => navigation.navigate('Cursos')}>
              <Text style={st.trocarSenhaBtnText}>Meu currículo de cursos</Text>
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

            <TouchableOpacity style={st.trocarSenhaBtn} onPress={() => setModalSenhaVisivel(true)}>
              <Text style={st.trocarSenhaBtnText}>Alterar senha</Text>
            </TouchableOpacity>

            <Text style={st.sectionTitle}>🔔 Notificações</Text>
            <View style={st.notifMatrizCard}>
              <View style={st.notifMatrizHeader}>
                <Text style={st.notifMatrizHeaderTipo} />
                <Text style={st.notifMatrizHeaderCanal}>App</Text>
                <Text style={st.notifMatrizHeaderCanal}>E-mail</Text>
              </View>

              <View style={st.notifMatrizLinha}>
                <View style={st.notifMatrizTipo}>
                  <Text style={st.bioLabel}>Transcrição pronta</Text>
                  <Text style={st.bioSub}>Quando a transcrição de uma sessão terminar (ou falhar).</Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_transcricao_push' ? (
                    <ActivityIndicator color="#3D5A80" />
                  ) : (
                    <Switch
                      value={notifTranscricaoPush}
                      onValueChange={(v) => alternarNotif('notif_transcricao_push', v, setNotifTranscricaoPush)}
                    />
                  )}
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_transcricao_email' ? (
                    <ActivityIndicator color="#3D5A80" />
                  ) : (
                    <Switch
                      value={notifTranscricaoEmail}
                      onValueChange={(v) => alternarNotif('notif_transcricao_email', v, setNotifTranscricaoEmail)}
                    />
                  )}
                </View>
              </View>

              <View style={[st.notifMatrizLinha, st.notifMatrizLinhaUltima]}>
                <View style={st.notifMatrizTipo}>
                  <Text style={st.bioLabel}>Recebimento em atraso</Text>
                  <Text style={st.bioSub}>Quando um pagamento mensal passar do vencimento.</Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_atraso_push' ? (
                    <ActivityIndicator color="#3D5A80" />
                  ) : (
                    <Switch
                      value={notifAtrasoPush}
                      onValueChange={(v) => alternarNotif('notif_atraso_push', v, setNotifAtrasoPush)}
                    />
                  )}
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_atraso_email' ? (
                    <ActivityIndicator color="#3D5A80" />
                  ) : (
                    <Switch
                      value={notifAtrasoEmail}
                      onValueChange={(v) => alternarNotif('notif_atraso_email', v, setNotifAtrasoEmail)}
                    />
                  )}
                </View>
              </View>
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

      <Modal visible={modalSenhaVisivel} transparent animationType="fade" onRequestClose={fecharModalSenha}>
        <View style={st.modalOverlay}>
          <View style={st.modalCard}>
            <Text style={st.modalTitulo}>Alterar senha</Text>

            <Text style={st.modalLabel}>Senha atual</Text>
            <TextInput
              style={st.modalInput}
              value={senhaAtual}
              onChangeText={setSenhaAtual}
              placeholder="Sua senha atual"
              placeholderTextColor="#B0ADA6"
              secureTextEntry
            />

            <Text style={st.modalLabel}>Nova senha</Text>
            <TextInput
              style={st.modalInput}
              value={novaSenha}
              onChangeText={setNovaSenha}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor="#B0ADA6"
              secureTextEntry
            />

            <Text style={st.modalLabel}>Confirmar nova senha</Text>
            <TextInput
              style={st.modalInput}
              value={confirmarNovaSenha}
              onChangeText={setConfirmarNovaSenha}
              placeholder="Repita a nova senha"
              placeholderTextColor="#B0ADA6"
              secureTextEntry
            />

            <View style={st.modalBtnRow}>
              <TouchableOpacity style={st.modalBtnCancelar} onPress={fecharModalSenha} disabled={trocandoSenha}>
                <Text style={st.modalBtnCancelarText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.modalBtnConfirmar, trocandoSenha && { opacity: 0.7 }]}
                onPress={confirmarTrocaSenha}
                disabled={trocandoSenha}
              >
                {trocandoSenha ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={st.modalBtnConfirmarText}>Salvar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  trocarSenhaBtn: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#E8E4DD',
  },
  trocarSenhaBtnText: { fontSize: 15, fontWeight: '700', color: '#3D5A80' },
  notifMatrizCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, marginBottom: 20,
    borderWidth: 1, borderColor: '#E8E4DD', overflow: 'hidden',
  },
  notifMatrizHeader: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingHorizontal: 16,
  },
  notifMatrizHeaderTipo: { flex: 1 },
  notifMatrizHeaderCanal: {
    width: 64, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#A5A19A',
  },
  notifMatrizLinha: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F0EEE9',
  },
  notifMatrizLinhaUltima: { borderBottomWidth: 0 },
  notifMatrizTipo: { flex: 1, paddingRight: 8 },
  notifMatrizCanalCol: { width: 64, alignItems: 'center' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF',
    borderRadius: 18, padding: 24,
  },
  modalTitulo: { fontSize: 18, fontWeight: '700', color: '#1C1C1E', marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#1C1C1E', marginBottom: 6, marginTop: 12 },
  modalInput: {
    backgroundColor: '#F7F6F3', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1C1C1E', borderWidth: 1, borderColor: '#E8E4DD',
  },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalBtnCancelar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#F0EEE9',
  },
  modalBtnCancelarText: { fontSize: 15, fontWeight: '700', color: '#6B6860' },
  modalBtnConfirmar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#3D5A80',
  },
  modalBtnConfirmarText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  safe: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollInner: { padding: 20, paddingBottom: 50 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  erroTitulo: { fontSize: 17, fontWeight: '700', color: '#1C1C1E', textAlign: 'center' },
  erroTexto: { fontSize: 14, color: '#6B6860', textAlign: 'center', lineHeight: 20 },

  // Header — moldura em 3 linhas (grossa + fina + fina) ao redor de todo o
  // cabeçalho (foto de fundo) e, dentro dele, ao redor do avatar também,
  // pra criar contraste/limite nítido entre as duas imagens (item 9).
  headerMolduraGrossa: {
    borderRadius: 24,
    borderWidth: 3.5, borderColor: '#3D5A80',
    padding: 3,
    marginBottom: 24,
    shadowColor: '#1A2D45',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  headerMolduraFina: {
    borderRadius: 21,
    borderWidth: 1, borderColor: '#3D5A80',
    padding: 2,
  },
  headerCard: {
    borderRadius: 19,
    overflow: 'hidden',
    minHeight: 200,
  },
  headerCapaImg: { ...StyleSheet.absoluteFillObject },
  headerCapaVazia: { ...StyleSheet.absoluteFillObject, backgroundColor: '#3D5A80' },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,45,69,0.38)',
  },
  headerCapaLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerCapaHint: {
    position: 'absolute', top: 10, right: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
  },
  headerCapaHintText: { fontSize: 10, color: '#FFFFFF', fontWeight: '600' },
  headerConteudo: {
    padding: 28,
    alignItems: 'center',
  },
  avatarMolduraGrossa: {
    borderRadius: 42,
    borderWidth: 3, borderColor: '#FFFFFF',
    padding: 2,
    marginBottom: 6,
  },
  avatarMolduraFina: {
    borderRadius: 39,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
    padding: 1,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
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
    fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 8,
  },
  nomeHeader: {
    fontSize: 22, fontWeight: '700', color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  crpHeader: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4 },

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
  inputSelecionadoTexto: { fontSize: 15, color: '#1C1C1E' },
  inputPlaceholderTexto: { fontSize: 15, color: '#B0ADA6' },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnCancel: { backgroundColor: '#F0F0F0' },
  btnCancelText: { fontSize: 15, fontWeight: '600', color: '#6B6860' },
  btnSave: { backgroundColor: '#3D5A80' },
  btnSaveText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
