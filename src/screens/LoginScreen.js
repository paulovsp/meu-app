import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
  StatusBar, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { loginBiometricoEstaAtivo, obterEmailBiometrico, entrarComBiometria } from '../services/biometria';
import { solicitarRedefinicaoSenha } from '../services/conta';
import { mensagemDeErro } from '../services/erros';

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

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [entrandoComDigital, setEntrandoComDigital] = useState(false);
  const [modalEsqueciVisivel, setModalEsqueciVisivel] = useState(false);
  const [emailEsqueci, setEmailEsqueci] = useState('');
  const [enviandoEsqueci, setEnviandoEsqueci] = useState(false);

  useEffect(() => {
    (async () => {
      if (await loginBiometricoEstaAtivo()) {
        const emailSalvo = await obterEmailBiometrico();
        if (emailSalvo) setEmail(emailSalvo);
      }
    })();
  }, []);

  async function handleEntrarComDigital() {
    setEntrandoComDigital(true);
    try {
      const { error } = await entrarComBiometria();
      if (error?.naoConfigurado) {
        Alert.alert(
          'Nenhuma conta com digital neste aparelho',
          'Você ainda não ativou o login por digital aqui. Crie uma conta, ou entre com e-mail e senha e ative em Perfil → Segurança.',
          [
            { text: 'Entrar com e-mail', style: 'cancel' },
            { text: 'Criar conta', onPress: () => navigation.navigate('Cadastro') },
          ]
        );
      } else if (error) {
        Alert.alert('Não foi possível entrar', error.message);
      }
    } finally {
      setEntrandoComDigital(false);
    }
  }

  // Não navega manualmente daqui — o AuthContext detecta a sessão nova
  // (onAuthStateChange) e o AppNavigator troca sozinho pra stack principal.
  async function handleEntrar() {
    const emailTrim = email.trim();
    if (!emailTrim || !senha) {
      Alert.alert('Campos obrigatórios', 'Informe e-mail e senha.');
      return;
    }

    setEntrando(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailTrim,
        password: senha,
      });
      if (error) {
        Alert.alert('Não foi possível entrar', error.message);
      }
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível conectar. Tente novamente.');
    } finally {
      setEntrando(false);
    }
  }

  function abrirModalEsqueci() {
    setEmailEsqueci(email.trim());
    setModalEsqueciVisivel(true);
  }

  async function handleEnviarRedefinicao() {
    const emailTrim = emailEsqueci.trim();
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      Alert.alert('E-mail inválido', 'Informe o e-mail da sua conta.');
      return;
    }
    setEnviandoEsqueci(true);
    try {
      await solicitarRedefinicaoSenha(emailTrim);
      setModalEsqueciVisivel(false);
      Alert.alert(
        'Verifique seu e-mail',
        'Se esse e-mail tiver uma conta no Dr.Sig, você vai receber um link pra escolher uma nova senha.'
      );
    } catch (err) {
      Alert.alert('Não foi possível enviar', mensagemDeErro(err));
    } finally {
      setEnviandoEsqueci(false);
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollInner}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.title}>Boas vindas!</Text>
          <Text style={s.subtitle}>Entre com seu e-mail e senha.</Text>

          <TouchableOpacity
            style={[s.btnDigital, entrandoComDigital && { opacity: 0.7 }]}
            onPress={handleEntrarComDigital}
            disabled={entrandoComDigital}
          >
            <Ionicons name="finger-print" size={22} color="#FFFFFF" />
            <Text style={s.btnDigitalText}>
              {entrandoComDigital ? 'Confirmando...' : 'Entrar com digital'}
            </Text>
          </TouchableOpacity>
          <Text style={s.ouTexto}>ou entre com e-mail e senha</Text>

          <Text style={s.label}>E-mail</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Ex: paulo@email.com"
            placeholderTextColor="#B0ADA6"
            keyboardType="email-address"
            autoCapitalize="none"
            autoFocus
          />

          <Text style={s.label}>Senha</Text>
          <View style={s.senhaRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={senha}
              onChangeText={setSenha}
              placeholder="Sua senha"
              placeholderTextColor="#B0ADA6"
              secureTextEntry={!mostrarSenha}
            />
            <TouchableOpacity style={s.olhoBtn} onPress={() => setMostrarSenha((v) => !v)}>
              <Ionicons name={mostrarSenha ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMid} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.linkEsqueci} onPress={abrirModalEsqueci}>
            <Text style={s.linkEsqueciTexto}>Esqueceu a senha?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, entrando && { opacity: 0.7 }]}
            onPress={handleEntrar}
            disabled={entrando}
          >
            <Text style={s.btnText}>{entrando ? 'Entrando...' : 'Entrar'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.linkCadastro} onPress={() => navigation.navigate('Cadastro')}>
            <Text style={s.linkCadastroTexto}>Ainda não tem conta? Criar conta</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={modalEsqueciVisivel}
        transparent
        animationType="fade"
        onRequestClose={() => setModalEsqueciVisivel(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitulo}>Redefinir senha</Text>
            <Text style={s.modalSubtitulo}>
              Informe o e-mail da sua conta. Vamos mandar um link pra você escolher uma nova senha.
            </Text>
            <TextInput
              style={s.modalInput}
              value={emailEsqueci}
              onChangeText={setEmailEsqueci}
              placeholder="Ex: paulo@email.com"
              placeholderTextColor="#B0ADA6"
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.modalBtnCancelar}
                onPress={() => setModalEsqueciVisivel(false)}
                disabled={enviandoEsqueci}
              >
                <Text style={s.modalBtnCancelarText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtnConfirmar, enviandoEsqueci && { opacity: 0.7 }]}
                onPress={handleEnviarRedefinicao}
                disabled={enviandoEsqueci}
              >
                {enviandoEsqueci ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={s.modalBtnConfirmarText}>Enviar link</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  linkEsqueci: { alignItems: 'flex-end', marginTop: 10 },
  linkEsqueciTexto: { color: COLORS.btnLight, fontSize: 13, fontWeight: '600' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF',
    borderRadius: 18, padding: 24,
  },
  modalTitulo: { fontSize: 18, fontWeight: '700', color: COLORS.textDark, marginBottom: 8 },
  modalSubtitulo: { fontSize: 13, color: COLORS.textMid, lineHeight: 19, marginBottom: 16 },
  modalInput: {
    backgroundColor: '#F7F6F3', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark, borderWidth: 1, borderColor: '#E8E4DD',
  },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtnCancelar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#F0EEE9',
  },
  modalBtnCancelarText: { fontSize: 15, fontWeight: '700', color: COLORS.textMid },
  modalBtnConfirmar: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: COLORS.btnBlue,
  },
  modalBtnConfirmarText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  senhaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  olhoBtn: { padding: 4 },
  btnDigital: {
    flexDirection: 'row',
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#1A2D45',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDigitalText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  ouTexto: {
    textAlign: 'center', color: COLORS.textMid, fontSize: 13,
    marginTop: 14, marginBottom: 4,
  },
});
