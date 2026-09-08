import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, Image, Switch, Modal, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  getPlanoFinanceiro, getRecebimentosDoMes, getPrecoMedioSessao,
  getContagemAnalisantesESupervisionandos, getContagemSessoesSemRelato, getResumoHorariosSemanais,
  filtrarRecebimentosMensais, calcularStatusGeralRecebimentos,
} from '../services/database';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validarCPF, dataBRParaISO, dataISOParaBR } from '../services/validacao';
import TelefoneInput from '../components/TelefoneInput';
import { mensagemDeErro } from '../services/erros';
import { getStatusAssinatura, reenviarInstrucoesDePlano } from '../services/assinatura';
import Constants from 'expo-constants';
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

/**
 * O estado da assinatura, dito em português.
 *
 * Deliberadamente sem preço, sem link de pagamento e sem instrução de
 * compra: a política do Google Play proíbe isso nas telas do app. Dizer em
 * que situação a conta está NÃO é instrução de pagamento — é informação de
 * conta, e é justamente o que faltava. O caminho para pagar continua sendo
 * o e-mail, e o botão aqui só faz esse e-mail chegar de novo.
 */
function CartaoDoPlano({ assinatura, reenviando, onPedirInstrucoes }) {
  if (!assinatura) {
    return (
      <View style={st.planoBox}>
        <ActivityIndicator color="#497363" />
      </View>
    );
  }

  const { situacao, planoLabel, expiraEm, diasRestantes, cortesia, email } = assinatura;

  const ATIVO = { fundo: '#E2EFE8', borda: '#CBE0D3', tinta: '#44745B' };
  const AVISO = { fundo: '#F2E9DC', borda: '#E3D5BC', tinta: '#7D6540' };
  const PARADO = { fundo: '#F1E4E3', borda: '#E3C9C7', tinta: '#975451' };
  const NEUTRO = { fundo: '#F1EDE5', borda: '#EAE5DC', tinta: '#756E66' };

  const emDias = (n) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);

  const mapa = {
    ativa: {
      cor: ATIVO,
      titulo: cortesia ? 'Acesso liberado' : `Plano ${planoLabel || 'ativo'}`,
      texto: expiraEm
        ? `Tudo liberado. Renova ${emDias(diasRestantes)}, em ${dataISOParaBR(expiraEm.slice(0, 10))}.`
        : 'Tudo liberado.',
    },
    vencendo: {
      cor: AVISO,
      titulo: `Seu plano vence ${emDias(diasRestantes)}`,
      texto: 'Depois disso o app deixa de permitir novos registros, sessões e cadastros. O que já está salvo continua seu, e a exportação dos dados continua liberada.',
    },
    inadimplente: {
      cor: AVISO,
      titulo: 'Pagamento não confirmado',
      texto: 'Ainda não recebemos a confirmação da última cobrança. O acesso segue por alguns dias enquanto isso se resolve.',
    },
    cancelada: {
      cor: AVISO,
      titulo: 'Plano cancelado',
      texto: expiraEm
        ? `Sem renovação automática. O acesso vale até ${dataISOParaBR(expiraEm.slice(0, 10))}.`
        : 'Sem renovação automática.',
    },
    expirada: {
      cor: PARADO,
      titulo: 'Seu plano venceu',
      texto: 'Criar sessões, registros e cadastros está bloqueado. Nada foi apagado: tudo que você já registrou continua aqui, e você pode exportar seus dados quando quiser.',
    },
    nenhuma: {
      cor: PARADO,
      titulo: 'Nenhum plano ativo',
      texto: 'Você pode navegar e ver o que já existe, mas criar sessões, registros e cadastros está bloqueado até escolher um plano.',
    },
    indefinida: {
      cor: NEUTRO,
      titulo: 'Não deu para conferir agora',
      texto: 'Sem conexão com o servidor. Isso não afeta seu acesso — é só esta consulta.',
    },
  };

  const info = mapa[situacao] || mapa.indefinida;
  const precisaDoLink = situacao === 'nenhuma' || situacao === 'expirada' || situacao === 'vencendo';

  return (
    <View style={[st.planoBox, { backgroundColor: info.cor.fundo, borderColor: info.cor.borda }]}>
      <Text style={[st.planoTitulo, { color: info.cor.tinta }]}>{info.titulo}</Text>
      <Text style={st.planoTexto}>{info.texto}</Text>

      {precisaDoLink && (
        <>
          <TouchableOpacity
            style={[st.planoBtn, reenviando && { opacity: 0.7 }]}
            onPress={onPedirInstrucoes}
            disabled={reenviando}
          >
            {reenviando
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={st.planoBtnTexto}>Receber o link por e-mail</Text>}
          </TouchableOpacity>
          {!!email && (
            <Text style={st.planoRodape}>Vai para {email}.</Text>
          )}
        </>
      )}
    </View>
  );
}

