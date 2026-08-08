import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import SignatureScreen from 'react-native-signature-canvas';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';

// Some o rodapé/marca-d'água padrão da lib — só o espaço de desenho importa
// aqui, o resto (limpar/salvar) já tem botões próprios na tela.
const ASSINATURA_WEB_STYLE = `
  .m-signature-pad--footer { display: none; margin: 0; }
  .m-signature-pad { box-shadow: none; border: none; }
  .m-signature-pad--body { border: none; }
  body, html { width: 100%; height: 100%; }
`;

export default function AssinaturaScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const padRef = useRef(null);

  // 'desenhando' -> tela do canvas | 'revisao' -> preview + girar/salvar
  const [etapa, setEtapa] = useState('desenhando');
  const [original, setOriginal] = useState(null); // data URI capturado (sem rotação)
  const [preview, setPreview] = useState(null); // data URI já com a rotação atual aplicada
  const [angulo, setAngulo] = useState(0);
  const [processando, setProcessando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  function assinaturaVazia() {
    Alert.alert('Assinatura vazia', 'Desenhe sua assinatura antes de continuar.');
  }

  function capturarAssinatura(dataUri) {
    setOriginal(dataUri);
    setPreview(dataUri);
    setAngulo(0);
    setEtapa('revisao');
  }

  async function girar90() {
    const novoAngulo = (angulo + 90) % 360;
    setProcessando(true);
    try {
      const resultado = await ImageManipulator.manipulateAsync(
        original,
        novoAngulo ? [{ rotate: novoAngulo }] : [],
        { format: ImageManipulator.SaveFormat.PNG, base64: true }
      );
      setAngulo(novoAngulo);
      setPreview(`data:image/png;base64,${resultado.base64}`);
    } catch (e) {
      Alert.alert('Erro ao girar', e?.message || 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  }

  function refazer() {
    setOriginal(null);
    setPreview(null);
    setAngulo(0);
    setEtapa('desenhando');
  }

  async function salvarAssinatura() {
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ assinatura: preview })
        .eq('id', session.user.id);
      if (error) throw error;
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar assinatura', e?.message || 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  }

  function removerAssinatura() {
    Alert.alert('Remover assinatura', 'Tem certeza que deseja remover sua assinatura?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setSalvando(true);
          try {
            const { error } = await supabase
              .from('profiles')
              .update({ assinatura: null })
              .eq('id', session.user.id);
            if (error) throw error;
            navigation.goBack();
          } catch (e) {
            Alert.alert('Erro', e?.message || 'Tente novamente.');
          } finally {
            setSalvando(false);
          }
        },
      },
    ]);
  }

  if (etapa === 'revisao') {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <Text style={s.dica}>
          Se a assinatura saiu de lado (comum quando se desenha com o celular
          deitado), toque em "Girar" até ficar na horizontal certa.
        </Text>

        <View style={s.previewBox}>
          {processando ? (
            <ActivityIndicator color="#3D5A80" />
          ) : (
            <Image source={{ uri: preview }} style={s.previewImg} resizeMode="contain" />
          )}
        </View>

        <View style={s.acoes}>
          <TouchableOpacity style={s.btnLimpar} onPress={refazer} disabled={processando || salvando}>
            <Text style={s.btnLimparTxt}>Refazer</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.btnGirar} onPress={girar90} disabled={processando || salvando}>
            <Text style={s.btnGirarTxt}>↻ Girar 90°</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btnSalvar, (processando || salvando) && { opacity: 0.6 }]}
            disabled={processando || salvando}
            onPress={salvarAssinatura}
          >
            {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSalvarTxt}>Salvar</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Text style={s.dica}>
        Desenhe sua assinatura com o dedo no espaço abaixo. Ela vai aparecer
        acima do seu nome nos recibos — não substitui o nome, CPF nem CRP
        impressos.
      </Text>

      <View style={s.canvasBox}>
        <SignatureScreen
          ref={padRef}
          onOK={capturarAssinatura}
          onEmpty={assinaturaVazia}
          descriptionText=""
          webStyle={ASSINATURA_WEB_STYLE}
          autoClear={false}
        />
      </View>

      <View style={s.acoes}>
        <TouchableOpacity
          style={s.btnLimpar}
          onPress={() => padRef.current?.clearSignature()}
        >
          <Text style={s.btnLimparTxt}>Limpar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btnRemover} onPress={removerAssinatura} disabled={salvando}>
          <Text style={s.btnRemoverTxt}>Remover</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btnSalvar, salvando && { opacity: 0.6 }]}
          disabled={salvando}
          onPress={() => padRef.current?.readSignature()}
        >
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSalvarTxt}>Continuar</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  dica: { fontSize: 13, color: '#6B6860', lineHeight: 18, marginBottom: 12 },
  canvasBox: {
    flex: 1, borderWidth: 1, borderColor: '#E0E4EA', borderRadius: 12, overflow: 'hidden',
  },
  previewBox: {
    flex: 1, borderWidth: 1, borderColor: '#E0E4EA', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFC',
  },
  previewImg: { width: '100%', height: '100%' },
  acoes: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnLimpar: {
    flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E0E4EA', alignItems: 'center',
  },
  btnLimparTxt: { color: '#1A1A2E', fontWeight: '600' },
  btnRemover: {
    flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#C0392B', alignItems: 'center',
  },
  btnRemoverTxt: { color: '#C0392B', fontWeight: '600' },
  btnGirar: {
    flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#3D5A80', alignItems: 'center',
  },
  btnGirarTxt: { color: '#3D5A80', fontWeight: '700' },
  btnSalvar: {
    flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#3D5A80', alignItems: 'center',
  },
  btnSalvarTxt: { color: '#fff', fontWeight: '700' },
});
