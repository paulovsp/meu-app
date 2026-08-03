import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
  StatusBar, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { validarCPF, buscarEnderecoPorCep, dataBRParaISO } from '../services/validacao';

const COLORS = {
  bg: '#F7F6F3',
  accent: '#6B9E8A',
  accentMid: '#8FBFA8',
  btnBlue: '#3D5A80',
  btnLight: '#5B7FA6',
  textDark: '#1C1C1E',
  textMid: '#6B6860',
};

const HEADER_H = 220;

function HeaderWave() {
  return (
    <Svg width="100%" height={HEADER_H} style={StyleSheet.absoluteFill} viewBox="0 0 390 220">
      <Defs>
        <LinearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={COLORS.accent} stopOpacity="1" />
          <Stop offset="1" stopColor={COLORS.accentMid} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Path
        d="M0,220 L390,220 L390,120 C320,105 250,145 180,115 C110,85 50,130 0,110 Z"
        fill="url(#g1)"
      />
    </Svg>
  );
}

export default function CadastroScreen({ navigation }) {
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
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [criando, setCriando] = useState(false);

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

  function formatarData(texto) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length >= 3 && numeros.length <= 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    } else if (numeros.length > 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
    }
    setDataNascimento(formatado);
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

  async function handleCriarConta() {
    const nomeTrim = nome.trim();
    const emailTrim = email.trim();

    if (!nomeTrim) {
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
    if (!emailTrim) {
      Alert.alert('Campo obrigatório', 'Informe seu e-mail.');
      return;
    }
    if (senha.length < 6) {
      Alert.alert('Senha muito curta', 'A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (senha !== confirmarSenha) {
      Alert.alert('Senhas diferentes', 'A confirmação não bate com a senha digitada.');
      return;
    }

    setCriando(true);
    try {
      const cpfLimpo = cpf.trim();
      const { data: disponivel, error: erroCpf } = await supabase.rpc('cpf_disponivel', { p_cpf: cpfLimpo });
      if (!erroCpf && disponivel === false) {
        Alert.alert('CPF já cadastrado', 'Já existe uma conta com este CPF.');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: emailTrim,
        password: senha,
        options: {
          data: {
            nome: nomeTrim,
            crp: crp.trim() || null,
            cpf: cpfLimpo,
            data_nascimento: dataNascimentoISO,
            cep: cep.trim() || null,
            logradouro: logradouro.trim(),
            numero: numero.trim(),
            complemento: complemento.trim() || null,
            bairro: bairro.trim(),
            cidade: cidade.trim(),
            uf: uf.trim(),
          },
        },
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message) && /cpf/i.test(error.message)) {
          Alert.alert('CPF já cadastrado', 'Já existe uma conta com este CPF.');
        } else {
          Alert.alert('Não foi possível criar a conta', error.message);
        }
        return;
      }
      // Sem sessão de volta = confirmação de e-mail está ativa no projeto;
      // o AuthContext só troca de tela quando a sessão de fato existir.
      // Texto sem link/preço/instrução de pagamento (política do Google
      // Play) — o e-mail de confirmação (auth-send-email) já leva o link
      // pra escolher o plano, e o e-mail está fora do alcance dessa regra.
      if (!data.session) {
        Alert.alert(
          'Conta criada',
          'Enviamos um e-mail com os próximos passos.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      }
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível conectar. Tente novamente.');
    } finally {
      setCriando(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.accent} />

      <View style={s.headerWrap}>
        <HeaderWave />
        <View style={s.headerContent}>
          <Text style={s.appName}>Dr.Sig</Text>
          <Text style={s.appSub}>O seu Assistente Clínico</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollInner}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.title}>Criar conta</Text>
          <Text style={s.subtitle}>
            Configure seu perfil de usuário.{'\n'}
            Os dados opcionais você pode preencher depois.
          </Text>

          <Text style={s.label}>Nome completo *</Text>
          <TextInput
            style={s.input}
            value={nome}
            onChangeText={setNome}
            placeholder="Ex: Paulo Reboco"
            placeholderTextColor="#B0ADA6"
            autoFocus
          />

          <Text style={s.label}>CPF *</Text>
          <TextInput
            style={s.input}
            value={cpf}
            onChangeText={formatarCpf}
            keyboardType="numeric"
            placeholder="000.000.000-00"
            placeholderTextColor="#B0ADA6"
            maxLength={14}
          />

          <Text style={s.label}>Data de nascimento *</Text>
          <TextInput
            style={s.input}
            value={dataNascimento}
            onChangeText={formatarData}
            keyboardType="numeric"
            placeholder="00/00/0000"
            placeholderTextColor="#B0ADA6"
            maxLength={10}
          />

          <Text style={s.label}>CEP *</Text>
          <View style={s.cepRow}>
            <TextInput
              style={[s.input, { flex: 1 }, cepTravado && s.inputTravado]}
              value={cep}
              onChangeText={formatarCep}
              keyboardType="numeric"
              placeholder="00000-000"
              placeholderTextColor="#B0ADA6"
              maxLength={9}
              editable={!cepTravado}
            />
            {buscandoCep && <ActivityIndicator style={s.cepLoading} color={COLORS.btnBlue} />}
          </View>
          {cepTravado ? (
            <TouchableOpacity onPress={refazerCep}>
              <Text style={s.linkRefazer}>Endereço errado? Buscar outro CEP</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setCepTravado(false)}>
              <Text style={s.linkRefazer}>Não encontrou seu CEP? Preencher manualmente</Text>
            </TouchableOpacity>
          )}

          <Text style={s.label}>Logradouro *</Text>
          <TextInput
            style={[s.input, cepTravado && s.inputTravado]}
            value={logradouro}
            onChangeText={setLogradouro}
            placeholder="Rua, avenida..."
            placeholderTextColor="#B0ADA6"
            editable={!cepTravado}
          />

          <View style={s.linhaDupla}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Número *</Text>
              <TextInput
                style={s.input}
                value={numero}
                onChangeText={setNumero}
                keyboardType="numeric"
                placeholder="Ex: 123"
                placeholderTextColor="#B0ADA6"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Complemento</Text>
              <TextInput
                style={s.input}
                value={complemento}
                onChangeText={setComplemento}
                placeholder="Apto, bloco..."
                placeholderTextColor="#B0ADA6"
              />
            </View>
          </View>

          <Text style={s.label}>Bairro *</Text>
          <TextInput
            style={[s.input, cepTravado && s.inputTravado]}
            value={bairro}
            onChangeText={setBairro}
            placeholderTextColor="#B0ADA6"
            editable={!cepTravado}
          />

          <View style={s.linhaDupla}>
            <View style={{ flex: 2 }}>
              <Text style={s.label}>Cidade *</Text>
              <TextInput
                style={[s.input, cepTravado && s.inputTravado]}
                value={cidade}
                onChangeText={setCidade}
                placeholderTextColor="#B0ADA6"
                editable={!cepTravado}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>UF *</Text>
              <TextInput
                style={[s.input, cepTravado && s.inputTravado]}
                value={uf}
                onChangeText={(t) => setUf(t.toUpperCase().slice(0, 2))}
                placeholderTextColor="#B0ADA6"
                autoCapitalize="characters"
                maxLength={2}
                editable={!cepTravado}
              />
            </View>
          </View>

          <Text style={s.label}>CRP / Registro profissional</Text>
          <TextInput
            style={s.input}
            value={crp}
            onChangeText={setCrp}
            placeholder="Ex: CRP 06/123456"
            placeholderTextColor="#B0ADA6"
          />

          <Text style={s.label}>E-mail *</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Ex: paulo@email.com"
            placeholderTextColor="#B0ADA6"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={s.label}>Senha *</Text>
          <View style={s.senhaRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={senha}
              onChangeText={setSenha}
              placeholder="Pelo menos 6 caracteres"
              placeholderTextColor="#B0ADA6"
              secureTextEntry={!mostrarSenha}
            />
            <TouchableOpacity style={s.olhoBtn} onPress={() => setMostrarSenha((v) => !v)}>
              <Ionicons name={mostrarSenha ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMid} />
            </TouchableOpacity>
          </View>

          <Text style={s.label}>Confirmar senha *</Text>
          <View style={s.senhaRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={confirmarSenha}
              onChangeText={setConfirmarSenha}
              placeholder="Repita a senha"
              placeholderTextColor="#B0ADA6"
              secureTextEntry={!mostrarSenha}
            />
            <TouchableOpacity style={s.olhoBtn} onPress={() => setMostrarSenha((v) => !v)}>
              <Ionicons name={mostrarSenha ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMid} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.btn, criando && { opacity: 0.7 }]}
            onPress={handleCriarConta}
            disabled={criando}
          >
            <Text style={s.btnText}>{criando ? 'Criando...' : 'Criar conta'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.linkCadastro} onPress={() => navigation.goBack()}>
            <Text style={s.linkCadastroTexto}>Já tem conta? Entrar</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  headerWrap: { height: HEADER_H },
  headerContent: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: HEADER_H, justifyContent: 'center', alignItems: 'center',
    paddingTop: 30,
  },
  appName: {
    fontSize: 44, fontWeight: '700', fontStyle: 'italic',
    color: COLORS.btnBlue, letterSpacing: 2,
  },
  appSub: {
    fontSize: 12, fontWeight: '700', color: COLORS.btnLight,
    letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 4,
  },
  scroll: { flex: 1 },
  scrollInner: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 50 },
  title: {
    fontSize: 26, fontWeight: '700', color: COLORS.textDark, marginBottom: 6,
  },
  subtitle: {
    fontSize: 14, color: COLORS.textMid, lineHeight: 20, marginBottom: 28,
  },
  label: {
    fontSize: 13, fontWeight: '600', color: COLORS.textDark,
    marginBottom: 6, marginTop: 16,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textDark,
    borderWidth: 1,
    borderColor: '#E8E4DD',
  },
  inputTravado: {
    backgroundColor: '#F0EFEC',
    color: COLORS.textMid,
  },
  cepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cepLoading: { width: 24 },
  senhaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  olhoBtn: { padding: 4 },
  linkRefazer: { color: COLORS.btnLight, fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  linhaDupla: { flexDirection: 'row', gap: 12 },
  btn: {
    backgroundColor: COLORS.btnBlue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
    shadowColor: '#1A2D45',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  btnText: {
    color: '#FFFFFF', fontSize: 16, fontWeight: '700',
  },
  linkCadastro: { alignItems: 'center', marginTop: 20 },
  linkCadastroTexto: { color: COLORS.btnLight, fontSize: 14, fontWeight: '600' },
});
