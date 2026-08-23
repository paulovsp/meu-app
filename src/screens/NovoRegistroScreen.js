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
import * as ImageManipulator from 'expo-image-manipulator';
import { isSupported as ocrSuportado, extractTextFromImage } from 'expo-text-extractor';
import {
  RichText, Toolbar, useEditorBridge, useBridgeState, useKeyboard, TenTapStartKit, PlaceholderBridge,
} from '@10play/tentap-editor';
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

// ─── barra extra (cor, marca-texto, inserir imagem) ───────────────────────
// A barra padrão do @10play/tentap-editor já cobre negrito/itálico/sublinhado/
// tachado/títulos/listas/link, mas não expõe cor de texto, marca-texto nem
// inserir imagem — mesmo esses módulos já estando carregados no editor
// (TenTapStartKit inclui ColorBridge/HighlightBridge/ImageBridge). Em vez de
// brigar com o sistema de ícones (Image, não vetor) da <Toolbar> da lib pra
// adicionar esses botões nela, uma faixa própria fica encaixada logo acima —
// mesma regra de exibição (só some do rodapé o teclado ou o editor perde o
// foco), pra formar uma única barra de formatação maior.
const CORES_TEXTO = ['#302C28', '#C0392B', '#B9770E', '#1F618D', '#1E8449', '#6C3483'];
const CORES_MARCA = ['#FDE68A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA'];

