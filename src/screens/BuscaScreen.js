import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView, Alert
} from 'react-native';
import { getRecords, getSessions, listarPacientes } from '../services/database';

// Busca/chat usa DeepSeek (não Groq) — mesmo motivo da análise de núcleos:
// o tier gratuito da Groq para modelos de texto tem TPM baixo demais pro
// volume real de uso. A Groq fica só com a transcrição de áudio.
const DEEPSEEK_API_KEY = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';

function buildContext() {
  try {
    const pacientes = listarPacientes();
    let contexto = '=== DADOS DO ARQUIVO CLÍNICO ===\n\n';

    for (const p of pacientes) {
      contexto += `PACIENTE: ${p.nome}\n`;
      if (p.codinome)    contexto += `  Codinome: ${p.codinome}\n`;
      if (p.nascimento)  contexto += `  Nascimento: ${p.nascimento}\n`;
      if (p.telefone)    contexto += `  Telefone: ${p.telefone}\n`;
      if (p.data_inicio) contexto += `  Início análise: ${p.data_inicio}\n`;

      const sessoes = getSessions(p.id);
      if (sessoes.length > 0) {
        contexto += `  SESSÕES (${sessoes.length} total):\n`;
        for (const s of sessoes) {
          contexto += `    [${s.date}] Tipo: ${s.type}`;
          if (s.online_platform) contexto += ` | Plataforma: ${s.online_platform}`;
          if (s.transcript && s.transcript.trim()) {
            contexto += `\n    Transcrição: ${s.transcript.substring(0, 500)}`;
            if (s.transcript.length > 500) contexto += '... [truncado]';
          }
          contexto += '\n';
        }
      }

      const registros = getRecords(p.id);
      if (registros.length > 0) {
        contexto += `  REGISTROS (${registros.length} total):\n`;
        for (const r of registros) {
          contexto += `    [${r.date}] ${r.title || 'Sem título'} (${r.type})`;
          if (r.content && r.content.trim()) {
            contexto += `\n    Conteúdo: ${r.content.substring(0, 300)}`;
            if (r.content.length > 300) contexto += '... [truncado]';
          }
          contexto += '\n';
        }
      }
      contexto += '\n';
    }
    return contexto;
  } catch (e) {
    console.error('Erro buildContext:', e);
    return 'Não foi possível carregar os dados clínicos.';
  }
}

export default function BuscaScreen() {
  const [messages, setMessages] = useState([
    {
      id: '0',
      role: 'assistant',
      text: 'Olá! Sou seu assistente clínico. Posso buscar e analisar sessões, registros e informações dos seus analisantes. Como posso ajudar?',
    },
  ]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [contexto, setContexto] = useState('');
  const flatListRef = useRef(null);

  useEffect(() => {
    setContexto(buildContext());
  }, []);

  async function enviarMensagem() {
    const texto = input.trim();
    if (!texto || loading) return;

    const novaMsgUsuario = { id: Date.now().toString(), role: 'user', text: texto };
    const novasMensagens = [...messages, novaMsgUsuario];
    setMessages(novasMensagens);
    setInput('');
    setLoading(true);

    try {
      const historico = novasMensagens
        .filter(m => m.id !== '0')
        .map(m => ({ role: m.role, content: m.text }));

      const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `Você é um assistente clínico especializado em psicanálise.
Seu papel é ajudar o psicanalista a buscar e analisar informações do arquivo clínico.
Responda SEMPRE em português brasileiro.
Seja preciso, clínico e respeitoso com a privacidade dos dados.
Use os dados abaixo como fonte de verdade para responder às perguntas.

${contexto}`,
            },
            ...historico,
          ],
          temperature: 0.4,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Erro na API do DeepSeek');
      }

      const data = await response.json();
      const resposta = data.choices[0].message.content;

      setMessages(prev => [
        ...prev,
        { id: Date.now().toString() + '_r', role: 'assistant', text: resposta },
      ]);
    } catch (e) {
      Alert.alert('Erro', `Não foi possível conectar ao assistente: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function renderItem({ item }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser ? styles.textUser : styles.textAssistant]}>
          {item.text}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🧠 Assistente Clínico</Text>
        <Text style={styles.headerSub}>Pergunte sobre sessões, registros e analisantes</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#6C63FF" />
            <Text style={styles.loadingText}>Analisando dados clínicos...</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ex: Resuma as últimas sessões..."
            placeholderTextColor="#999"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={enviarMensagem}
            disabled={!input.trim() || loading}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F5F5' },
  flex: { flex: 1 },
  header: { backgroundColor: '#6C63FF', paddingVertical: 14, paddingHorizontal: 20 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  headerSub: { color: '#E0DCFF', fontSize: 12, marginTop: 2 },
  list: { padding: 16, paddingBottom: 8 },
  bubble: { maxWidth: '82%', borderRadius: 16, padding: 12, marginBottom: 10 },
  bubbleUser: { backgroundColor: '#6C63FF', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleAssistant: {
    backgroundColor: '#fff', alignSelf: 'flex-start', borderBottomLeftRadius: 4,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  textUser: { color: '#fff' },
  textAssistant: { color: '#222' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  loadingText: { color: '#6C63FF', fontSize: 13 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEE', gap: 8,
  },
  input: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, color: '#222',
  },
  sendBtn: {
    backgroundColor: '#6C63FF', borderRadius: 22,
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#C5C2F0' },
  sendIcon: { color: '#fff', fontSize: 18 },
});