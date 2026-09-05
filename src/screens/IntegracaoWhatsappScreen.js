// Conexão com o WhatsApp Business, e a fila de comprovantes que ela produz.
//
// Antes isto ficava no meio da tela de Perfil. Saiu de lá por dois motivos:
// para caber em Apps conectados junto com Meet e Zoom, e porque as
// credenciais mudaram de lugar — token e App Secret agora ficam numa tabela
// própria, em colunas que o app NÃO consegue ler (migration 0060). Por isso
// esta tela nunca exibe o que está guardado: mostra "conectado" e permite
// substituir.
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { mensagemDeErro } from '../services/erros';
import {
  getIntegracaoWhatsapp, conectarWhatsapp, desconectarWhatsapp, URL_WEBHOOK,
} from '../services/whatsappBusiness';
import {
  listarComprovantesWhatsappPendentes, confirmarComprovanteWhatsapp,
  ignorarComprovanteWhatsapp,
} from '../services/database';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  verde: '#44745B',
  vermelho: '#975451',
};

export default function IntegracaoWhatsappScreen() {
  const navigation = useNavigation();
  const [integracao, setIntegracao] = useState(null);
  const [comprovantes, setComprovantes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');

  useFocusEffect(useCallback(() => {
    let ativo = true;
    setCarregando(true);
    Promise.all([
      getIntegracaoWhatsapp(),
      listarComprovantesWhatsappPendentes().catch(() => []),
    ])
      .then(([i, c]) => {
        if (!ativo) return;
        setIntegracao(i);
        setComprovantes(c || []);
        setPhoneNumberId(i?.phone_number_id || '');
      })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []));

  async function salvar() {
    setSalvando(true);
    try {
      await conectarWhatsapp({ phoneNumberId, accessToken, appSecret });
      // Não guarda os segredos em memória depois de enviados.
      setAccessToken('');
      setAppSecret('');
      setEditando(false);
      setIntegracao(await getIntegracaoWhatsapp());
      Alert.alert('Conectado', 'Credenciais salvas. Comprovantes recebidos por WhatsApp vão aparecer aqui.');
    } catch (err) {
      Alert.alert('Não foi possível conectar', mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  function desconectar() {
    Alert.alert(
      'Desconectar o WhatsApp',
      'Os comprovantes deixam de ser lidos automaticamente. Nada do que já foi confirmado é afetado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            try {
              await desconectarWhatsapp();
              setIntegracao(null);
              setPhoneNumberId('');
            } catch (err) {
              Alert.alert('Erro', mensagemDeErro(err));
            }
          },
        },
      ]
    );
  }

  async function confirmar(c) {
    if (!c.patient_id) return;
    setProcessandoId(c.id);
    try {
      const agora = new Date();
      await confirmarComprovanteWhatsapp(c.id, {
        patientId: c.patient_id,
        ano: agora.getFullYear(),
        mes: agora.getMonth(),
        valor: c.valor_detectado,
      });
      setComprovantes((atual) => atual.filter((x) => x.id !== c.id));
    } catch (err) {
      Alert.alert('Erro ao confirmar', mensagemDeErro(err));
    } finally {
      setProcessandoId(null);
    }
  }

  async function ignorar(c) {
    setProcessandoId(c.id);
    try {
      await ignorarComprovanteWhatsapp(c.id);
      setComprovantes((atual) => atual.filter((x) => x.id !== c.id));
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setProcessandoId(null);
    }
  }

  const conectado = !!integracao;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="WhatsApp Business" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

        <Text style={s.intro}>
          Comprovantes de pagamento enviados pelo analisante no WhatsApp são
          lidos automaticamente e entram numa fila para você conferir. O app
          nunca marca um pagamento como recebido sozinho.
        </Text>

        {carregando ? (
          <ActivityIndicator color={COLORS.verde} style={{ marginTop: 24 }} />
        ) : (
          <>
            {conectado && !editando ? (
              <>
                <View style={s.statusOk}>
                  <Text style={s.statusTitulo}>Conectado</Text>
                  <Text style={s.statusTexto}>Número (Phone Number ID): {integracao.phone_number_id}</Text>
                </View>

                <Text style={s.secao}>
                  {comprovantes.length === 0
                    ? 'Nenhum comprovante aguardando'
                    : comprovantes.length === 1
                    ? '1 comprovante aguardando sua confirmação'
                    : `${comprovantes.length} comprovantes aguardando sua confirmação`}
                </Text>

                {comprovantes.map((c) => (
                  <View key={c.id} style={s.comprovante}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.comprovanteNome}>
                        {c.patient_nome || `Número não identificado (${c.telefone_remetente})`}
                      </Text>
                      <Text style={s.comprovanteDetalhe} numberOfLines={2}>
                        {c.valor_detectado
                          ? c.valor_detectado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : c.texto_extraido?.slice(0, 80) || 'Sem texto reconhecido'}
                      </Text>
                      {!c.patient_id && (
                        <Text style={s.comprovanteAviso}>
                          Não deu para identificar de qual analisante veio — confira o telefone no cadastro.
                        </Text>
                      )}
                    </View>
                    {processandoId === c.id ? (
                      <ActivityIndicator color={COLORS.verde} />
                    ) : (
                      <View style={{ gap: 6 }}>
                        {!!c.patient_id && (
                          <TouchableOpacity style={s.btnOk} onPress={() => confirmar(c)}>
                            <Text style={s.btnOkTexto}>Confirmar</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.btnIgnorar} onPress={() => ignorar(c)}>
                          <Text style={s.btnIgnorarTexto}>Ignorar</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}

                <TouchableOpacity style={s.btnSecundario} onPress={() => setEditando(true)}>
                  <Text style={s.btnSecundarioTexto}>Substituir credenciais</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnDesconectar} onPress={desconectar}>
                  <Text style={s.btnDesconectarTexto}>Desconectar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.secao}>O que você precisa ter</Text>
                <View style={s.card}>
                  <Text style={s.passo}>Uma conta comercial verificada no WhatsApp Business (Meta).</Text>
                  <Text style={s.passo}>Um app criado em developers.facebook.com com o produto WhatsApp.</Text>
                  <Text style={s.passo}>Os analisantes cadastrados no app com o telefone certo — é assim que o comprovante é ligado a cada pessoa.</Text>
                </View>

                <Text style={s.secao}>Como configurar</Text>
                <View style={s.card}>
                  <Text style={s.passo}>
                    <Text style={s.bold}>1.</Text> No painel da Meta, configure o webhook com esta URL:
                  </Text>
                  <Text style={s.url} selectable>{URL_WEBHOOK}</Text>
                  <Text style={s.passo}>
                    <Text style={s.bold}>2.</Text> No Verify Token, use o valor combinado com o suporte do Dr.Sig.
                  </Text>
                  <Text style={s.passo}>
                    <Text style={s.bold}>3.</Text> Assine o evento <Text style={s.bold}>messages</Text>.
                  </Text>
                  <Text style={s.passo}>
                    <Text style={s.bold}>4.</Text> Copie abaixo o Phone Number ID, o token de acesso permanente e o App Secret do seu app.
                  </Text>
                </View>

                <Text style={s.label}>Phone Number ID</Text>
                <TextInput
                  style={s.input}
                  value={phoneNumberId}
                  onChangeText={setPhoneNumberId}
                  autoCapitalize="none"
                  placeholder="Ex: 123456789012345"
                  placeholderTextColor="#B8B2A8"
                />

                <Text style={s.label}>Token de acesso permanente</Text>
                <TextInput
                  style={s.input}
                  value={accessToken}
                  onChangeText={setAccessToken}
                  autoCapitalize="none"
                  secureTextEntry
                  placeholder="Cole aqui"
                  placeholderTextColor="#B8B2A8"
                />

                <Text style={s.label}>App Secret</Text>
                <TextInput
                  style={s.input}
                  value={appSecret}
                  onChangeText={setAppSecret}
                  autoCapitalize="none"
                  secureTextEntry
                  placeholder="Cole aqui"
                  placeholderTextColor="#B8B2A8"
                />
                <Text style={s.ajuda}>
                  O App Secret é o que permite ao servidor conferir que a
                  mensagem veio mesmo da Meta. Sem ele, nenhum comprovante é
                  aceito — a URL acima é pública, e sem essa conferência
                  qualquer um poderia inserir um comprovante falso na sua fila.
                </Text>
                <Text style={s.ajuda}>
                  Depois de salvos, o token e o App Secret não podem mais ser
                  lidos pelo app — nem por você. Para trocar, basta colar os
                  novos.
                </Text>

                <TouchableOpacity
                  style={[s.btnPrincipal, salvando && { opacity: 0.7 }]}
                  onPress={salvar}
                  disabled={salvando}
                >
                  {salvando
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={s.btnPrincipalTexto}>{conectado ? 'Substituir credenciais' : 'Conectar'}</Text>}
                </TouchableOpacity>

                {conectado && (
                  <TouchableOpacity style={s.btnSecundario} onPress={() => setEditando(false)}>
                    <Text style={s.btnSecundarioTexto}>Cancelar</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 18 },
  intro: { fontSize: 14, color: COLORS.textMid, lineHeight: 21, marginTop: 14 },
  secao: { fontSize: 13, fontWeight: '700', color: COLORS.textMid, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 15, borderWidth: 1, borderColor: COLORS.border, gap: 9 },
  passo: { fontSize: 13.5, color: COLORS.textDark, lineHeight: 20 },
  bold: { fontWeight: '700' },
  url: { fontSize: 12.5, color: COLORS.verde, fontWeight: '600', lineHeight: 19 },
  statusOk: { backgroundColor: '#E2EFE8', borderRadius: 14, padding: 15, borderWidth: 1, borderColor: '#C3DFCF', marginTop: 18, gap: 4 },
  statusTitulo: { fontSize: 14.5, fontWeight: '700', color: COLORS.textDark, lineHeight: 21 },
  statusTexto: { fontSize: 13, color: COLORS.textMid, lineHeight: 19 },
  comprovante: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  comprovanteNome: { fontSize: 14, fontWeight: '600', color: COLORS.textDark, lineHeight: 20 },
  comprovanteDetalhe: { fontSize: 12.5, color: COLORS.textMid, lineHeight: 18, marginTop: 2 },
  comprovanteAviso: { fontSize: 11.5, color: '#B36B00', lineHeight: 17, marginTop: 4 },
  btnOk: { backgroundColor: COLORS.verde, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  btnOkTexto: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  btnIgnorar: { backgroundColor: COLORS.bg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border },
  btnIgnorarTexto: { color: COLORS.textMid, fontSize: 12.5, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textDark, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14.5, color: COLORS.textDark, borderWidth: 1, borderColor: COLORS.border },
  ajuda: { fontSize: 12.5, color: COLORS.textMid, lineHeight: 18, marginTop: 8 },
  btnPrincipal: { backgroundColor: COLORS.verde, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  btnPrincipalTexto: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '600' },
  btnSecundario: { alignItems: 'center', paddingVertical: 14, marginTop: 10 },
  btnSecundarioTexto: { color: COLORS.verde, fontSize: 14.5, fontWeight: '600' },
  btnDesconectar: { alignItems: 'center', paddingVertical: 12 },
  btnDesconectarTexto: { color: COLORS.vermelho, fontSize: 14.5, fontWeight: '600' },
});