function BarraFormatacaoExtra({ editor, visivel, onInserirImagem, desabilitado }) {
  if (!visivel) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.barraExtra}
      contentContainerStyle={s.barraExtraConteudo}
      keyboardShouldPersistTaps="always"
    >
      <Text style={s.barraExtraLabel}>Cor</Text>
      {CORES_TEXTO.map((cor) => (
        <TouchableOpacity key={cor} style={[s.swatch, { backgroundColor: cor }]} onPress={() => editor.setColor(cor)} />
      ))}
      <TouchableOpacity style={s.swatchLimpar} onPress={() => editor.unsetColor()}>
        <Ionicons name="close" size={13} color="#8C857B" />
      </TouchableOpacity>

      <View style={s.barraExtraDivisor} />

      <Text style={s.barraExtraLabel}>Marca-texto</Text>
      {CORES_MARCA.map((cor) => (
        <TouchableOpacity key={cor} style={[s.swatch, { backgroundColor: cor }]} onPress={() => editor.toggleHighlight(cor)} />
      ))}
      <TouchableOpacity style={s.swatchLimpar} onPress={() => editor.unsetHighlight()}>
        <Ionicons name="close" size={13} color="#8C857B" />
      </TouchableOpacity>

      <View style={s.barraExtraDivisor} />

      <TouchableOpacity style={s.swatchAcao} onPress={onInserirImagem} disabled={desabilitado}>
        <Ionicons name="image-outline" size={18} color={desabilitado ? '#C4BEB4' : '#497363'} />
      </TouchableOpacity>
    </ScrollView>
  );
}

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
// removido do editor (é regerado do zero ao salvar, com o tipo/nome atuais
// na hora), senão o texto apareceria duplicado/desatualizado pra quem edita.
function removerIntroducaoAutomatica(conteudoCompleto) {
  const texto = conteudoCompleto || '';
  if (!texto.startsWith('Registro do tipo ')) return texto;
  const idx = texto.indexOf('\n\n');
  return idx !== -1 ? texto.slice(idx + 2) : texto;
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

  // ─── editor de texto rico (item 1, v13 — troca do react-native-pell-
  // rich-editor, cuja formatação não aplicava de forma confiável na seleção
  // real do texto, pelo @10play/tentap-editor, baseado em TipTap/ProseMirror
  // — o mesmo motor por trás do Notion/Google Docs mobile). initialContent
  // só é lido uma vez, no mount — igual ao comportamento anterior.
  // `dynamicHeight: true` é essencial: o WebView do RichText tem o scroll
  // nativo travado de propósito pela própria lib (ela não rola por dentro) —
  // sem isso, texto que passasse da altura da caixa ficava simplesmente
  // inacessível, sem nenhum jeito de rolar até ele (era exatamente o "não dava
  // pra rolar pra ver o texto inteiro" reportado). Com dynamicHeight, a caixa
  // CRESCE para caber o documento inteiro, e quem rola é o ScrollView da tela
  // toda — igual rolar uma página comprida, não uma caixinha por dentro. ───
  const editor = useEditorBridge({
    // Placeholder em português — o padrão da lib ("Write something...") é
    // em inglês; PlaceholderBridge depois de TenTapStartKit vence o de mesmo
    // nome (uniqueBy da lib é "last wins"), sem precisar clonar a lista.
    bridgeExtensions: [
      ...TenTapStartKit,
      PlaceholderBridge.configureExtension({ placeholder: 'Escreva aqui o conteúdo do registro...' }),
    ],
    initialContent: removerIntroducaoAutomatica(registroExistente?.content) || '',
    avoidIosKeyboard: true,
    dynamicHeight: true,
  });
  // Mesma regra de exibição da <Toolbar> da lib (ver Toolbar.tsx) — a barra
  // extra (cor/marca-texto/imagem) só aparece junto com ela, formando uma
  // única faixa de formatação no rodapé.
  const editorState = useBridgeState(editor);
  const { isKeyboardUp } = useKeyboard();
  const barraExtraVisivel = isKeyboardUp && editorState.isFocused;

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

  function escaparHtml(texto) {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ─── importar texto de imagem — OCR no próprio aparelho (Google ML Kit
  // no Android, Apple Vision no iOS via expo-text-extractor), sem enviar a
  // imagem pra lugar nenhum: sem custo, sem provedor, funciona offline. ───
  // Acrescenta ao final do conteúdo já escrito (o bridge do tentap não expõe
  // "inserir na posição do cursor" publicamente) — precisa escapar e
  // converter quebras de linha em <br>, senão o texto reconhecido vira uma
  // linha só dentro do editor.
  async function anexarTexto(linhas) {
    const texto = (linhas || []).join('\n').trim();
    if (!texto) {
      Alert.alert('Sem texto', 'Não encontrei texto útil nessa imagem.');
      return;
    }
    const html = escaparHtml(texto).split('\n').join('<br>');
    const atual = (await editor.getHTML()) || '';
    editor.setContent(`${atual}<p>${html}</p>`);
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

  // ─── inserir a imagem em si no texto (diferente do "importar texto via
  // imagem" acima, que só lê e extrai o texto por OCR) — vai pro editor via
  // editor.setImage(), que espera uma URL ou um data URI em base64 (a lib já
  // carrega o ImageBridge com allowBase64). Redimensiona só se a foto for
  // maior que 1000px de largura, pra não inflar à toa o HTML salvo. ───
  async function inserirImagemNoEditor(uri, larguraOriginal) {
    try {
      setProcessando('Inserindo imagem...');
      const acoes = larguraOriginal && larguraOriginal > 1000 ? [{ resize: { width: 1000 } }] : [];
      const resultado = await ImageManipulator.manipulateAsync(
        uri, acoes, { format: ImageManipulator.SaveFormat.JPEG, base64: true, compress: 0.7 }
      );
      editor.setImage(`data:image/jpeg;base64,${resultado.base64}`);
    } catch (err) {
      console.error('[inserirImagemNoEditor]', err);
      Alert.alert('Erro ao inserir imagem', err?.message || 'Falha ao inserir imagem.');
    } finally {
      setProcessando('');
    }
  }

  async function tirarFotoInserir() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permissão negada', 'Precisamos de acesso à câmera.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: MEDIA_IMAGES, quality: 1, allowsEditing: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('URI da foto não encontrado.');
      await inserirImagemNoEditor(asset.uri, asset.width);
    } catch (err) {
      console.error('[tirarFotoInserir]', err);
      Alert.alert('Erro na câmera', err?.message || 'Não foi possível tirar foto.');
    }
  }

  async function selecionarDaGaleriaInserir() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permissão negada', 'Precisamos de acesso à galeria.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: MEDIA_IMAGES, quality: 1, allowsEditing: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('URI da imagem não encontrado.');
      await inserirImagemNoEditor(asset.uri, asset.width);
    } catch (err) {
      console.error('[selecionarDaGaleriaInserir]', err);
      Alert.alert('Erro na galeria', err?.message || 'Não foi possível abrir galeria.');
    }
  }

  function abrirInserirImagem() {
    Alert.alert('Inserir imagem', 'Escolha a origem da imagem.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Câmera', onPress: tirarFotoInserir },
      { text: 'Galeria', onPress: selecionarDaGaleriaInserir },
    ]);
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
    // Lê o HTML direto do editor no momento de salvar (não guarda em state a
    // cada digitação) — evita qualquer risco de salvar uma versão
    // desatualizada por causa de uma atualização de state ainda em trânsito.
    const conteudoHtml = (await editor.getHTML()) || '';
    const textoSemFormatacao = conteudoHtml.replace(/<[^>]*>/g, '').trim();
    if (!textoSemFormatacao) {
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
      const conteudoFinal = `${introducao}\n\n${conteudoHtml.trim()}`;
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
          <View style={s.editorHintBox}>
            <Text style={s.editorHintText}>
              Escreva livremente abaixo. Toque no texto pra abrir a barra de
              formatação no rodapé da tela — selecione um trecho e toque num
              botão (negrito, itálico, sublinhado, tachado, títulos, listas,
              link, cor, marca-texto ou inserir imagem) pra aplicar só
              naquele trecho.
            </Text>
          </View>

          {/* ─── editor rico de verdade (TipTap/ProseMirror via WebView) ───
              Bold/itálico/etc. aplicam na seleção real do editor, não
              dependem do estado de seleção instável do TextInput do RN — é o
              que fazia negrito "não funcionar" no editor antigo. A caixa
              cresce com dynamicHeight (ver comentário no useEditorBridge) —
              quem rola pra ver o documento inteiro é este ScrollView. */}
          <View style={s.editorBox}>
            <RichText editor={editor} style={s.editorInput} />
          </View>
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

      {/* ─── barra de formatação, fora do ScrollView, presa ao rodapé ───
          A própria lib só a mostra quando o teclado está aberto e o editor
          está focado (ver Toolbar.tsx) — ficando fora do scroll, continua
          alcançável mesmo depois de rolar bem para baixo num documento longo.
          A barra extra (cor/marca-texto/imagem) fica acima dela, formando
          uma faixa só, com a mesma regra de exibição. */}
      <BarraFormatacaoExtra
        editor={editor}
        visivel={barraExtraVisivel}
        onInserirImagem={abrirInserirImagem}
        desabilitado={!!processando}
      />
      <Toolbar editor={editor} />
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
  editorHintBox: {
    backgroundColor: '#E4EFE9',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#497363',
    marginBottom: 4,
  },
  editorHintText: { fontSize: 12, color: '#497363', lineHeight: 17 },

  // `editorBox` cresce naturalmente pra caber o conteúdo (dynamicHeight,
  // ver comentário no useEditorBridge) — sem altura fixa, senão documentos
  // maiores que a caixa ficariam sem nenhum jeito de rolar até o final.
  editorBox: {
    backgroundColor: '#FDFCFA',
    borderWidth: 1,
    borderColor: '#EAE5DC',
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 300,
    marginTop: 4,
  },
  editorInput: {
    flex: 1,
  },

  barraExtra: {
    backgroundColor: '#FDFCFA',
    borderTopWidth: 1,
    borderTopColor: '#EAE5DC',
    maxHeight: 44,
  },
  barraExtraConteudo: {
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  barraExtraLabel: {
    fontSize: 11, fontWeight: '600', color: '#8C857B',
    textTransform: 'uppercase', letterSpacing: 0.3, marginRight: 2,
  },
  swatch: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1, borderColor: '#EAE5DC',
  },
  swatchLimpar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#EAE5DC', backgroundColor: '#F7F5F0',
  },
  swatchAcao: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  barraExtraDivisor: {
    width: 1, height: 22, backgroundColor: '#EAE5DC', marginHorizontal: 4,
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
