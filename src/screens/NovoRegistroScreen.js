import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
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
import CabecalhoTela from '../components/CabecalhoTela';
import * as ImagePicker from 'expo-image-picker';
import { isSupported as ocrSuportado, extractTextFromImage } from 'expo-text-extractor';
import {
  listarPacientes, addRecord, editRecord, getAppointmentByPatientAndDate,
} from '../services/database';
import { mensagemDeErro } from '../services/erros';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';

const MEDIA_IMAGES = ['images'];

// ─── tipos de registro ────────────────────────────────────────────────────
const TIPOS_REGISTRO = [
  { valor: 'sessao', label: 'Sessão' },
  { valor: 'estudo', label: 'Estudo' },
  { valor: 'outro',  label: 'Outros' },
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

// ─── caixa de texto simples, sem nenhuma formatação — cresce até um teto
// (3x a altura inicial) acompanhando o texto digitado; a partir daí, quem
// rola pra ver o resto é a barra de scroll interna da própria caixa, não a
// tela toda crescendo sem limite (era isso que empurrava o botão Salvar pra
// muito longe num registro grande). ───
const ALTURA_BASE_EDITOR = 150;
const ALTURA_MAX_EDITOR = ALTURA_BASE_EDITOR * 3;

function formatarDataDigitada(texto, setter) {
  const numeros = texto.replace(/\D/g, '').slice(0, 8);
  let formatado = numeros;
  if (numeros.length > 2 && numeros.length <= 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
  } else if (numeros.length > 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
  }
  setter(formatado);
}

function dataDigitadaValida(dataBR) {
  const iso = dataBRParaISO(dataBR);
  if (!iso) return false;
  const [ano, mes, dia] = iso.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

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
// removido (é regerado do zero ao salvar, com o tipo/nome atuais na hora),
// senão o texto apareceria duplicado/desatualizado pra quem edita.
function removerIntroducaoAutomatica(conteudoCompleto) {
  const texto = conteudoCompleto || '';
  if (!texto.startsWith('Registro do tipo ')) return texto;
  const idx = texto.indexOf('\n\n');
  return idx !== -1 ? texto.slice(idx + 2) : texto;
}

function escaparHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Converte o texto puro digitado nesta caixa pra um HTML seguro (escapado,
// sem risco de injetar marcação) — é o formato que DetalheRegistroScreen.js
// já sabe exibir (WebView com `white-space: pre-wrap`, mas o <br> explícito
// garante a quebra de linha independente disso).
function textoParaHtmlSeguro(texto) {
  return escaparHtml(texto || '').split('\n').join('<br>');
}

// Caminho inverso, usado só ao ABRIR um registro existente pra editar —
// registros antigos (de antes desta simplificação) podem ter HTML de
// verdade (negrito, cor, imagem embutida); aqui tudo isso é reduzido a
// texto puro (a formatação antiga se perde, mas o texto em si é preservado).
function htmlParaTextoPlano(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// ─── componente principal ──────────────────────────────────────────────────

export default function NovoRegistroScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  useBloqueioAssinatura(navigation);

  // Vindo de DetalheAnalisanteScreen.js (✏️ num registro já existente) ou
  // de DetalheRegistroScreen.js (editar) — os dois passam { record, patientId }.
  // Vindo do popup de check-in (Início) com "Escrever registro" — passa
  // { patientId, appointmentId, dataSessao }, sem `record` (é um registro
  // novo, com paciente e data da sessão já pré-preenchidos).
  const registroExistente = route.params?.record ?? null;
  const patientIdParam = route.params?.patientId ?? null;
  const dataSessaoParam = route.params?.dataSessao ?? null;
  const editando = registroExistente !== null;
  const vemDoCheckin = !editando && !!patientIdParam;

  const [step, setStep] = useState(editando || vemDoCheckin ? 'FORM' : 'SELECT_PATIENT');
  const [pacientes, setPacientes] = useState([]);
  const [paciente, setPaciente] = useState(null);

  const [titulo, setTitulo] = useState(registroExistente?.title || '');
  // `category` é onde o tipo (sessão/estudo/outro) deveria estar gravado;
  // `type` é fallback pra registros salvos antes dessa correção, quando o
  // valor ia parar (por engano) na coluna errada.
  const [tipo, setTipo] = useState(registroExistente?.category || registroExistente?.type || 'sessao');

  // Data da SESSÃO (não de criação do arquivo) — só existe pro tipo
  // "Sessão", e é o que permite ligar este registro ao compromisso
  // correspondente (fecha o critério de "tem relato" usado pelo card
  // "Sessões sem relato" do Perfil — ver estaSemRelato em database.js).
  // A usuária pode corrigir livremente; a ligação é refeita a partir do
  // valor atual do campo na hora de salvar, nunca do que veio por parâmetro.
  const [dataSessaoRegistro, setDataSessaoRegistro] = useState(
    editando && registroExistente?.date
      ? dataISOParaBR(new Date(registroExistente.date).toISOString().slice(0, 10))
      : (dataSessaoParam ? dataISOParaBR(dataSessaoParam) : '')
  );

  const [salvando, setSalvando] = useState(false);
  const [processando, setProcessando] = useState('');

  const [conteudo, setConteudo] = useState(
    () => htmlParaTextoPlano(removerIntroducaoAutomatica(registroExistente?.content))
  );
  const [alturaEditor, setAlturaEditor] = useState(ALTURA_BASE_EDITOR);

  useEffect(() => {
    async function carregar() {
      try {
        const todos = await listarPacientes();
        setPacientes(todos);
        if (editando || vemDoCheckin) {
          setPaciente(todos.find((p) => p.id === patientIdParam) || null);
        }
      } catch (e) {
        Alert.alert('Erro ao carregar analisantes', mensagemDeErro(e));
      }
    }
    carregar();
  }, []);

  // ─── importar texto de imagem — OCR no próprio aparelho (Google ML Kit
  // no Android, Apple Vision no iOS via expo-text-extractor), sem enviar a
  // imagem pra lugar nenhum: sem custo, sem provedor, funciona offline. ───
  async function anexarTexto(linhas) {
    const texto = (linhas || []).join('\n').trim();
    if (!texto) {
      Alert.alert('Sem texto', 'Não encontrei texto útil nessa imagem.');
      return;
    }
    setConteudo((atual) => (atual ? `${atual}\n\n${texto}` : texto));
  }

  async function processarImagem(uri) {
    try {
      setProcessando('Lendo texto da imagem...');
      const linhas = await extractTextFromImage(uri);
      await anexarTexto(linhas);
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
    // Registro do tipo "Sessão" precisa da data da sessão — é o que liga
    // este registro ao compromisso correspondente, fechando o critério de
    // "tem relato" (ver estaSemRelato em database.js).
    if (tipo === 'sessao' && !dataDigitadaValida(dataSessaoRegistro)) {
      Alert.alert('Data da sessão obrigatória', 'Informe a data da sessão no formato DD/MM/AAAA.');
      return;
    }
    const textoDigitado = conteudo.trim();
    if (!textoDigitado) {
      Alert.alert('Conteúdo vazio', 'Escreva algo antes de salvar.');
      return;
    }

    setSalvando(true);
    try {
      // Sempre reconsulta o compromisso a partir do valor ATUAL do campo de
      // data (não do que veio por parâmetro do check-in) — se a usuária
      // corrigir a data, a ligação tem que seguir a correção, não o
      // parâmetro original.
      let appointmentIdFinal = null;
      let dataRegistroISO = null;
      if (tipo === 'sessao') {
        dataRegistroISO = dataBRParaISO(dataSessaoRegistro);
        try {
          const compromisso = await getAppointmentByPatientAndDate(paciente.id, dataRegistroISO);
          appointmentIdFinal = compromisso?.id || null;
        } catch {
          // Não impede salvar o registro por causa disso — só fica sem o
          // vínculo automático com o compromisso.
        }
      }

      // Mantém a data original da introdução ao editar (é sobre quando o
      // registro foi feito, não sobre quando foi corrigido) — só um registro
      // novo usa a data de agora. Pro tipo "Sessão", a introdução usa a
      // data da sessão informada, não a data de criação do arquivo.
      const dataIntroducao = tipo === 'sessao'
        ? new Date(`${dataRegistroISO}T12:00:00`)
        : (editando && registroExistente.date ? new Date(registroExistente.date) : new Date());
      const introducao = gerarIntroducao(tipo, paciente.nome, dataIntroducao);
      const conteudoFinal = `${introducao}\n\n${textoParaHtmlSeguro(textoDigitado)}`;
      if (editando) {
        await editRecord(registroExistente.id, {
          type: 'text',
          title: titulo.trim(),
          content: conteudoFinal,
          category: tipo,
          // Só manda esses dois campos quando o tipo é "Sessão" — pra
          // estudo/outro, `editRecord` não deve mexer em appointment_id/date
          // (undefined = "não alterar", ver a função em database.js).
          ...(tipo === 'sessao' ? { appointmentId: appointmentIdFinal, dataRegistro: dataRegistroISO } : {}),
        });
      } else {
        // `category` (não `type`) é onde o tipo sessão/estudo/outro deve ir
        // — é o que DetalheAnalisanteScreen.js lê pra escolher o rótulo/cor
        // do item na lista.
        await addRecord(paciente.id, 'text', titulo.trim(), conteudoFinal, null, null, tipo, 'livre', appointmentIdFinal, dataRegistroISO);
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
      <SafeAreaView style={s.container} edges={['left', 'right', 'bottom']}>
        <CabecalhoTela titulo="Novo Registro" onVoltar={() => navigation.goBack()} />

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
    <SafeAreaView style={s.container} edges={['left', 'right', 'bottom']}>
      <CabecalhoTela titulo={editando ? 'Editar Registro' : 'Novo Registro'} onVoltar={() => navigation.goBack()} />

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

        {tipo === 'sessao' && (
          <View style={s.fieldGroup}>
            <Text style={s.label}>Data da sessão *</Text>
            <TextInput
              style={s.inputTitulo}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#A9A299"
              value={dataSessaoRegistro}
              onChangeText={(t) => formatarDataDigitada(t, setDataSessaoRegistro)}
              keyboardType="numeric"
              maxLength={10}
            />
            <Text style={s.dataSessaoHint}>
              Usada pra ligar este registro ao compromisso da agenda, se houver um nessa data.
            </Text>
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text style={s.label}>Título *</Text>
          <TextInput
            style={s.inputTitulo}
            placeholder="Ex: Sessão 12 — transferência"
            placeholderTextColor="#A9A299"
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
                <Ionicons name="camera-outline" size={19} color="#497363" style={s.importBtnIcon} />
                <Text style={s.importBtnText}>Fotografar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.importBtn} onPress={selecionarDaGaleria} disabled={!!processando}>
                <Ionicons name="image-outline" size={19} color="#497363" style={s.importBtnIcon} />
                <Text style={s.importBtnText}>Galeria</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!!processando && (
          <View style={s.processandoBox}>
            <ActivityIndicator color="#497363" />
            <Text style={s.processandoText}>{processando}</Text>
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text style={s.label}>Conteúdo</Text>
          {/* Caixa de texto simples — cresce até 3x a altura inicial
              acompanhando o texto; passado isso, rola por dentro dela
              mesma (scroll nativo do TextInput multiline). */}
          <TextInput
            style={[s.editorInput, { height: alturaEditor }]}
            multiline
            textAlignVertical="top"
            placeholder="Escreva aqui o conteúdo do registro..."
            placeholderTextColor="#A9A299"
            value={conteudo}
            onChangeText={setConteudo}
            onContentSizeChange={(e) => {
              const alturaConteudo = e.nativeEvent.contentSize.height;
              setAlturaEditor(Math.min(Math.max(alturaConteudo, ALTURA_BASE_EDITOR), ALTURA_MAX_EDITOR));
            }}
          />
        </View>

        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.saveBtnText}>{editando ? 'Salvar alterações' : 'Salvar Registro'}</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F0' },
  stepLabel: { fontSize: 16, color: '#756E66', padding: 20, paddingBottom: 8, lineHeight: 23 },
  form:        { padding: 20, gap: 18 },
  fieldGroup:  { gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#756E66',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 14, color: '#8C857B', lineHeight: 20 },
  infoValue: { fontSize: 15, fontWeight: '500', color: '#497363', lineHeight: 22 },
  tipoRow:   { flexDirection: 'row', gap: 10 },
  tipoBtn: {
    flex: 1, padding: 10, borderRadius: 10, borderWidth: 1,
    borderColor: '#DDD6CA', alignItems: 'center', backgroundColor: '#FDFCFA',
  },
  tipoBtnActive:     { borderColor: '#497363', backgroundColor: '#E3EAF1' },
  tipoBtnText: { fontSize: 13, color: '#8C857B', lineHeight: 19 },
  tipoBtnTextActive: { color: '#497363', fontWeight: '500' },
  introPreviewBox: {
    backgroundColor: '#E4EFE9',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#497363',
  },
  introPreviewLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#497363',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  introPreviewText: {
    fontSize: 12.5,
    color: '#497363',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  dataSessaoHint: { fontSize: 11.5, color: '#8C857B', fontStyle: 'italic', lineHeight: 17 },
  inputTitulo: {
    backgroundColor: '#FDFCFA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#302C28',
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  importHint: {
    fontSize: 12,
    color: '#6B5A3A',
    fontStyle: 'italic',
    backgroundColor: '#F2E9DC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#7D6540',
  },
  importRow: { flexDirection: 'row', gap: 12 },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E3EAF1',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#C4D3E0',
  },
  importBtnIcon: {},
  importBtnText: { fontSize: 14, color: '#497363', fontWeight: '600', lineHeight: 20 },
  processandoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#E3EAF1',
    borderRadius: 10,
    padding: 14,
  },
  processandoText: { fontSize: 14, color: '#497363', lineHeight: 20 },

  // Cresce com `alturaEditor` (state, ver onContentSizeChange) até no
  // máximo ALTURA_MAX_EDITOR — passado isso, o próprio TextInput rola por
  // dentro (comportamento nativo de multiline com altura fixa).
  editorInput: {
    backgroundColor: '#FDFCFA',
    borderWidth: 1,
    borderColor: '#EAE5DC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#302C28',
  },

  patientCard: {
    backgroundColor: '#FDFCFA',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#EAE5DC',
    elevation: 1,
  },
  patientAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#497363',
    justifyContent: 'center', alignItems: 'center',
  },
  patientAvatarText: { color: '#fff', fontSize: 18, fontWeight: '500' },
  patientCardName: { fontSize: 16, fontWeight: '600', color: '#302C28', lineHeight: 23 },
  empty: { textAlign: 'center', color: '#A9A299', marginTop: 40, fontSize: 15, lineHeight: 22 },
  saveBtn: {
    backgroundColor: '#497363',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '500', lineHeight: 23 },
});
