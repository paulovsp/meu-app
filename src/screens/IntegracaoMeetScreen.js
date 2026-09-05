// Conectar a conta do Google para fazer sessões online pelo Meet com
// transcrição automática.
//
// A tela existe pra que os requisitos apareçam ANTES de a pessoa tentar usar:
// o plano do Google precisa gerar transcrição automática, e descobrir isso
// depois da sessão significa a sessão perdida. Por isso a conexão testa a
// capacidade da conta na hora e guarda o resultado.
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { mensagemDeErro } from '../services/erros';
import {
  getIntegracaoMeet, conectarGoogle, desconectarGoogle,
  integracaoUtilizavel, PLANOS_COM_TRANSCRICAO,
} from '../services/videochamada';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  verde: '#497363',
  vermelho: '#975451',
  ambar: '#B36B00',
};

export default function IntegracaoMeetScreen() {
  const navigation = useNavigation();
  const [integracao, setIntegracao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [conectando, setConectando] = useState(false);

  // useFocusEffect (e não useEffect): a conexão termina no NAVEGADOR, fora do
  // app. Quando a pessoa volta pra cá, a tela precisa reler o estado — senão
  // continuaria mostrando "não conectado" depois de conectar.
  useFocusEffect(useCallback(() => {
    let ativo = true;
    setCarregando(true);
    getIntegracaoMeet()
      .then((dados) => { if (ativo) setIntegracao(dados); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []));

  async function aoConectar() {
    setConectando(true);
    try {
      await conectarGoogle();
      Alert.alert(
        'Continue no navegador',
        'Autorize o Dr.Sig na tela do Google e depois volte para o app — a conexão aparece aqui.'
      );
    } catch (err) {
      Alert.alert('Não deu para conectar', mensagemDeErro(err));
    } finally {
      setConectando(false);
    }
  }

  function aoDesconectar() {
    Alert.alert(
      'Desconectar o Google',
      'Suas sessões online voltam a ser gravadas pelo microfone do aparelho. As transcrições já salvas não são afetadas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            try {
              await desconectarGoogle();
              setIntegracao(null);
            } catch (err) {
              Alert.alert('Erro', mensagemDeErro(err));
            }
          },
        },
      ]
    );
  }

  const conectada = !!integracao;
  const utilizavel = integracaoUtilizavel(integracao);
  const precisaReconectar = conectada && !!integracao.invalidado_em;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Sessões pelo Meet" onVoltar={() => navigation.goBack()} />
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>

        <Text style={s.intro}>
          Conectando sua conta do Google, o Dr.Sig cria a sala de cada sessão
          online e traz a transcrição pronta, sem gravar pelo microfone do
          aparelho.
        </Text>

        <View style={s.vantagens}>
          <Vantagem icone="mic-off-outline" texto="Não usa o microfone — acaba o problema de áudio mudo quando a chamada está no mesmo celular." />
          <Vantagem icone="cash-outline" texto="Não consome créditos de IA: quem transcreve é o Google." />
          <Vantagem icone="people-outline" texto="Já separa as falas por participante." />
        </View>

        {carregando ? (
          <ActivityIndicator color={COLORS.verde} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* ── Requisitos, sempre visíveis antes de conectar ── */}
            <Text style={s.secao}>O que sua conta precisa ter</Text>
            <View style={s.card}>
              <Text style={s.requisito}>
                <Text style={s.bold}>1.</Text> Uma conta Google Workspace com um destes planos:
              </Text>
              {PLANOS_COM_TRANSCRICAO.map((plano) => (
                <Text key={plano} style={s.plano}>• {plano}</Text>
              ))}
              <Text style={s.requisitoNota}>
                Conta pessoal @gmail.com e planos Business Starter/Standard não
                geram transcrição automática.
              </Text>
              <Text style={s.requisito}>
                <Text style={s.bold}>2.</Text> Você precisa ser quem abre a chamada — a sala é criada por aqui.
              </Text>
              <Text style={s.requisito}>
                <Text style={s.bold}>3.</Text> O analisante precisa ter autorizado a gravação e transcrição no app, como em qualquer sessão. O aviso do próprio Meet não substitui essa autorização.
              </Text>
            </View>

            {/* ── Estado atual ── */}
            {conectada && (
              <View style={[
                s.status,
                utilizavel ? s.statusOk : precisaReconectar ? s.statusErro : s.statusAviso,
              ]}>
                <Text style={s.statusTitulo}>
                  {utilizavel ? 'Conectado e pronto'
                    : precisaReconectar ? 'Conexão expirada'
                    : 'Conectado, mas sem transcrição automática'}
                </Text>
                {!!integracao.conta_email && (
                  <Text style={s.statusTexto}>Conta: {integracao.conta_email}</Text>
                )}
                {precisaReconectar ? (
                  <Text style={s.statusTexto}>
                    {integracao.invalidado_motivo || 'O acesso precisa ser renovado.'} Toque em
                    "Reconectar" abaixo.
                  </Text>
                ) : !utilizavel ? (
                  <Text style={s.statusTexto}>
                    Esta conta do Google não gera transcrição automática. Suas
                    sessões online continuam funcionando com a gravação pelo
                    aparelho — nesse caso, faça a chamada em outro dispositivo,
                    para o microfone não ser disputado.
                  </Text>
                ) : null}
              </View>
            )}

            <TouchableOpacity
              style={[s.btnPrincipal, conectando && { opacity: 0.7 }]}
              onPress={aoConectar}
              disabled={conectando}
            >
              {conectando ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <Ionicons name="logo-google" size={17} color="#FFFFFF" />
                  <Text style={s.btnPrincipalTexto}>
                    {conectada ? 'Reconectar conta do Google' : 'Conectar conta do Google'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {conectada && (
              <TouchableOpacity style={s.btnDesconectar} onPress={aoDesconectar}>
                <Text style={s.btnDesconectarTexto}>Desconectar</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Vantagem({ icone, texto }) {
  return (
    <View style={s.vantagem}>
      <Ionicons name={icone} size={17} color={COLORS.verde} style={{ marginTop: 2 }} />
      <Text style={s.vantagemTexto}>{texto}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 18 },
  intro: { fontSize: 14.5, color: COLORS.textMid, lineHeight: 22, marginTop: 14 },
  vantagens: { marginTop: 14, gap: 10 },
  vantagem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  vantagemTexto: { flex: 1, fontSize: 13.5, color: COLORS.textDark, lineHeight: 20 },
  secao: { fontSize: 13, fontWeight: '700', color: COLORS.textMid, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 26, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 10 },
  requisito: { fontSize: 13.5, color: COLORS.textDark, lineHeight: 20 },
  requisitoNota: { fontSize: 12.5, color: COLORS.textMid, lineHeight: 18, fontStyle: 'italic' },
  plano: { fontSize: 13, color: COLORS.textMid, lineHeight: 19, marginLeft: 10 },
  bold: { fontWeight: '700', color: COLORS.textDark },
  status: { marginTop: 20, borderRadius: 14, padding: 15, borderWidth: 1, gap: 5 },
  statusOk: { backgroundColor: '#E2EFE8', borderColor: '#C3DFCF' },
  statusAviso: { backgroundColor: '#FFF4E5', borderColor: '#F0DCBC' },
  statusErro: { backgroundColor: '#F7E7E6', borderColor: '#E5CBC9' },
  statusTitulo: { fontSize: 14.5, fontWeight: '700', color: COLORS.textDark, lineHeight: 21 },
  statusTexto: { fontSize: 13, color: COLORS.textMid, lineHeight: 19 },
  btnPrincipal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: COLORS.verde, borderRadius: 14, paddingVertical: 16, marginTop: 22,
  },
  btnPrincipalTexto: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '600' },
  btnDesconectar: { alignItems: 'center', paddingVertical: 15, marginTop: 4 },
  btnDesconectarTexto: { color: COLORS.vermelho, fontSize: 14.5, fontWeight: '600' },
});
