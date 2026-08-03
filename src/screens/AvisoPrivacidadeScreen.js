import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const URL_POLITICA = 'https://app.drsig.com.br/privacidade.html';

export default function AvisoPrivacidadeScreen({ onAceitar }) {
  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.titulo}>Antes de continuar</Text>
        <Text style={s.paragrafo}>
          O Dr.Sig lida com dados clínicos sensíveis dos seus analisantes. Antes de criar sua
          conta ou entrar, veja um resumo de como tratamos essas informações:
        </Text>

        <View style={s.item}>
          <Text style={s.itemTitulo}>📋 O que guardamos</Text>
          <Text style={s.itemTexto}>
            Dados da sua conta e os analisantes que você cadastrar — sessões, registros, agenda,
            financeiro e o Perfil Psicossomático gerado a partir deles.
          </Text>
        </View>

        <View style={s.item}>
          <Text style={s.itemTitulo}>🤖 Uso de IA</Text>
          <Text style={s.itemTexto}>
            Transcrição e análise usam serviços de IA de terceiros. No envio de texto, o nome do
            analisante é substituído por um identificador antes de qualquer envio.
          </Text>
        </View>

        <View style={s.item}>
          <Text style={s.itemTitulo}>🎙️ Gravação de sessão</Text>
          <Text style={s.itemTexto}>
            Só acontece com autorização prévia do próprio analisante, pedida por e-mail.
          </Text>
        </View>

        <View style={s.item}>
          <Text style={s.itemTitulo}>🗑️ Seus direitos</Text>
          <Text style={s.itemTexto}>
            Você pode excluir sua conta e todos os dados ligados a ela a qualquer momento, direto
            pelo app (Meu Perfil → Excluir minha conta).
          </Text>
        </View>

        <Text style={s.paragrafo}>
          A política de privacidade completa está publicada em:
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL(URL_POLITICA)}>
          <Text style={s.link}>{URL_POLITICA}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btnAceitar} onPress={onAceitar}>
          <Text style={s.btnAceitarTexto}>Li e concordo — continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { padding: 24, paddingBottom: 40 },
  titulo: { fontSize: 24, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 12 },
  paragrafo: { fontSize: 14.5, color: '#33333d', lineHeight: 21, marginBottom: 16 },
  item: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#E0E4EA',
  },
  itemTitulo: { fontSize: 14.5, fontWeight: '700', color: '#1A1A2E', marginBottom: 6 },
  itemTexto: { fontSize: 13.5, color: '#6B6860', lineHeight: 19 },
  link: { fontSize: 13.5, color: '#3D5A80', fontWeight: '600', marginBottom: 24, textDecorationLine: 'underline' },
  btnAceitar: {
    backgroundColor: '#3D5A80', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  btnAceitarTexto: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
