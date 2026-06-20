import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator,
  TextInput, FlatList,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { listarPacientes, addRecord } from '../services/database';

const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || '';

// Cores disponíveis na toolbar
const FONT_COLORS = [
  { label: 'Preto',    value: '#1A1A2E' },
  { label: 'Azul',     value: '#2c7be5' },
  { label: 'Vermelho', value: '#e74c3c' },
  { label: 'Verde',    value: '#27ae60' },
  { label: 'Roxo',     value: '#8e44ad' },
  { label: 'Cinza',    value: '#7f8c8d' },
];

export default function AddRecordScreen() {
  const navigation = useNavigation();
  const route      = useRoute();
  const prePatientId = route.params?.patientId ?? null;

  const richRef = useRef(null);

  const [step, setStep]             = useState('SELECT_PATIENT'); // SELECT_PATIENT | FORM
  const [pacientes, setPacientes]   = useState([]);
  const [paciente, setPaciente]     = useState(null);
  const [titulo, setTitulo]         = useState('');
  const [tipo, setTipo]             = useState('anotacao');
  const [salvando, setSalvando]     = useState(false);
  const [processando, setProcessando] = useState('');
  const [showColors, setShowColors] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');

  useEffect(() => {
    const lista = listarPacientes();
    setPacientes(lista);
    if (prePatientId) {
      const p = lista.find(x => x.id === prePatientId);
      if (p) { setPaciente(p); setStep('FORM'); }
    }
  }, []);

  // ── OCR via Groq Vision (llava) ──────────────────────────────────
  async function extrairTextoImagem(uri) {
    setProcessando('Lendo imagem com IA...');
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const payload = {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extraia todo o texto desta imagem. Retorne apenas o texto, sem comentários, sem formatação extra. Se não houver texto, responda: "Nenhum texto encontrado."',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 2048,
      };

      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Erro HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const texto = data?.choices?.[0]?.message?.content?.trim() || '';
      const htmlTexto = texto.split('\n').map(l => `<p>${l}</p>`).join('');
      richRef.current?.insertHTML(htmlTexto);

    } catch (err) {
      Alert.alert('Erro no OCR', err.message);
    } finally {
      setProcessando('');
    }
  }

  async function tirarFoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: false,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      await extrairTextoImagem(result.assets[0].uri);
    }
  }

  async function importarArquivo() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/*' });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setProcessando('Lendo arquivo...');
      const texto = await FileSystem.readAsStringAsync(uri);
      const html  = texto.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
      richRef.current?.insertHTML(html);
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível ler o arquivo.');
    } finally {
      setProcessando('');
    }
  }

  async function salvar() {
    if (!paciente) return;
    if (!titulo.trim()) {
      Alert.alert('Título obrigatório', 'Por favor, informe um título para o registro.');
      return;
    }
    setSalvando(true);
    try {
      // pega o HTML do editor
      const content = htmlContent || '';
      addRecord(paciente.id, tipo, titulo.trim(), content, null, null);
      Alert.alert('✅ Registro salvo!', '', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Erro', err.message);
    } finally {
      setSalvando(false);
    }
  }

  // ── STEP: Selecionar paciente ─────────────────────────────────────
  if (step === 'SELECT_PATIENT') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.backText}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Novo Registro</Text>
          <View style={{ width: 70 }} />
        </View>
        <Text style={s.stepLabel}>Selecione o analisante:</Text>
        <FlatList
          data={pacientes}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.patientCard}
              onPress={() => { setPaciente(item); setStep('FORM'); }}
            >
              <View style={s.patientAvatar}>
                <Text style={s.patientAvatarText}>
                  {(item.codinome || item.nome).charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={s.patientCardName}>{item.codinome || item.nome}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={s.empty}>Nenhum analisante cadastrado.</Text>
          }
        />
      </SafeAreaView>
    );
  }

  // ── STEP: Formulário ──────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.backText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Novo Registro</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>

        {/* Analisante */}
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Analisante:</Text>
          <Text style={s.infoValue}>{paciente?.codinome || paciente?.nome}</Text>
        </View>

        {/* Tipo */}
        <View style={s.fieldGroup}>
          <Text style={s.label}>Tipo de registro</Text>
          <View style={s.tipoRow}>
            {['anotacao','estudo','outro'].map(t => (
              <TouchableOpacity
                key={t}
                style={[s.tipoBtn, tipo === t && s.tipoBtnActive]}
                onPress={() => setTipo(t)}
              >
                <Text style={[s.tipoBtnText, tipo === t && s.tipoBtnTextActive]}>
                  {t === 'anotacao' ? '📝 Anotação'
                    : t === 'estudo' ? '📚 Estudo'
                    : '🗂 Outro'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Título */}
        <View style={s.fieldGroup}>
          <Text style={s.label}>Título *</Text>
          <TextInput
            style={s.inputTitulo}
            placeholder="Ex: Sessão 12 — transferência"
            placeholderTextColor="#bbb"
            value={titulo}
            onChangeText={setTitulo}
          />
        </View>

        {/* Botões de importação */}
        <View style={s.importRow}>
          <TouchableOpacity style={s.importBtn} onPress={tirarFoto}>
            <Text style={s.importBtnIcon}>📷</Text>
            <Text style={s.importBtnText}>Fotografar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.importBtn} onPress={importarArquivo}>
            <Text style={s.importBtnIcon}>📂</Text>
            <Text style={s.importBtnText}>Importar arquivo</Text>
          </TouchableOpacity>
        </View>

        {processando ? (
          <View style={s.processandoBox}>
            <ActivityIndicator color="#3D5A80" />
            <Text style={s.processandoText}>{processando}</Text>
          </View>
        ) : null}

        {/* Editor rico */}
        <View style={s.fieldGroup}>
          <Text style={s.label}>Conteúdo</Text>

          {/* Toolbar de formatação */}
          <RichToolbar
            editor={richRef}
            actions={[
              actions.setBold,
              actions.setItalic,
              actions.setUnderline,
              actions.setStrikethrough,
              actions.insertBulletsList,
              actions.insertOrderedList,
              actions.undo,
              actions.redo,
            ]}
            style={s.toolbar}
            iconTint="#3D5A80"
            selectedIconTint="#fff"
            selectedButtonStyle={{ backgroundColor: '#3D5A80', borderRadius: 6 }}
            iconSize={20}
          />

          {/* Cores da fonte */}
          <View style={s.colorRow}>
            <Text style={s.colorLabel}>Cor:</Text>
            {FONT_COLORS.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[s.colorDot, { backgroundColor: c.value }]}
                onPress={() => richRef.current?.setForeColor(c.value)}
              />
            ))}
          </View>

          {/* Tamanhos de fonte */}
          <View style={s.sizeRow}>
            <Text style={s.colorLabel}>Tamanho:</Text>
            {[1, 2, 3, 4, 5].map(sz => (
              <TouchableOpacity
                key={sz}
                style={s.sizeBtn}
                onPress={() => richRef.current?.setFontSize(sz)}
              >
                <Text style={[s.sizeBtnText, { fontSize: 10 + sz * 2 }]}>{sz}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <RichEditor
            ref={richRef}
            style={s.richEditor}
            placeholder="Digite ou importe o conteúdo do registro..."
            initialContentHTML=""
            onChange={html => setHtmlContent(html)}
            editorStyle={{
              backgroundColor: '#fff',
              color: '#1A1A2E',
              fontSize: 16,
              padding: 12,
            }}
          />
        </View>

        {/* Botão salvar */}
        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={salvando}>
          {salvando
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.saveBtnText}>💾 Salvar Registro</Text>}
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backText:     { color: '#3D5A80', fontSize: 15, fontWeight: '600' },
  headerTitle:  { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E' },
  stepLabel:    { fontSize: 16, color: '#555', padding: 20, paddingBottom: 8 },
  form:         { padding: 20, gap: 18 },
  fieldGroup:   { gap: 8 },
  label: {
    fontSize: 13, fontWeight: '600', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel:    { fontSize: 14, color: '#888' },
  infoValue:    { fontSize: 15, fontWeight: '700', color: '#3D5A80' },
  tipoRow:      { flexDirection: 'row', gap: 10 },
  tipoBtn: {
    flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff',
  },
  tipoBtnActive: { borderColor: '#3D5A80', backgroundColor: '#EBF3FB' },
  tipoBtnText:   { fontSize: 13, color: '#888' },
  tipoBtnTextActive: { color: '#3D5A80', fontWeight: '700' },
  inputTitulo: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, color: '#1A1A2E',
    borderWidth: 1, borderColor: '#E0E4EA',
  },
  importRow:    { flexDirection: 'row', gap: 12 },
  importBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#EBF3FB', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#8AAEC8',
  },
  importBtnIcon: { fontSize: 20 },
  importBtnText: { fontSize: 14, color: '#3D5A80', fontWeight: '600' },
  processandoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#EBF3FB', borderRadius: 10, padding: 14,
  },
  processandoText: { fontSize: 14, color: '#3D5A80' },

  // Editor rico
  toolbar: {
    backgroundColor: '#F0F4F8',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 4,
  },
  colorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 6,
  },
  colorLabel:   { fontSize: 12, color: '#888', fontWeight: '600' },
  colorDot: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)',
  },
  sizeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6,
  },
  sizeBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd',
    justifyContent: 'center', alignItems: 'center',
  },
  sizeBtnText:  { color: '#3D5A80', fontWeight: '600' },
  richEditor: {
    minHeight: 300, borderRadius: 12,
    borderWidth: 1, borderColor: '#E0E4EA',
    backgroundColor: '#fff',
  },

  // Paciente card
  patientCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: '#E0E4EA', elevation: 1,
  },
  patientAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#3D5A80', justifyContent: 'center', alignItems: 'center',
  },
  patientAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  patientCardName:   { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  empty:    { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 15 },

  saveBtn: {
    backgroundColor: '#3D5A80', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});