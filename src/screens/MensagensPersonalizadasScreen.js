import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { mensagemDeErro } from '../services/erros';
import {
  templatePadraoCobranca, templatePadraoReciboPaciente, templatePadraoReciboContador,
  VARIAVEIS_COBRANCA, VARIAVEIS_RECIBO_PACIENTE, VARIAVEIS_RECIBO_CONTADOR,
} from '../services/mensagens';

function CampoTemplate({ titulo, descricao, variaveis, valor, onChange, onRestaurarPadrao, textoPadrao }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitulo}>{titulo}</Text>
      <Text style={s.cardDescricao}>{descricao}</Text>
      <Text style={s.variaveis}>
        Variáveis: {variaveis.map((v) => `{{${v}}}`).join('  ')}
      </Text>
      <TextInput
        style={s.textarea}
        value={valor}
        onChangeText={onChange}
        placeholder={textoPadrao}
        placeholderTextColor="#B0ADA6"
        multiline
        textAlignVertical="top"
      />
      {!!valor && (
        <TouchableOpacity onPress={onRestaurarPadrao}>
          <Text style={s.restaurar}>Restaurar texto padrão</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function MensagensPersonalizadasScreen() {
  const { session } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [pixKey, setPixKey] = useState('');
  const [cobranca, setCobranca] = useState('');
  const [reciboPaciente, setReciboPaciente] = useState('');
  const [reciboContador, setReciboContador] = useState('');

  useEffect(() => {
    supabase
      .from('profiles')
      .select('pix_key, template_cobranca, template_recibo_paciente, template_recibo_contador')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          Alert.alert('Erro ao carregar', mensagemDeErro(error));
        } else {
          const chavePix = data?.pix_key || '';
          setPixKey(chavePix);
          // Sem template salvo ainda: pré-preenche com o texto padrão de
          // verdade (editável), não só um placeholder que some ao tocar no
          // campo — assim dá pra ajustar só um trecho, em vez de "reaparecer
          // vazio" e ter que reescrever tudo do zero.
          setCobranca(data?.template_cobranca || templatePadraoCobranca(!!chavePix));
          setReciboPaciente(data?.template_recibo_paciente || templatePadraoReciboPaciente());
          setReciboContador(data?.template_recibo_contador || templatePadraoReciboContador());
        }
        setCarregando(false);
      });
  }, [session.user.id]);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        template_cobranca: cobranca.trim() || null,
        template_recibo_paciente: reciboPaciente.trim() || null,
        template_recibo_contador: reciboContador.trim() || null,
      })
      .eq('id', session.user.id);
    setSalvando(false);
    if (error) {
      Alert.alert('Erro ao salvar', mensagemDeErro(error));
    } else {
      Alert.alert('Salvo', 'Suas mensagens personalizadas foram salvas.');
    }
  }

  if (carregando) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color="#3D5A80" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scrollInner} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>
          Escreva do seu jeito, ou deixe em branco pra usar o texto padrão do Dr.Sig.
          As variáveis entre chaves são substituídas automaticamente ao enviar.
        </Text>

        <CampoTemplate
          titulo="💬 Lembrete de cobrança"
          descricao="Usado no WhatsApp e no e-mail de lembrete, na tela de Recebíveis."
          variaveis={VARIAVEIS_COBRANCA}
          valor={cobranca}
          onChange={setCobranca}
          onRestaurarPadrao={() => setCobranca(templatePadraoCobranca(!!pixKey))}
          textoPadrao={templatePadraoCobranca(!!pixKey)}
        />

        <CampoTemplate
          titulo="🧾 Recibo — para o analisante"
          descricao="E-mail enviado ao analisante junto com o PDF do recibo."
          variaveis={VARIAVEIS_RECIBO_PACIENTE}
          valor={reciboPaciente}
          onChange={setReciboPaciente}
          onRestaurarPadrao={() => setReciboPaciente(templatePadraoReciboPaciente())}
          textoPadrao={templatePadraoReciboPaciente()}
        />

        <CampoTemplate
          titulo="🧾 Recibo/Nota — para o contador"
          descricao="E-mail enviado ao contador (tanto ao emitir recibo quanto nota)."
          variaveis={VARIAVEIS_RECIBO_CONTADOR}
          valor={reciboContador}
          onChange={setReciboContador}
          onRestaurarPadrao={() => setReciboContador(templatePadraoReciboContador())}
          textoPadrao={templatePadraoReciboContador()}
        />

        <TouchableOpacity
          style={[s.btnSalvar, salvando && { opacity: 0.7 }]}
          onPress={salvar}
          disabled={salvando}
        >
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSalvarTexto}>Salvar</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7FA' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollInner: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 13, color: '#6B6860', lineHeight: 19, marginBottom: 20 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 16,
  },
  cardTitulo: { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },
  cardDescricao: { fontSize: 12.5, color: '#6B6860', marginTop: 4, marginBottom: 8, lineHeight: 17 },
  variaveis: { fontSize: 11.5, color: '#3D5A80', marginBottom: 10 },
  textarea: {
    backgroundColor: '#F7F6F3',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    padding: 12,
    fontSize: 14,
    color: '#1C1C1E',
    minHeight: 100,
  },
  restaurar: { fontSize: 12.5, color: '#3D5A80', fontWeight: '600', marginTop: 8 },
  btnSalvar: {
    backgroundColor: '#3D5A80',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  btnSalvarTexto: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
