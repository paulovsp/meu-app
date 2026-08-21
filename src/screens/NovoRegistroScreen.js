import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { isSupported as ocrSuportado, extractTextFromImage } from 'expo-text-extractor';
import { RichEditor, RichToolbar, actions as richActions } from 'react-native-pell-rich-editor';
import {
  listarPacientes, addRecord, editRecord,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';

const MEDIA_IMAGES = ['images'];

// ─── tipos de registro ────────────────────────────────────────────────────
const TIPOS_REGISTRO = [
  { valor: 'sessao', label: '🗣 Sessão' },
  { valor: 'estudo', label: '📚 Estudo' },
  { valor: 'outro',  label: '🗂 Outros' },
];

// ─── introdução descritiva fixa, gerada a partir do tipo escolhido ────────
// Prefixada ao conteúdo salvo para dar contexto explícito (tipo, analisante,
// data) ao texto do registro — ajuda a IA do Buscador Dr.Sig a interpretar
// corretamente do que se trata cada arquivo ao pesquisar nos registros.
const TIPO_CONTEXTO = {
  sessao: {
    rotulo: 'sessão clínica',
    descricao: 'anotações e observações clínicas referentes a um atendimento/sessão terapêutica realizada',
  },
  estudo: {
    rotulo: 'estudo ou material teórico',
    descricao: 'anotações de estudo, referências teóricas ou reflexões que embasam a compreensão do caso, sem relatar diretamente uma sessão',
  },
  outro: {
    rotulo: 'registro complementar',
    descricao: 'informações diversas — administrativas, anexos ou observações gerais — que não se enquadram como sessão ou estudo',
  },
};

function formatarDataExtenso(data) {
  const dataFmt = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaFmt = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dataFmt} às ${horaFmt}`;
}

function gerarIntroducao(tipoValor, pacienteNome, data) {
  const info = TIPO_CONTEXTO[tipoValor] || TIPO_CONTEXTO.outro;
  const nome = pacienteNome || 'analisante não identificado';
  return (
    `Registro do tipo ${info.rotulo}, referente ao analisante ${nome}, ` +
    `criado em ${formatarDataExtenso(data)}. Este documento contém ${info.descricao}.`
  );
}

// Todo registro salvo por esta tela começa com a introdução automática
// acima seguida de uma linha em branco — ao abrir pra editar, isso é
// removido do editor (é regerado do zero ao salvar, com o tipo/nome atuais
// na hora), senão o texto apareceria duplicado/desatualizado pra quem edita.
function removerIntroducaoAutomatica(conteudoCompleto) {
  const texto = conteudoCompleto || '';
  if (!texto.startsWith('Registro do tipo ')) return texto;
  const idx = texto.indexOf('\n\n');
  return idx !== -1 ? texto.slice(idx + 2) : texto;
}

// ─── paleta de cores de texto disponíveis no editor ──────────────────────
const CORES_TEXTO = [
  { nome: 'Padrão',   valor: '#1A1A2E' },
  { nome: 'Azul',     valor: '#2c7be5' },
  { nome: 'Vermelho', valor: '#e74c3c' },
  { nome: 'Verde',    valor: '#1e9e63' },
  { nome: 'Roxo',     valor: '#8e44ad' },
  { nome: 'Laranja',  valor: '#e67e22' },
];

const TAMANHOS = [
  { nome: 'P', valor: 14 },
  { nome: 'M', valor: 16 },
  { nome: 'G', valor: 20 },
  { nome: 'GG', valor: 26 },
];

// ─── componente principal ──────────────────────────────────────────────────

export default function NovoRegistroScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  useBloqueioAssinatura(navigation);

  // Vindo de DetalheAnalisanteScreen.js (✏️ num registro já existente) ou
  // de DetalheRegistroScreen.js (editar) — os dois passam { record, patientId }.
  const registroExistente = route.params?.record ?? null;
  const patientIdParam = route.params?.patientId ?? null;
  const editando = registroExistente !== null;

  const [step, setStep] = useState(editando ? 'FORM' : 'SELECT_PATIENT');
  const [pacientes, setPacientes] = useState([]);
  const [paciente, setPaciente] = useState(null);

  const [titulo, setTitulo] = useState(registroExistente?.title || '');
  // `category` é onde o tipo (sessão/estudo/outro) deveria estar gravado;
  // `type` é fallback pra registros salvos antes dessa correção, quando o
  // valor ia parar (por engano) na coluna errada.
  const [tipo, setTipo] = useState(registroExistente?.category || registroExistente?.type || 'sessao');

  const [salvando, setSalvando] = useState(false);
  const [processando, setProcessando] = useState('');

  // ─── editor de texto rico (WYSIWYG de verdade, via WebView) ───
  const [conteudo, setConteudo] = useState(() => removerIntroducaoAutomatica(registroExistente?.content));
  const [corTexto, setCorTexto] = useState(CORES_TEXTO[0].valor);
  const [tamanhoTexto, setTamanhoTexto] = useState(TAMANHOS[1].valor);

  const richText = useRef(null);

  useEffect(() => {
    async function carregar() {
      try {
        const todos = await listarPacientes();
        setPacientes(todos);
        if (editando) {
          setPaciente(todos.find((p) => p.id === patientIdParam) || null);
        }
      } catch (e) {
        Alert.alert('Erro ao carregar analisantes', mensagemDeErro(e));
      }
    }
    carregar();
  }, []);

  function escaparHtml(texto) {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ─── importar texto de imagem — OCR no próprio aparelho (Google ML Kit
  // no Android, Apple Vision no iOS via expo-text-extractor), sem enviar a
  // imagem pra lugar nenhum: sem custo, sem provedor, funciona offline. ───
  // Insere direto no editor rico (na posição do cursor) como HTML — precisa
  // escapar e converter quebras de linha em <br>, senão o texto reconhecido
  // vira uma linha só dentro do editor.
  function anexarTexto(linhas) {
    const texto = (linhas || []).join('\n').trim();
    if (!texto) {
      Alert.alert('Sem texto', 'Não encontrei texto útil nessa imagem.');
      return;
    }
    const html = escaparHtml(texto).split('\n').join('<br>');
    richText.current?.insertHTML(html);
  }

  async function processarImagem(uri) {
    try {
      setProcessando('Lendo texto da imagem...');
      const linhas = await extractTextFromImage(uri);
      anexarTexto(linhas);
    } catch (err) {
      console.error('[processarImagem]', err);
      Alert.alert('Erro ao ler imagem', err?.message || 'Falha ao processar imagem.');
    } finally {
      setProcessando('');
    }
  }

  async function tirarFoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permissão negada', 'Precisamos de acesso à câmera.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: MEDIA_IMAGES,
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) throw new Error('URI da foto não encontrado.');
      await processarImagem(uri);
    } catch (err) {
      console.error('[tirarFoto]', err);
      Alert.alert('Erro na câmera', err?.message || 'Não foi possível tirar foto.');
    }
  }

  async function selecionarDaGaleria() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permissão negada', 'Precisamos de acesso à galeria.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: MEDIA_IMAGES,
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) throw new Error('URI da imagem não encontrado.');
      await processarImagem(uri);
    } catch (err) {
      console.error('[selecionarDaGaleria]', err);
      Alert.alert('Erro na galeria', err?.message || 'Não foi possível abrir galeria.');
    }
  }

  async function salvar() {
    if (!paciente) {
      Alert.alert('Selecione um analisante', 'Escolha um analisante antes de salvar.');
      return;
    }
    if (!titulo.trim()) {
      Alert.alert('Título obrigatório', 'Por favor, informe um título.');
      return;
    }
    if (!conteudo.trim()) {
      Alert.alert('Conteúdo vazio', 'Escreva algo antes de salvar.');
      return;
    }

    setSalvando(true);
    try {
      // Mantém a data original da introdução ao editar (é sobre quando o
      // registro foi feito, não sobre quando foi corrigido) — só um registro
      // novo usa a data de agora.
      const dataIntroducao = editando && registroExistente.date ? new Date(registroExistente.date) : new Date();
      const introducao = gerarIntroducao(tipo, paciente.nome, dataIntroducao);
      const conteudoFinal = `${introducao}\n\n${conteudo.trim()}`;
      if (editando) {
        await editRecord(registroExistente.id, {
          type: 'text',
          title: titulo.trim(),
          content: conteudoFinal,
          category: tipo,
        });
      } else {
        // `category` (não `type`) é onde o tipo sessão/estudo/outro deve ir
        // — é o que DetalheAnalisanteScreen.js lê pra escolher o rótulo/cor
        // do item na lista.
        await addRecord(paciente.id, 'text', titulo.trim(), conteudoFinal, null, null, tipo, 'livre');
      }
      Alert.alert(editando ? 'Alterações salvas!' : 'Salvo!', '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err, 'Falha ao salvar.'));
    } finally {
      setSalvando(false);
    }
  }

  // ─── STEP: Selecionar paciente ──────────────────────────────────────────
  if (step === 'SELECT_PATIENT') {
    return (
      <SafeAreaView style={s.container} edges={['top', 'left', 'right', 'bottom']}>
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
                  {(item.nome || 'A').charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={s.patientCardName}>{item.nome}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>Nenhum analisante cadastrado.</Text>}
        />
      </SafeAreaView>
    );
  }

  // ─── STEP: Formulário ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.backText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{editando ? 'Editar Registro' : 'Novo Registro'}</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Analisante:</Text>
          <Text style={s.infoValue}>{paciente?.nome}</Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.label}>Tipo de registro</Text>
          <View style={s.tipoRow}>
            {TIPOS_REGISTRO.map(t => (
              <TouchableOpacity
                key={t.valor}
                style={[s.tipoBtn, tipo === t.valor && s.tipoBtnActive]}
                onPress={() => setTipo(t.valor)}
              >
                <Text style={[s.tipoBtnText, tipo === t.valor && s.tipoBtnTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.introPreviewBox}>
            <Text style={s.introPreviewLabel}>Introdução automática do arquivo:</Text>
            <Text style={s.introPreviewText}>
              {gerarIntroducao(tipo, paciente?.nome, new Date())}
            </Text>
          </View>
        </View>

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

        {ocrSuportado && (
          <View style={s.fieldGroup}>
            <Text style={s.label}>Importar texto via imagem</Text>
            <Text style={s.importHint}>
              O texto é lido no próprio aparelho (sem enviar a imagem pra lugar nenhum) e
              adicionado ao final do conteúdo.
            </Text>
            <View style={s.importRow}>
              <TouchableOpacity style={s.importBtn} onPress={tirarFoto} disabled={!!processando}>
                <Text style={s.importBtnIcon}>📷</Text>
                <Text style={s.importBtnText}>Fotografar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.importBtn} onPress={selecionarDaGaleria} disabled={!!processando}>
                <Text style={s.importBtnIcon}>🖼️</Text>
                <Text style={s.importBtnText}>Galeria</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!!processando && (
          <View style={s.processandoBox}>
            <ActivityIndicator color="#3D5A80" />
            <Text style={s.processandoText}>{processando}</Text>
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text style={s.label}>Conteúdo</Text>
          <View style={s.editorHintBox}>
            <Text style={s.editorHintText}>
              Escreva livremente abaixo. Selecione um trecho e toque num botão da
              barra de formatação (negrito, itálico, sublinhado, tachado ou listas)
              pra aplicar só naquele trecho. Tamanho e cor de texto ficam na barra
              logo abaixo do editor.
            </Text>
          </View>

          {/* ─── editor rico de verdade (WebView + execCommand) ───
              Bold/itálico/etc. aplicam na seleção real do editor, não
              dependem do estado de seleção instável do TextInput do RN —
              é o que fazia negrito "não funcionar" no editor antigo. */}
          <RichEditor
            ref={richText}
            style={s.editorInput}
            placeholder="Escreva aqui o conteúdo do registro..."
            initialContentHTML={conteudo}
            useContainer
            onChange={setConteudo}
            editorStyle={{
              backgroundColor: '#fff',
              color: corTexto,
              contentCSSText: `font-size:${tamanhoTexto}px; min-height:280px; padding:4px;`,
            }}
          />

          <RichToolbar
            editor={richText}
            actions={[
              richActions.setBold,
              richActions.setItalic,
              richActions.setUnderline,
              richActions.setStrikethrough,
              richActions.insertBulletsList,
              richActions.insertOrderedList,
              richActions.undo,
              richActions.redo,
            ]}
            iconTint="#1A1A2E"
            selectedIconTint="#3D5A80"
            style={s.richToolbar}
          />

          <View style={s.toolbar}>
            <View style={s.toolbarRow}>
              <Text style={s.toolbarLabel}>Tamanho:</Text>
              {TAMANHOS.map(tm => (
                <TouchableOpacity
                  key={tm.valor}
                  style={[s.sizeBtn, tamanhoTexto === tm.valor && s.fmtBtnActive]}
                  onPress={() => { setTamanhoTexto(tm.valor); richText.current?.setFontSize(tm.valor); }}
                >
                  <Text style={s.fmtBtnText}>{tm.nome}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.toolbarRow}>
              <Text style={s.toolbarLabel}>Cor:</Text>
              {CORES_TEXTO.map(c => (
                <TouchableOpacity
                  key={c.valor}
                  style={[
                    s.colorDot,
                    { backgroundColor: c.valor },
                    corTexto === c.valor && s.colorDotActive,
                  ]}
                  onPress={() => { setCorTexto(c.valor); richText.current?.setForeColor(c.valor); }}
                />
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.saveBtnText}>{editando ? '💾 Salvar alterações' : '💾 Salvar Registro'}</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backText:    { color: '#3D5A80', fontSize: 15, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E' },
  stepLabel:   { fontSize: 16, color: '#555', padding: 20, paddingBottom: 8 },
  form:        { padding: 20, gap: 18 },
  fieldGroup:  { gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 14, color: '#888' },
  infoValue: { fontSize: 15, fontWeight: '700', color: '#3D5A80' },
  tipoRow:   { flexDirection: 'row', gap: 10 },
  tipoBtn: {
    flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff',
  },
  tipoBtnActive:     { borderColor: '#3D5A80', backgroundColor: '#EBF3FB' },
  tipoBtnText:       { fontSize: 13, color: '#888' },
  tipoBtnTextActive: { color: '#3D5A80', fontWeight: '700' },
  introPreviewBox: {
    backgroundColor: '#F0F4F8',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3D5A80',
  },
  introPreviewLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3D5A80',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  introPreviewText: {
    fontSize: 12.5,
    color: '#3D5A80',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  inputTitulo: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  importHint: {
    fontSize: 12,
    color: '#7a6000',
    fontStyle: 'italic',
    backgroundColor: '#FFF8E7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F5A623',
  },
  importRow: { flexDirection: 'row', gap: 12 },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EBF3FB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#8AAEC8',
  },
  importBtnIcon: { fontSize: 20 },
  importBtnText: { fontSize: 14, color: '#3D5A80', fontWeight: '600' },
  processandoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EBF3FB',
    borderRadius: 10,
    padding: 14,
  },
  processandoText: { fontSize: 14, color: '#3D5A80' },
  editorHintBox: {
    backgroundColor: '#F0F4F8',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3D5A80',
    marginBottom: 4,
  },
  editorHintText: { fontSize: 12, color: '#3D5A80', lineHeight: 17 },

  richToolbar: {
    backgroundColor: '#F5F7FA',
    borderWidth: 1,
    borderColor: '#E0E4EA',
    borderRadius: 10,
    marginTop: 8,
  },

  toolbar: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    padding: 10,
    gap: 10,
    marginTop: 10,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolbarLabel: { fontSize: 12, color: '#888', fontWeight: '600', marginRight: 2 },
  fmtBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    backgroundColor: '#F5F7FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeBtn: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    backgroundColor: '#F5F7FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fmtBtnActive: {
    borderColor: '#3D5A80',
    backgroundColor: '#EBF3FB',
  },
  fmtBtnText: { fontSize: 16, color: '#1A1A2E' },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#fff',
  },
  colorDotActive: {
    borderColor: '#1A1A2E',
  },

  editorInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E4EA',
    borderRadius: 12,
    padding: 16,
    minHeight: 320,
    lineHeight: 26,
  },

  patientCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    elevation: 1,
  },
  patientAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#3D5A80',
    justifyContent: 'center', alignItems: 'center',
  },
  patientAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  patientCardName:   { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  empty:   { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 15 },
  saveBtn: {
    backgroundColor: '#3D5A80',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
