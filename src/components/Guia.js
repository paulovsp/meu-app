import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { navigationRef } from '../navigation/navigationRef';
import { marcarGuiaVisto } from '../services/guia';

// ─── O guia, em forma de cartão sobre a tela ────────────────────────────
//
// Não usa destaque ancorado em elemento ("aponte para este botão"), e isso
// é decisão, não preguiça: âncora quebra quando a tela muda de tamanho, de
// idioma ou de conteúdo, e quebra em silêncio — o círculo fica apontando
// para o vazio e a pessoa não entende o que ler.
//
// O cartão fica embaixo, cobre pouco, e o guia NAVEGA de verdade: a cada
// passo o app abre a tela de que se está falando. Quem está lendo sobre a
// agenda está olhando para a agenda.
//
// O botão de fechar é grande e está sempre visível. Guia do qual não se
// escapa é armadilha.
export default function Guia({ passos, qual, aoTerminar }) {
  const [indice, setIndice] = useState(0);
  const [visivel, setVisivel] = useState(true);

  const passo = passos[indice];

  const irPara = useCallback((rota) => {
    if (!rota || !navigationRef.isReady()) return;
    try {
      navigationRef.navigate(rota);
    } catch (_) {
      // Rota que não existe mais não pode derrubar o guia: a explicação
      // ainda vale, mesmo sem a tela.
    }
  }, []);

  function encerrar() {
    setVisivel(false);
    marcarGuiaVisto(qual);
    if (aoTerminar) aoTerminar();
  }

  function avancar() {
    if (indice >= passos.length - 1) {
      encerrar();
      return;
    }
    const proximo = indice + 1;
    setIndice(proximo);
    irPara(passos[proximo].rota);
  }

  function voltar() {
    if (indice === 0) return;
    const anterior = indice - 1;
    setIndice(anterior);
    irPara(passos[anterior].rota);
  }

  if (!visivel || !passo) return null;

  const ultimo = indice === passos.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={encerrar}>
      {/* Sem fundo escurecido cobrindo a tela inteira: a pessoa precisa
          VER a tela de que o cartão está falando. O escurecimento fica só
          atrás do cartão, para o texto ter contraste. */}
      <View style={s.area} pointerEvents="box-none">
        <View style={s.cartao}>
          <View style={s.topo}>
            <Text style={s.passoDe}>{indice + 1} de {passos.length}</Text>
            <TouchableOpacity onPress={encerrar} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color="#6B6860" />
            </TouchableOpacity>
          </View>

          <Text style={s.titulo}>{passo.titulo}</Text>

          <ScrollView style={s.corpo} showsVerticalScrollIndicator={false}>
            <Text style={s.texto}>{passo.texto}</Text>
          </ScrollView>

          <View style={s.pontos}>
            {passos.map((_, i) => (
              <View key={i} style={[s.ponto, i === indice && s.pontoAtivo]} />
            ))}
          </View>

          <View style={s.botoes}>
            {indice > 0 ? (
              <TouchableOpacity style={s.btnVoltar} onPress={voltar}>
                <Text style={s.btnVoltarTexto}>Voltar</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.btnVoltar} onPress={encerrar}>
                <Text style={s.btnVoltarTexto}>Agora não</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.btnAvancar} onPress={avancar}>
              <Text style={s.btnAvancarTexto}>{ultimo ? 'Concluir' : 'Próximo'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  area: { flex: 1, justifyContent: 'flex-end' },
  cartao: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 22, paddingTop: 16, paddingBottom: 26,
    maxHeight: '62%',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 }, elevation: 16,
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  passoDe: { fontSize: 12, color: '#8A857D', fontWeight: '600', letterSpacing: 0.3 },
  titulo: { fontSize: 19, fontWeight: '700', color: '#302C28', lineHeight: 26, marginBottom: 10 },
  corpo: { flexGrow: 0 },
  texto: { fontSize: 14.5, color: '#4E4941', lineHeight: 22 },
  pontos: { flexDirection: 'row', gap: 6, marginTop: 18, marginBottom: 16 },
  ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#DDD8D0' },
  pontoAtivo: { backgroundColor: '#497363', width: 18 },
  botoes: { flexDirection: 'row', gap: 12 },
  btnVoltar: {
    flex: 1, paddingVertical: 13, borderRadius: 11, alignItems: 'center',
    borderWidth: 1, borderColor: '#DDD8D0',
  },
  btnVoltarTexto: { fontSize: 14.5, fontWeight: '600', color: '#6B6860' },
  btnAvancar: {
    flex: 2, paddingVertical: 13, borderRadius: 11, alignItems: 'center',
    backgroundColor: '#497363',
  },
  btnAvancarTexto: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
});