export default function PerfilScreen({ navigation }) {
  const { session, sairLocalmente } = useAuth();
  const [user, setUser] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [plano, setPlano] = useState(null);
  // Situação da assinatura — o app nunca mostrou isso em lugar nenhum.
  const [assinatura, setAssinatura] = useState(null);
  const [reenviando, setReenviando] = useState(false);
  const [estatisticas, setEstatisticas] = useState({
    precoMedio: 0, totalAnalisantes: 0, totalSupervisionandos: 0, sessoesSemRelato: 0,
    pagamentosRecebidos: 0, pagamentosTotal: 0, pagamentosStatusCor: 'verde',
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
  const [notifSessaoEmail, setNotifSessaoEmail] = useState(false);
  const [notifRegistroPush, setNotifRegistroPush] = useState(true);
  const [notifRegistroEmail, setNotifRegistroEmail] = useState(true);
  const [notifSalvando, setNotifSalvando] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [excluindoConta, setExcluindoConta] = useState(false);
  const [abrindoCheckout, setAbrindoCheckout] = useState(false);
  const [modalSenhaVisivel, setModalSenhaVisivel] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  // Guarda o que veio do banco: é o que decide se o campo de CPF aparece.
  const [cpfSalvo, setCpfSalvo] = useState('');
  // Contas criadas antes de o CPF ser obrigatório ficaram sem ele; essas
  // podem preenchê-lo uma vez. Preenchido, o campo some pra sempre.
  const cpfEditavel = !cpfSalvo.replace(/\D/g, '');
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
      setCpfSalvo(u.cpf || '');
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
      setNotifSessaoEmail(u.notif_sessao_email === true);
      setNotifRegistroPush(u.notif_registro_push !== false);
      setNotifRegistroEmail(u.notif_registro_email !== false);

      // Checagem silenciosa de renovação mensal de créditos — se houver
      // renovação pendente, já reflete o saldo/data novos sem recarregar tudo.
      getStatusAssinatura().then(setAssinatura).catch(() => {});

      chamarRenovarCreditos()
        .then((resultado) => {
          if (resultado?.renovado) {
            setUser((atual) => (atual ? {
              ...atual,
              creditos_ia: resultado.saldoAtual,
              proxima_renovacao_credito: resultado.proximaRenovacao,
            } : atual));
          }
        })
        // Checagem silenciosa: falhar aqui não pode virar rejeição não
        // tratada nem atrapalhar o resto do Perfil, que já carregou.
        .catch(() => {});
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
      // Cobrança "por sessão" não entra nessa contagem (item 9) — não tem
      // dia de vencimento fixo pra comparar com "em aberto"/"em atraso".
      ...(() => {
        if (recebimentos.status !== 'fulfilled') return {};
        const mensais = filtrarRecebimentosMensais(recebimentos.value);
        return {
          pagamentosRecebidos: mensais.filter((r) => r.recebido).length,
          pagamentosTotal: mensais.length,
          pagamentosStatusCor: calcularStatusGeralRecebimentos(mensais),
        };
      })(),
      horariosOcupados: horarios.status === 'fulfilled' ? horarios.value.ocupados : atual.horariosOcupados,
      horariosTotal: horarios.status === 'fulfilled' ? horarios.value.total : atual.horariosTotal,
    }));
    setCarregando(false);
  }, [session.user.id]);

  // Item 1 (leva pós-v13): era useEffect simples (só no mount) — voltar
  // pra essa tela depois de confirmar um pagamento, mudar créditos etc.
  // nunca atualizava os números até fechar e reabrir o app inteiro.
  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  async function pedirInstrucoesDePlano() {
    setReenviando(true);
    try {
      const r = await reenviarInstrucoesDePlano();
      Alert.alert(
        'E-mail enviado',
        `Mandamos o link para escolher seu plano em ${r?.email || 'seu e-mail'}.`
        + '\n\nEle vale por 1 hora. Confira também a caixa de spam.'
      );
    } catch (e) {
      Alert.alert('Não foi possível enviar', mensagemDeErro(e));
    } finally {
      setReenviando(false);
    }
  }

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

  // useFocusEffect (e não useEffect de montagem): a biometria pode ser
  // desativada fora desta tela — o login por digital se desativa sozinho se
  // o token guardado não servir mais. Relendo a cada foco, o botão sempre
  // mostra o estado real, em vez de um valor congelado da primeira abertura.
  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      (async () => {
        const suportada = await biometriaDisponivelNoAparelho();
        const ligada = await loginBiometricoEstaAtivo();
        if (!ativo) return;
        setBioSuportada(suportada);
        setBioAtiva(ligada);
      })();
      return () => { ativo = false; };
    }, [])
  );

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

  async function salvar() {
    // Nome e CPF não aparecem mais como campo editável — o banco recusa a
    // alteração (trigger `profiles_nome_cpf_imutaveis`, migration 0076), e
    // é isso que impede driblar o bloqueio de autocadastro de analisante
    // trocando o próprio nome depois. Contas antigas que ficaram sem CPF
    // ainda podem preenchê-lo UMA vez, e é o único caso em que o campo
    // aparece — por isso a validação abaixo é condicional.
    if (cpfEditavel && !validarCPF(cpf)) {
      Alert.alert('CPF inválido', 'Confira o CPF digitado.');
      return;
    }
    // Nascimento e cidade/UF são opcionais: nenhum fluxo do app depende
    // deles. Só valida o que foi preenchido.
    const dataNascimentoISO = dataNascimento.trim() ? dataBRParaISO(dataNascimento) : null;
    if (dataNascimento.trim() && !dataNascimentoISO) {
      Alert.alert('Data inválida', 'Confira a data de nascimento (DD/MM/AAAA), ou deixe em branco.');
      return;
    }
    const telefoneTrim = telefone.trim();
    if (!telefoneTrim) {
      Alert.alert('Campo obrigatório', 'Informe seu telefone.');
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
        // `nome` fora do update de propósito: mandá-lo, mesmo igual, faria
        // o trigger comparar e recusar por engano numa diferença de espaço.
        ...(cpfEditavel ? { cpf: cpf.trim() } : {}),
        data_nascimento: dataNascimentoISO,
        cidade: cidade.trim() || null,
        uf: uf.trim() || null,
        crp: crp.trim(),
        telefone: telefoneTrim,
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
            // Ação irreversível e sem trava nenhuma antes — um segundo
            // toque durante a exclusão (que apaga em cascata todos os
            // dados) podia disparar excluirConta() duas vezes em paralelo.
            setExcluindoConta(true);
            try {
              await excluirConta();
              await desativarLoginBiometrico();
              await supabase.auth.signOut();
            } catch (e) {
              Alert.alert('Erro ao excluir conta', mensagemDeErro(e));
            } finally {
              setExcluindoConta(false);
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
          <ActivityIndicator size="large" color="#497363" />
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
      <CabecalhoTela titulo="Meu Perfil" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.scrollInner} keyboardShouldPersistTaps="handled">
        {/* ── Cabeçalho ── */}
        <View style={st.headerMolduraExterna}>
          <View style={st.headerMolduraCentral}>
            <View style={st.headerMolduraInterna}>
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
                <Text style={st.headerCapaHintText}>Toque pra trocar o fundo</Text>
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
        </View>

        {/* ── Sua atividade ── */}
        <Text style={st.sectionTitle}>Sua atividade</Text>
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
          <TouchableOpacity
            style={[
              st.statCard,
              estatisticas.pagamentosStatusCor === 'vermelho' && st.statCardAlerta,
              estatisticas.pagamentosStatusCor === 'amarelo' && st.statCardAtencao,
              estatisticas.pagamentosStatusCor === 'verde' && st.statCardOk,
            ]}
            onPress={() => navigation.navigate('Cobranca')}
          >
            <Text
              style={[
                st.statNumber,
                estatisticas.pagamentosStatusCor === 'vermelho' && st.statNumberAlerta,
                estatisticas.pagamentosStatusCor === 'amarelo' && st.statNumberAtencao,
                estatisticas.pagamentosStatusCor === 'verde' && st.statNumberOk,
              ]}
            >
              {estatisticas.pagamentosRecebidos}/{estatisticas.pagamentosTotal}
            </Text>
            <Text style={st.statLabel}>Pagamentos recebidos</Text>
          </TouchableOpacity>
        </View>

        {/* ── Dados cadastrais ── */}
        <View style={st.sectionTitleRow}>
          <Text style={st.sectionTitle}>Dados cadastrais</Text>
          {!editando && (
            <TouchableOpacity style={st.editBtn} onPress={() => setEditando(true)}>
              <Text style={st.editBtnText}>Editar</Text>
            </TouchableOpacity>
          )}
        </View>

        {editando ? (
          <>
            <Text style={st.label}>Nome completo</Text>
            <View style={st.inputTravado}>
              <Text style={st.inputTravadoTexto}>{nome || '—'}</Text>
              <Ionicons name="lock-closed-outline" size={15} color="#8C857B" />
            </View>

            {cpfEditavel ? (
              <>
                <Text style={st.label}>CPF *</Text>
                <TextInput
                  style={st.input}
                  value={cpf}
                  onChangeText={formatarCpf}
                  keyboardType="numeric"
                  placeholder="000.000.000-00"
                  maxLength={14}
                />
              </>
            ) : (
              <>
                <Text style={st.label}>CPF</Text>
                <View style={st.inputTravado}>
                  <Text style={st.inputTravadoTexto}>{cpf || '—'}</Text>
                  <Ionicons name="lock-closed-outline" size={15} color="#8C857B" />
                </View>
              </>
            )}
            <Text style={st.ajudaCampo}>
              Nome e CPF identificam o titular da conta e não mudam depois de
              gravados. É o que garante que ninguém apareça como o próprio
              analisante. Se algum estiver errado, fale com o suporte.
            </Text>

            <Text style={st.label}>Data de nascimento</Text>
            <TextInput
              style={st.input}
              value={dataNascimento}
              onChangeText={(t) => formatarData(t, setDataNascimento)}
              keyboardType="numeric"
              placeholder="00/00/0000"
              maxLength={10}
            />

            <Text style={st.label}>Cidade e estado</Text>
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

            <Text style={st.label}>Telefone *</Text>
            <TelefoneInput value={telefone} onChangeText={setTelefone} />

            <Text style={st.label}>Chave Pix</Text>
            <TextInput
              style={st.input}
              value={pixKey}
              onChangeText={setPixKey}
              autoCapitalize="none"
              placeholder="CPF, e-mail, telefone ou chave aleatória"
            />

            {/* ── Contador (para envio do resumo mensal de recebimentos) ── */}
            <Text style={st.sectionTitle}>Contador</Text>

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
            <TelefoneInput value={contadorTelefone} onChangeText={setContadorTelefone} />

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
              <Text style={st.mensagensLinkText}>Mensagens personalizadas</Text>
            </TouchableOpacity>

            {/* "Assinatura" nesta tela significava duas coisas diferentes:
                a rubrica desenhada e o plano pago. Cada uma tem nome
                próprio agora. */}
            <Text style={st.sectionTitle}>Sua rubrica</Text>
            <Text style={st.sectionAjuda}>
              Usada nos recibos e documentos que o app gera.
            </Text>
            <View style={st.assinaturaBox}>
              {user.assinatura ? (
                <Image source={{ uri: user.assinatura }} style={st.assinaturaImg} resizeMode="contain" />
              ) : (
                <Text style={st.assinaturaVazia}>Nenhuma rubrica salva</Text>
              )}
              <TouchableOpacity
                style={st.assinaturaBtn}
                onPress={() => navigation.navigate('Assinatura')}
              >
                <Text style={st.assinaturaBtnTexto}>
                  {user.assinatura ? 'Editar rubrica' : 'Desenhar rubrica'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* O PLANO vem antes dos créditos de propósito: é ele que
                libera o app. Até aqui não aparecia em lugar nenhum — quem
                estava sem plano só descobria ao ser barrado, e quem estava
                prestes a vencer não descobria nunca. */}
            <Text style={st.sectionTitle}>Seu plano</Text>
            <CartaoDoPlano
              assinatura={assinatura}
              reenviando={reenviando}
              onPedirInstrucoes={pedirInstrucoesDePlano}
            />

            <Text style={st.sectionTitle}>Créditos de IA</Text>
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
                <Text style={st.infoLabel}>Plano de créditos</Text>
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

            <Text style={st.sectionTitle}>Contador</Text>
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

            <Text style={st.sectionTitle}>Cursos</Text>
            <TouchableOpacity style={st.trocarSenhaBtn} onPress={() => navigation.navigate('Cursos')}>
              <Text style={st.trocarSenhaBtnText}>Meu currículo de cursos</Text>
            </TouchableOpacity>

            <Text style={st.sectionTitle}>Apps conectados</Text>
            <Text style={st.bioSub}>
              WhatsApp Business, Google Meet e Zoom — as ligações que algumas
              ferramentas do app usam. Todas opcionais.
            </Text>
            <TouchableOpacity
              style={st.trocarSenhaBtn}
              onPress={() => navigation.navigate('AppsConectados')}
            >
              <Text style={st.trocarSenhaBtnText}>Gerenciar apps conectados</Text>
            </TouchableOpacity>

            <Text style={st.sectionTitle}>Proteção da gravação</Text>
            <Text style={st.bioSub}>
              O que o Android precisa liberar pra gravação de uma sessão não
              ser interrompida quando você sai do app.
            </Text>
            <TouchableOpacity
              style={st.trocarSenhaBtn}
              onPress={() => navigation.navigate('ProtecaoGravacao')}
            >
              <Text style={st.trocarSenhaBtnText}>Conferir proteção</Text>
            </TouchableOpacity>

            <Text style={st.sectionTitle}>Segurança</Text>
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
                <ActivityIndicator color="#497363" />
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

            <Text style={st.sectionTitle}>Notificações</Text>
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
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifTranscricaoPush}
                      onValueChange={(v) => alternarNotif('notif_transcricao_push', v, setNotifTranscricaoPush)}
                    />
                  )}
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_transcricao_email' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifTranscricaoEmail}
                      onValueChange={(v) => alternarNotif('notif_transcricao_email', v, setNotifTranscricaoEmail)}
                    />
                  )}
                </View>
              </View>

              <View style={st.notifMatrizLinha}>
                <View style={st.notifMatrizTipo}>
                  <Text style={st.bioLabel}>Recebimento em atraso</Text>
                  <Text style={st.bioSub}>Quando um pagamento mensal passar do vencimento.</Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_atraso_push' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifAtrasoPush}
                      onValueChange={(v) => alternarNotif('notif_atraso_push', v, setNotifAtrasoPush)}
                    />
                  )}
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_atraso_email' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifAtrasoEmail}
                      onValueChange={(v) => alternarNotif('notif_atraso_email', v, setNotifAtrasoEmail)}
                    />
                  )}
                </View>
              </View>

              <View style={st.notifMatrizLinha}>
                <View style={st.notifMatrizTipo}>
                  <Text style={st.bioLabel}>Sessão feita / paga</Text>
                  <Text style={st.bioSub}>
                    Pergunta, ao abrir o app, se as sessões que já passaram
                    aconteceram — e se foram pagas, na cobrança por sessão.
                  </Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {/* Sem interruptor de propósito: este é o único ponto do app
                      onde um compromisso passado deixa de ser "agendado".
                      Desligar pararia cobrança, financeiro, fiscal e a
                      contagem de sessões sem relato. */}
                  <Switch
                    value
                    disabled
                    onValueChange={() => {}}
                  />
                  <Text style={st.notifFixo}>sempre</Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_sessao_email' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifSessaoEmail}
                      onValueChange={(v) => alternarNotif('notif_sessao_email', v, setNotifSessaoEmail)}
                    />
                  )}
                </View>
              </View>

              <View style={[st.notifMatrizLinha, st.notifMatrizLinhaUltima]}>
                <View style={st.notifMatrizTipo}>
                  <Text style={st.bioLabel}>Incluir registro</Text>
                  <Text style={st.bioSub}>
                    Oferece adicionar o relato logo depois de confirmar a
                    sessão. Desligado, o app só deixa de perguntar — as
                    sessões sem relato continuam sendo contadas na Início.
                  </Text>
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_registro_push' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifRegistroPush}
                      onValueChange={(v) => alternarNotif('notif_registro_push', v, setNotifRegistroPush)}
                    />
                  )}
                </View>
                <View style={st.notifMatrizCanalCol}>
                  {notifSalvando === 'notif_registro_email' ? (
                    <ActivityIndicator color="#497363" />
                  ) : (
                    <Switch
                      value={notifRegistroEmail}
                      onValueChange={(v) => alternarNotif('notif_registro_email', v, setNotifRegistroEmail)}
                    />
                  )}
                </View>
              </View>
            </View>

            <TouchableOpacity style={st.exportarBtn} onPress={exportarDados} disabled={exportando}>
              {exportando ? (
                <ActivityIndicator color="#497363" />
              ) : (
                <Text style={st.exportarBtnText}>Exportar meus dados</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={st.sairBtn} onPress={sair}>
              <Text style={st.sairBtnText}>Sair da conta</Text>
            </TouchableOpacity>

            <TouchableOpacity style={st.excluirContaBtn} onPress={excluirContaHandler} disabled={excluindoConta}>
              {excluindoConta ? (
                <ActivityIndicator color="#8C857B" />
              ) : (
                <Text style={st.excluirContaBtnText}>Excluir minha conta</Text>
              )}
            </TouchableOpacity>

            {/* A versão, no rodapé, onde todo app a coloca. Não é enfeite:
                é a primeira pergunta de qualquer suporte, e desde que o app
                recebe correções por atualização automática, a versão da loja
                deixou de contar a história inteira — daí o número do pacote
                junto. */}
            <Text style={st.versaoTexto}>
              Dr.Sig {Constants.expoConfig?.version || ''}
              {Constants.expoConfig?.android?.versionCode
                ? ` (${Constants.expoConfig.android.versionCode})`
                : ''}
            </Text>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={modalSenhaVisivel} transparent animationType="fade" onRequestClose={fecharModalSenha}>
        <KeyboardAvoidingView
          style={st.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={st.modalCard}>
            <Text style={st.modalTitulo}>Alterar senha</Text>

            <Text style={st.modalLabel}>Senha atual</Text>
            <TextInput
              style={st.modalInput}
              value={senhaAtual}
              onChangeText={setSenhaAtual}
              placeholder="Sua senha atual"
              placeholderTextColor="#756E66"
              secureTextEntry
            />

            <Text style={st.modalLabel}>Nova senha</Text>
            <TextInput
              style={st.modalInput}
              value={novaSenha}
              onChangeText={setNovaSenha}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor="#756E66"
              secureTextEntry
            />

            <Text style={st.modalLabel}>Confirmar nova senha</Text>
            <TextInput
              style={st.modalInput}
              value={confirmarNovaSenha}
              onChangeText={setConfirmarNovaSenha}
              placeholder="Repita a nova senha"
              placeholderTextColor="#756E66"
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 16, marginBottom: 20,
  },
  bioLabel: { fontSize: 15, fontWeight: '500', color: '#302C28', lineHeight: 22 },
  bioSub: { fontSize: 12, color: '#756E66', marginTop: 4, lineHeight: 17 },
  trocarSenhaBtn: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  trocarSenhaBtnText: { fontSize: 15, fontWeight: '500', color: '#497363', lineHeight: 22 },
  notifMatrizCard: {
    backgroundColor: '#FDFCFA', borderRadius: 14, marginBottom: 20,
    borderWidth: 1, borderColor: '#EAE5DC', overflow: 'hidden',
  },
  notifMatrizHeader: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingHorizontal: 16,
  },
  notifMatrizHeaderTipo: { flex: 1 },
  notifMatrizHeaderCanal: {
    width: 64, textAlign: 'center', fontSize: 11, fontWeight: '500', color: '#8C857B',
  },
  notifMatrizLinha: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F1EDE5',
  },
  notifMatrizLinhaUltima: { borderBottomWidth: 0 },
  notifMatrizTipo: { flex: 1, paddingRight: 8 },
  notifMatrizCanalCol: { width: 64, alignItems: 'center' },
  notifFixo: { fontSize: 10.5, color: '#8C857B', marginTop: 3, lineHeight: 14 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: '#FDFCFA',
    borderRadius: 18, padding: 24,
  },
  modalTitulo: { fontSize: 18, fontWeight: '500', color: '#302C28', marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#302C28', marginBottom: 6, marginTop: 12, lineHeight: 19 },
  modalInput: {
    backgroundColor: '#F7F5F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#302C28', borderWidth: 1, borderColor: '#EAE5DC',
  },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalBtnCancelar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#F1EDE5',
  },
  modalBtnCancelarText: { fontSize: 15, fontWeight: '500', color: '#756E66', lineHeight: 22 },
  modalBtnConfirmar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#497363',
  },
  modalBtnConfirmarText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF', lineHeight: 22 },
  safe: { flex: 1, backgroundColor: '#F7F5F0' },
  scrollInner: { padding: 20, paddingBottom: 50 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  erroTitulo: { fontSize: 17, fontWeight: '500', color: '#302C28', textAlign: 'center' },
  erroTexto: { fontSize: 14, color: '#756E66', textAlign: 'center', lineHeight: 20 },

  // Header — moldura em 3 linhas (grossa + fina + fina) ao redor de todo o
  // cabeçalho (foto de fundo) e, dentro dele, ao redor do avatar também,
  // pra criar contraste/limite nítido entre as duas imagens (item 9).
  // Moldura tripla: fina · grossa (3 dp ≈ 0,5 mm) · fina — a mesma dos
  // botões da Início e das barrinhas de horário.
  headerMolduraExterna: {
    borderRadius: 23,
    borderWidth: 1, borderColor: '#A8CBBA',
    padding: 2,
    marginBottom: 24,
    backgroundColor: '#FDFCFA',
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  headerMolduraCentral: {
    borderRadius: 20,
    borderWidth: 3, borderColor: '#497363',
    padding: 2,
  },
  headerMolduraInterna: {
    borderRadius: 15,
    borderWidth: 1, borderColor: '#A8CBBA',
    overflow: 'hidden',
  },
  headerCard: {
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 200,
  },
  headerCapaImg: { ...StyleSheet.absoluteFillObject },
  headerCapaVazia: { ...StyleSheet.absoluteFillObject, backgroundColor: '#6B9E8A' },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(48,44,40,0.30)',
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
  // Avatar: anel de papel por fora, filete verde por dentro — o mesmo par
  // do cabeçalho, em escala menor.
  avatarMolduraGrossa: {
    borderRadius: 44,
    borderWidth: 1, borderColor: '#FDFCFA',
    backgroundColor: '#FDFCFA',
    padding: 4,
    marginBottom: 6,
    shadowColor: '#4E4941',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  avatarMolduraFina: {
    borderRadius: 39,
    borderWidth: 1, borderColor: '#A8CBBA',
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
    fontSize: 24, fontWeight: '500', color: '#FFFFFF',
  },
  avatarHint: {
    fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 8,
  },
  nomeHeader: {
    fontSize: 22, fontWeight: '500', color: '#FFFFFF',
  },
  crpHeader: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4, lineHeight: 19 },

  // Seção
  sectionTitle: {
    fontSize: 17, fontWeight: '500', color: '#302C28',
    marginBottom: 14, marginTop: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },

  // Stats
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: '#FDFCFA', borderRadius: 14,
    padding: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  statCardAlerta: { backgroundColor: '#F1E4E3', borderColor: '#E3C9C7' },
  statCardAtencao: { backgroundColor: '#F2E9DC', borderColor: '#E3D5BC' },
  statCardOk: { backgroundColor: '#E2EFE8', borderColor: '#C3DFCF' },
  statNumber: { fontSize: 20, fontWeight: '500', color: '#497363' },
  statNumberAlerta: { color: '#975451' },
  statNumberAtencao: { color: '#7D6540' },
  statNumberOk: { color: '#44745B' },
  statLabel: { fontSize: 12, color: '#756E66', marginTop: 4, lineHeight: 17 },

  // Info rows
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  infoLabel: { fontSize: 14, color: '#756E66', lineHeight: 20 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#302C28', lineHeight: 20 },
  infoValueAlerta: { color: '#975451' },
  creditosAviso: {
    fontSize: 12, color: '#975451', lineHeight: 17, marginTop: -6, marginBottom: 12,
  },
  creditosDetalheBox: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#EAE5DC', marginBottom: 8, gap: 4,
  },

  // Assinatura
  sectionAjuda: { fontSize: 12.5, color: '#8C857B', lineHeight: 18, marginTop: -6, marginBottom: 10 },
  planoBox: {
    borderRadius: 12, borderWidth: 1, padding: 15, marginBottom: 6,
    minHeight: 70, justifyContent: 'center',
  },
  planoTitulo: { fontSize: 15.5, fontWeight: '600', lineHeight: 22, marginBottom: 6 },
  planoTexto: { fontSize: 13.5, color: '#4E4941', lineHeight: 20 },
  planoBtn: {
    marginTop: 14, backgroundColor: '#497363', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  planoBtnTexto: { color: '#FFFFFF', fontWeight: '500', fontSize: 14.5, lineHeight: 21 },
  planoRodape: { fontSize: 12, color: '#756E66', lineHeight: 17, marginTop: 8, textAlign: 'center' },
  assinaturaBox: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#EAE5DC', alignItems: 'center', gap: 10,
    marginBottom: 8,
  },
  assinaturaImg: { width: '100%', height: 80 },
  assinaturaVazia: { fontSize: 13, color: '#8C857B', fontStyle: 'italic', lineHeight: 19 },
  assinaturaBtn: {
    borderWidth: 1, borderColor: '#497363', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  assinaturaBtnTexto: { color: '#497363', fontWeight: '500', fontSize: 13, lineHeight: 19 },

  // Edit
  editBtn: { paddingVertical: 4, paddingLeft: 12 },
  mensagensLink: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 16, marginBottom: 20,
  },
  mensagensLinkText: { fontSize: 15, fontWeight: '500', color: '#497363', lineHeight: 22 },
  editBtnText: { fontSize: 14, color: '#497363', fontWeight: '600', lineHeight: 20 },

  sairBtn: { alignItems: 'center', marginTop: 24 },
  sairBtnText: { fontSize: 14, color: '#975451', fontWeight: '600', lineHeight: 20 },

  exportarBtn: {
    backgroundColor: '#FDFCFA', borderRadius: 14, padding: 16,
    alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#EAE5DC',
  },
  exportarBtnText: { fontSize: 14, color: '#497363', fontWeight: '500', lineHeight: 20 },
  excluirContaBtn: { alignItems: 'center', marginTop: 16, paddingBottom: 8 },
  versaoTexto: { fontSize: 11.5, color: '#A9A299', textAlign: 'center', marginTop: 18, lineHeight: 16 },
  excluirContaBtnText: { fontSize: 12, color: '#8C857B', fontWeight: '600', textDecorationLine: 'underline', lineHeight: 17 },

  // Edit mode
  label: { fontSize: 13, fontWeight: '600', color: '#302C28', marginBottom: 6, marginTop: 14, lineHeight: 19 },
  input: {
    backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 12, fontSize: 15, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  inputTravado: {
    backgroundColor: '#F2EFE9', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 12, borderWidth: 1, borderColor: '#E3DED4',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  inputTravadoTexto: { flex: 1, fontSize: 15, color: '#756E66', lineHeight: 22 },
  ajudaCampo: { fontSize: 12.5, color: '#8C857B', lineHeight: 18, marginTop: 8 },
  inputSelecionadoTexto: { fontSize: 15, color: '#302C28', lineHeight: 22 },
  inputPlaceholderTexto: { fontSize: 15, color: '#756E66', lineHeight: 22 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnCancel: { backgroundColor: '#F1EDE5' },
  btnCancelText: { fontSize: 15, fontWeight: '600', color: '#756E66', lineHeight: 22 },
  btnSave: { backgroundColor: '#497363' },
  btnSaveText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF', lineHeight: 22 },
});
