// ─── Recarga de créditos por Pix ──────────────────────────────────────
//
// Antes eram três links fixos do BTG: pagavam, mas o banco não tinha como
// dizer QUEM tinha pagado — o link era o mesmo pra todo mundo. O saldo
// ficava parado e a conferência era à mão.
//
// Agora cada recarga é uma cobrança própria, criada na hora. O BTG avisa
// nosso servidor quando o Pix cai, e o crédito entra sozinho. Esta tela só
// mostra o QR code, o copia-e-cola, e espera.
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import { criarCobrancaPix, estadoDaRecarga } from '../services/creditosIA';
import { mensagemDeErro } from '../services/erros';
import { papel, tinta, salvia, semantica } from '../theme';

// De quanto em quanto tempo perguntar se o Pix caiu. Pix costuma liquidar
// em segundos; 4s é rápido o bastante pra parecer instantâneo sem virar
// uma consulta por segundo ao banco.
const INTERVALO_MS = 4000;
// Depois disso a tela para de perguntar sozinha. O crédito continua caindo
// quando o pagamento for feito — o que morre aqui é só a espera na tela,
// que não pode ficar consultando pra sempre com o app aberto na gaveta.
const DESISTE_APOS_MS = 15 * 60 * 1000;

export default function RecargaCreditosScreen() {
  const navigation = useNavigation();
  const { valorBRL, creditoBRL } = useRoute().params || {};

  const [cobranca, setCobranca] = useState(null);
  const [erro, setErro] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [paga, setPaga] = useState(false);

  const timerRef = useRef(null);
  const inicioRef = useRef(Date.now());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const nova = await criarCobrancaPix(valorBRL);
        if (vivo) setCobranca(nova);
      } catch (e) {
        if (vivo) setErro(mensagemDeErro(e));
      }
    })();
    return () => { vivo = false; };
  }, [valorBRL]);

  useEffect(() => {
    if (!cobranca?.txId || paga) return undefined;
    let vivo = true;

    async function conferir() {
      try {
        const estado = await estadoDaRecarga(cobranca.txId);
        if (!vivo) return;
        if (estado?.status === 'paga') {
          setPaga(true);
          return;
        }
      } catch (_) {
        // Falha de rede numa consulta não é motivo pra derrubar a tela: a
        // próxima tentativa vem em segundos.
      }
      if (vivo && Date.now() - inicioRef.current < DESISTE_APOS_MS) {
        timerRef.current = setTimeout(conferir, INTERVALO_MS);
      }
    }

    timerRef.current = setTimeout(conferir, INTERVALO_MS);
    return () => { vivo = false; clearTimeout(timerRef.current); };
  }, [cobranca, paga]);

  async function copiar() {
    if (!cobranca?.emv) return;
    await Clipboard.setStringAsync(cobranca.emv);
    setCopiado(true);
    // Volta ao normal depois de um tempo: um "Copiado" permanente deixa de
    // informar se o segundo toque funcionou.
    setTimeout(() => setCopiado(false), 2500);
  }

  if (erro) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <CabecalhoTela titulo="Adicionar créditos" onVoltar={() => navigation.goBack()} />
        <View style={s.centro}>
          <Ionicons name="alert-circle-outline" size={40} color={semantica.erro.tinta} />
          <Text style={s.erroTitulo}>Não consegui gerar o Pix</Text>
          <Text style={s.erroTexto}>{erro}</Text>
          <TouchableOpacity style={s.btnSecundario} onPress={() => navigation.goBack()}>
            <Text style={s.btnSecundarioTexto}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (paga) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <CabecalhoTela titulo="Adicionar créditos" onVoltar={() => navigation.goBack()} />
        <View style={s.centro}>
          <Ionicons name="checkmark-circle" size={52} color={salvia.tinta} />
          <Text style={s.okTitulo}>Pagamento confirmado</Text>
          <Text style={s.okTexto}>
            R$ {creditoBRL} entraram no seu saldo de créditos.
          </Text>
          <TouchableOpacity style={s.btnPrincipal} onPress={() => navigation.goBack()}>
            <Text style={s.btnPrincipalTexto}>Concluir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!cobranca) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <CabecalhoTela titulo="Adicionar créditos" onVoltar={() => navigation.goBack()} />
        <View style={s.centro}>
          <ActivityIndicator size="large" color={salvia.tinta} />
          <Text style={s.carregando}>Gerando a cobrança…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Adicionar créditos" onVoltar={() => navigation.goBack()} />
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>

        <View style={s.resumo}>
          <Text style={s.resumoValor}>R$ {valorBRL}</Text>
          <Text style={s.resumoCredito}>viram R$ {creditoBRL} de crédito</Text>
        </View>

        {cobranca.qrCodeUrl ? (
          <View style={s.qrBox}>
            <Image source={{ uri: cobranca.qrCodeUrl }} style={s.qr} resizeMode="contain" />
            <Text style={s.qrLegenda}>Aponte a câmera do seu banco para o código</Text>
          </View>
        ) : null}

        {cobranca.emv ? (
          <View style={s.copiaBox}>
            <Text style={s.copiaRotulo}>Pix copia e cola</Text>
            <Text style={s.copiaCodigo} numberOfLines={3} selectable>{cobranca.emv}</Text>
            <TouchableOpacity style={s.copiaAcao} onPress={copiar}>
              <Ionicons
                name={copiado ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copiado ? salvia.tinta : tinta.t500}
              />
              <Text style={[s.copiaAcaoTexto, copiado && { color: salvia.tinta }]}>
                {copiado ? 'Copiado' : 'Tocar para copiar'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={s.esperando}>
          <ActivityIndicator size="small" color={tinta.t500} />
          <Text style={s.esperandoTexto}>
            Esperando o pagamento. Assim que o Pix cair, o crédito entra
            sozinho e esta tela avisa.
          </Text>
        </View>

        <Text style={s.rodape}>
          Pode fechar o app: o crédito entra do mesmo jeito.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: papel.base },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  carregando: { marginTop: 14, fontSize: 14, color: tinta.t500, lineHeight: 20 },

  resumo: { alignItems: 'center', marginBottom: 20 },
  resumoValor: { fontSize: 34, fontWeight: '600', color: tinta.t900, lineHeight: 42 },
  resumoCredito: { fontSize: 15, color: salvia.tinta, fontWeight: '600', lineHeight: 22 },

  qrBox: {
    backgroundColor: papel.alto, borderRadius: 16, padding: 20, alignItems: 'center',
    borderWidth: 1, borderColor: papel.linha, marginBottom: 16,
  },
  qr: { width: 220, height: 220 },
  qrLegenda: { fontSize: 12.5, color: tinta.t500, marginTop: 12, lineHeight: 18, textAlign: 'center' },

  copiaBox: {
    backgroundColor: papel.alto, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: papel.linha, marginBottom: 16,
  },
  copiaRotulo: { fontSize: 12, fontWeight: '600', color: tinta.t400, letterSpacing: 0.6, marginBottom: 7 },
  copiaCodigo: { fontSize: 12, color: tinta.t700, lineHeight: 18 },
  copiaAcao: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  copiaAcaoTexto: { fontSize: 13.5, fontWeight: '600', color: tinta.t500, lineHeight: 20 },

  esperando: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: papel.veu, borderRadius: 12, padding: 14,
  },
  esperandoTexto: { flex: 1, fontSize: 13, color: tinta.t700, lineHeight: 19 },
  rodape: { fontSize: 12.5, color: tinta.t400, textAlign: 'center', marginTop: 16, lineHeight: 18 },

  okTitulo: { fontSize: 21, fontWeight: '600', color: tinta.t900, marginTop: 14, lineHeight: 28 },
  okTexto: { fontSize: 15, color: tinta.t700, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  erroTitulo: { fontSize: 19, fontWeight: '600', color: tinta.t900, marginTop: 14, lineHeight: 26 },
  erroTexto: { fontSize: 14, color: tinta.t700, textAlign: 'center', marginTop: 8, lineHeight: 21 },

  btnPrincipal: {
    backgroundColor: salvia.tinta, borderRadius: 14, paddingVertical: 15,
    paddingHorizontal: 40, marginTop: 26,
  },
  btnPrincipalTexto: { color: '#fff', fontSize: 16, fontWeight: '500', lineHeight: 22 },
  btnSecundario: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 30 },
  btnSecundarioTexto: { color: tinta.t500, fontSize: 15, fontWeight: '600', lineHeight: 22 },
});
