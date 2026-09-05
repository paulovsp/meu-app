// Fila de comprovantes recebidos por WhatsApp, dentro do Recebíveis.
//
// Fica aqui, e não na tela do WhatsApp, por um motivo concreto: confirmar
// um comprovante marca UM MÊS como recebido, e o mês só existe nesta tela,
// onde a pessoa navega entre eles. Quando isso morava no Perfil, a
// confirmação usava sempre o mês corrente — então comprovante de pagamento
// atrasado quitava o mês errado, calado.
//
// O app nunca marca sozinho: o OCR erra (valor cortado, vírgula perdida,
// número de outra linha do recibo), então o papel daqui é pôr lado a lado o
// que foi lido e o que era esperado, e deixar a decisão com quem sabe.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { rotuloConferencia } from '../services/comprovantes';

const COLORS = {
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  verde: '#44745B',
  ambar: '#B36B00',
  vermelho: '#975451',
};

function moeda(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ComprovantesWhatsapp({
  itens, nomeDoMes, processandoId, onConfirmar, onIgnorar,
}) {
  if (!itens || itens.length === 0) return null;

  return (
    <View style={s.bloco}>
      <View style={s.cabecalho}>
        <Ionicons name="logo-whatsapp" size={17} color="#25D366" />
        <Text style={s.titulo}>
          {itens.length === 1
            ? '1 comprovante recebido por WhatsApp'
            : `${itens.length} comprovantes recebidos por WhatsApp`}
        </Text>
      </View>

      {itens.map((item) => {
        const cor = !item.patient_id || item.conferencia === 'divergente'
          ? COLORS.ambar
          : item.jaRecebido
          ? COLORS.textMid
          : item.conferencia === 'confere'
          ? COLORS.verde
          : COLORS.ambar;

        return (
          <View key={item.id} style={s.card}>
            <View style={{ flex: 1 }}>
              <Text style={s.nome}>
                {item.patient_nome || `Número ${item.telefone_remetente}`}
              </Text>

              <Text style={s.valores}>
                {item.valor_detectado ? `Lido: ${moeda(item.valor_detectado)}` : 'Valor não lido'}
                {item.valorPrevisto ? `  ·  Previsto: ${moeda(item.valorPrevisto)}` : ''}
              </Text>

              <Text style={[s.conferencia, { color: cor }]}>{rotuloConferencia(item)}</Text>

              {!item.patient_id && (
                <Text style={s.dica}>
                  Cadastre esse telefone na ficha do analisante para os
                  próximos comprovantes serem reconhecidos sozinhos.
                </Text>
              )}
            </View>

            {processandoId === item.id ? (
              <ActivityIndicator color={COLORS.verde} />
            ) : (
              <View style={{ gap: 6 }}>
                {!!item.patient_id && !item.jaRecebido && (
                  <TouchableOpacity style={s.btnOk} onPress={() => onConfirmar(item)}>
                    <Text style={s.btnOkTexto}>Marcar {nomeDoMes}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.btnIgnorar} onPress={() => onIgnorar(item)}>
                  <Text style={s.btnIgnorarTexto}>Ignorar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bloco: { marginBottom: 16 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  titulo: { fontSize: 13, fontWeight: '700', color: COLORS.textMid, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 13, marginBottom: 9,
    borderWidth: 1, borderColor: COLORS.border,
  },
  nome: { fontSize: 14.5, fontWeight: '600', color: COLORS.textDark, lineHeight: 20 },
  valores: { fontSize: 12.5, color: COLORS.textMid, lineHeight: 18, marginTop: 2 },
  conferencia: { fontSize: 12.5, fontWeight: '600', lineHeight: 18, marginTop: 3 },
  dica: { fontSize: 11.5, color: COLORS.textMid, lineHeight: 17, marginTop: 4, fontStyle: 'italic' },
  btnOk: { backgroundColor: COLORS.verde, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11 },
  btnOkTexto: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  btnIgnorar: { backgroundColor: '#F7F5F0', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: COLORS.border },
  btnIgnorarTexto: { color: COLORS.textMid, fontSize: 12, fontWeight: '600' },
});
