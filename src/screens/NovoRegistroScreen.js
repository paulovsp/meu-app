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
import { useNavigation } from '@react-navigation/native';
import {
  listarPacientes, addRecord,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';

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

  const [step, setStep] = useState('SELECT_PATIENT');
  const [pacientes, setPacientes] = useState([]);
  const [paciente, setPaciente] = useState(null);

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState('sessao');

  const [salvando, setSalvando] = useState(false);

  // ─── editor de texto livre ───
  const [conteudo, setConteudo] = useState('');
  const [selecao, setSelecao] = useState({ start: 0, end: 0 });
  const [corTexto, setCorTexto] = useState(CORES_TEXTO[0].valor);
  const [tamanhoTexto, setTamanhoTexto] = useState(TAMANHOS[1].valor);

  const inputRef = useRef(null);

  useEffect(() => {
    async function carregar() {
      try {
        setPacientes(await listarPacientes());
      } catch (e) {
        Alert.alert('Erro ao carregar analisantes', mensagemDeErro(e));
      }
    }
    carregar();
  }, []);

  // envolve o texto selecionado com marcadores de formatação (markdown simples)
  function aplicarMarcador(marcadorEsq, marcadorDir = marcadorEsq) {
    const { start, end } = selecao;
    if (start === end) {
      Alert.alert(
        'Selecione o texto',
        'Toque e arraste para selecionar o trecho que deseja formatar, depois toque no botão novamente.'
      );
      return;
    }
    const antes = conteudo.slice(0, start);
    const meio = conteudo.slice(start, end);
    const depois = conteudo.slice(end);
    const novoTexto = `${antes}${marcadorEsq}${meio}${marcadorDir}${depois}`;
    setConteudo(novoTexto);
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
      const introducao = gerarIntroducao(tipo, paciente.nome, new Date());
      const conteudoFinal = `${introducao}\n\n${conteudo.trim()}`;
      await addRecord(paciente.id, tipo, titulo.trim(), conteudoFinal, null, null, null, 'livre');
      Alert.alert('Salvo!', '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
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
        <Text style={s.headerTitle}>Novo Registro</Text>
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

        <View style={s.fieldGroup}>
          <Text style={s.label}>Conteúdo</Text>
          <View style={s.editorHintBox}>
            <Text style={s.editorHintText}>
              Escreva livremente abaixo. Para aplicar negrito, itálico, sublinhado ou
              tachado: selecione o trecho de texto desejado (toque e arraste) e depois
              toque no botão correspondente. Tamanho e cor se aplicam a todo o texto.
            </Text>
          </View>

          {/* ─── barra de formatação ─── */}
          <View style={s.toolbar}>
            <View style={s.toolbarRow}>
              <TouchableOpacity style={s.fmtBtn} onPress={() => aplicarMarcador('**')}>
                <Text style={[s.fmtBtnText, { fontWeight: '900' }]}>B</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fmtBtn} onPress={() => aplicarMarcador('_')}>
                <Text style={[s.fmtBtnText, { fontStyle: 'italic' }]}>I</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fmtBtn} onPress={() => aplicarMarcador('__')}>
                <Text style={[s.fmtBtnText, { textDecorationLine: 'underline' }]}>U</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fmtBtn} onPress={() => aplicarMarcador('~~')}>
                <Text style={[s.fmtBtnText, { textDecorationLine: 'line-through' }]}>S</Text>
              </TouchableOpacity>
            </View>

            <View style={s.toolbarRow}>
              <Text style={s.toolbarLabel}>Tamanho:</Text>
              {TAMANHOS.map(tm => (
                <TouchableOpacity
                  key={tm.valor}
                  style={[s.sizeBtn, tamanhoTexto === tm.valor && s.fmtBtnActive]}
                  onPress={() => setTamanhoTexto(tm.valor)}
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
                  onPress={() => setCorTexto(c.valor)}
                />
              ))}
            </View>
          </View>

          <TextInput
            ref={inputRef}
            style={[
              s.editorInput,
              { color: corTexto, fontSize: tamanhoTexto },
            ]}
            placeholder="Escreva aqui o conteúdo do registro..."
            placeholderTextColor="#bbb"
            multiline
            textAlignVertical="top"
            value={conteudo}
            onChangeText={setConteudo}
            onSelectionChange={(e) => setSelecao(e.nativeEvent.selection)}
          />
        </View>

        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.saveBtnText}>💾 Salvar Registro</Text>
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
  editorHintBox: {
    backgroundColor: '#F0F4F8',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3D5A80',
    marginBottom: 4,
  },
  editorHintText: { fontSize: 12, color: '#3D5A80', lineHeight: 17 },

  toolbar: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    padding: 10,
    gap: 10,
    marginBottom: 10,
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
