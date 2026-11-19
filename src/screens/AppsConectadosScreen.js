// Apps conectados — um lugar só para as pontes que as ferramentas do app
// usam. Hoje é só o WhatsApp Business (comprovantes de pagamento): Google
// Meet e Zoom existiam pra transcrever sessões online e saíram junto com a
// transcrição, na remodelagem Agenda/Arquivo.
//
// Cada linha mostra o estado real, não só "configurado": conectado e
// funcionando, ou precisando reconectar. O detalhe fica na tela própria.
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { getIntegracaoWhatsapp } from '../services/whatsappBusiness';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  verde: '#44745B',
  ambar: '#B36B00',
  vermelho: '#975451',
};

export default function AppsConectadosScreen() {
  const navigation = useNavigation();
  const [carregando, setCarregando] = useState(true);
  const [whatsapp, setWhatsapp] = useState(null);

  // Recarrega a cada foco: voltar da tela do WhatsApp tem que refletir o
  // que mudou lá.
  useFocusEffect(useCallback(() => {
    let ativo = true;
    setCarregando(true);
    getIntegracaoWhatsapp()
      .then((w) => {
        if (!ativo) return;
        setWhatsapp(w);
      })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []));

  // Linha existente sem phone_number_id = configuração começada mas não
  // concluída (o Verify Token já foi gerado, as credenciais ainda não).
  const estadoWhatsapp = !whatsapp?.phone_number_id
    ? { texto: 'Não conectado', cor: COLORS.textMid }
    : whatsapp.invalidado_em
    ? { texto: 'Reconectar', cor: COLORS.vermelho }
    : { texto: 'Conectado', cor: COLORS.verde };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Apps conectados" onVoltar={() => navigation.goBack()} />
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.intro}>
          Ligações com outros aplicativos que algumas ferramentas do Dr.Sig
          usam. Todas são opcionais: sem elas, o app continua funcionando pelo
          caminho manual.
        </Text>

        {carregando ? (
          <ActivityIndicator color={COLORS.verde} style={{ marginTop: 30 }} />
        ) : (
          <>
            <Linha
              icone="logo-whatsapp"
              cor="#25D366"
              titulo="WhatsApp Business"
              descricao="Lê comprovantes de pagamento enviados pelo analisante e põe na fila para você confirmar."
              estado={estadoWhatsapp}
              onPress={() => navigation.navigate('IntegracaoWhatsapp')}
            />

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Linha({ icone, cor, titulo, descricao, estado, onPress }) {
  return (
    <TouchableOpacity style={s.card} onPress={onPress}>
      <View style={[s.iconeCaixa, { backgroundColor: `${cor}1A` }]}>
        <Ionicons name={icone} size={22} color={cor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitulo}>{titulo}</Text>
        <Text style={s.cardDescricao}>{descricao}</Text>
        <Text style={[s.cardEstado, { color: estado.cor }]}>{estado.texto}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#A9A299" />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 18 },
  intro: { fontSize: 14, color: COLORS.textMid, lineHeight: 21, marginTop: 14, marginBottom: 18 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 15, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  iconeCaixa: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cardTitulo: { fontSize: 15.5, fontWeight: '600', color: COLORS.textDark, lineHeight: 22 },
  cardDescricao: { fontSize: 12.5, color: COLORS.textMid, lineHeight: 18, marginTop: 2 },
  cardEstado: { fontSize: 12.5, fontWeight: '700', marginTop: 6, lineHeight: 18 },
  nota: { backgroundColor: '#F2E9DC', borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#E3D5BC' },
  notaTexto: { fontSize: 12.5, color: '#6B5A3A', lineHeight: 19 },
});
