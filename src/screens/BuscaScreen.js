import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  identificarPacienteNaPergunta, montarContextoPaciente, estimarCustoResposta,
  chamarBuscaChat, CreditosInsuficientesError, AssinaturaInativaError,
} from '../services/buscaChat';
import { formatarSaldoBRL } from '../services/creditosIA';
import { mensagemDeErro } from '../services/erros';
import { MENSAGEM_ASSINATURA_INATIVA } from '../services/assinatura';

const MENSAGEM_INICIAL = {
  id: 'seed',
  role: 'assistant',
  text: 'Olá! Sou o Busca Dr.Sig. Pergunte sobre um analisante (mencione o nome dele) — antes de responder, mostro uma estimativa de custo pra você confirmar.',
};

function Bolha({ mensagem }) {
  const doUsuario = mensagem.role === 'user';
  return (
    <View style={[s.bolhaLinha, doUsuario && s.bolhaLinhaUsuario]}>
      <View style={[s.bolha, doUsuario ? s.bolhaUsuario : s.bolhaAssistente]}>
        <Text style={[s.bolhaTexto, doUsuario && s.bolhaTextoUsuario]}>{mensagem.text}</Text>
        {mensagem.custo != null && (
          <Text style={s.bolhaCusto}>Custo: {formatarSaldoBRL(mensagem.custo)}</Text>
        )}
      </View>
    </View>
  );
}

export default function BuscaScreen() {
  const [mensagens, setMensagens] = useState([MENSAGEM_INICIAL]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const listRef = useRef(null);

  // "Assunto" atual da conversa: uma vez identificado um analisante pelo
  // nome, perguntas de acompanhamento continuam nele até outro nome ser
  // mencionado — sem precisar repetir o nome a cada mensagem.
  const pacienteAtivoRef = useRef(null);
  const contextoAtivoRef = useRef(null);

  async function resolverContexto(pergunta) {
    const pacienteMencionado = await identificarPacienteNaPergunta(pergunta);
    const paciente = pacienteMencionado || pacienteAtivoRef.current;

    if (!paciente) {
      return { paciente: null, contexto: null };
    }
    if (pacienteAtivoRef.current?.id === paciente.id && contextoAtivoRef.current) {
      return { paciente, contexto: contextoAtivoRef.current };
    }
    const contexto = await montarContextoPaciente(paciente);
    pacienteAtivoRef.current = paciente;
    contextoAtivoRef.current = contexto;
    return { paciente, contexto };
  }

  async function enviar() {
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;

    let paciente, contexto;
    try {
      ({ paciente, contexto } = await resolverContexto(pergunta));
    } catch (e) {
      Alert.alert('Erro ao identificar analisante', mensagemDeErro(e));
      return;
    }

    const historicoAnterior = mensagens
      .filter((m) => m.id !== 'seed')
      .map((m) => ({ role: m.role, content: m.text }));
    const historicoCompleto = [...historicoAnterior, { role: 'user', content: pergunta }];

    const custoEstimado = estimarCustoResposta({ contexto, pergunta, historico: historicoAnterior });
    const assunto = paciente ? `Assunto: ${paciente.nome}.` : 'Nenhum analisante identificado — resposta geral.';

    Alert.alert(
      'Confirmar pergunta',
      `${assunto}\n\nCusto estimado (no pior caso): até ${formatarSaldoBRL(custoEstimado)}.\n\nEnviar mesmo assim?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: () => processarEnvio(pergunta, contexto, historicoCompleto, paciente) },
      ]
    );
  }

  async function processarEnvio(pergunta, contexto, historicoCompleto, paciente) {
    setMensagens((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: pergunta }]);
    setTexto('');
    setEnviando(true);
    try {
      const { texto: resposta, custo } = await chamarBuscaChat(contexto, historicoCompleto, paciente);
      setMensagens((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: resposta, custo }]);
    } catch (e) {
      if (e instanceof AssinaturaInativaError) {
        Alert.alert('Assinatura inativa', MENSAGEM_ASSINATURA_INATIVA);
      } else if (e instanceof CreditosInsuficientesError) {
        Alert.alert('Créditos de IA insuficientes', 'Fale com o administrador da conta pra recarregar.');
      } else {
        Alert.alert('Erro ao responder', mensagemDeErro(e, 'Tente novamente.'));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={listRef}
          data={mensagens}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <Bolha mensagem={item} />}
          contentContainerStyle={s.lista}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        {enviando && (
          <View style={s.digitando}>
            <ActivityIndicator size="small" color="#3D5A80" />
            <Text style={s.digitandoTexto}>Consultando...</Text>
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Pergunte sobre um analisante..."
            placeholderTextColor="#999"
            value={texto}
            onChangeText={setTexto}
            multiline
          />
          <TouchableOpacity
            style={[s.enviarBtn, (!texto.trim() || enviando) && s.enviarBtnDesabilitado]}
            onPress={enviar}
            disabled={!texto.trim() || enviando}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },

  lista: { padding: 16, gap: 10, flexGrow: 1 },
  bolhaLinha: { flexDirection: 'row', justifyContent: 'flex-start' },
  bolhaLinhaUsuario: { justifyContent: 'flex-end' },
  bolha: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bolhaAssistente: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E4EA',
    borderBottomLeftRadius: 4,
  },
  bolhaUsuario: {
    backgroundColor: '#3D5A80',
    borderBottomRightRadius: 4,
  },
  bolhaTexto: { fontSize: 14, color: '#1A1A2E', lineHeight: 20 },
  bolhaTextoUsuario: { color: '#fff' },
  bolhaCusto: { fontSize: 11, color: '#999', marginTop: 6 },

  digitando: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingBottom: 6,
  },
  digitandoTexto: { fontSize: 12, color: '#888' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E4EA',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: '#F5F7FA',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  enviarBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#3D5A80',
    alignItems: 'center', justifyContent: 'center',
  },
  enviarBtnDesabilitado: { backgroundColor: '#C7CDD6' },
});
