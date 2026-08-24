import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  criarCurso, editarCurso, removerCurso, marcarConsentimentoProfessor,
  transcreverAudioCurso, salvarTranscricaoManual, getCursoById,
  calcularCargaHoraria, terminoDerivadoDaAula,
} from '../services/cursos';
import { mensagemDeErro } from '../services/erros';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { mascararHorario, normalizarHorario } from '../services/horarios';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  btnBlue: '#497363',
};

const FORMATOS = [
  { valor: 'presencial', label: 'Presencial' },
  { valor: 'online_ao_vivo', label: 'Online ao vivo' },
  { valor: 'gravado', label: 'Gravado/EAD' },
];

const RECORDING_OPTIONS = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
};

// Mesmo padrão de máscara de data usado em FormularioAnalisanteScreen/
// PerfilScreen/CadastroScreen — insere as barras enquanto digita, sempre
// DD/MM/AAAA (esse campo antes aceitava texto livre em AAAA-MM-DD, o único
// lugar do app fora desse padrão).
function formatarDataDigitada(texto, setter) {
  const numeros = texto.replace(/\D/g, '');
  let formatado = numeros;
  if (numeros.length >= 3 && numeros.length <= 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
  } else if (numeros.length > 4) {
    formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
  }
  setter(formatado);
}

function formatarTempo(seg) {
  const m = Math.floor(seg / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function FormularioCursoScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const cursoInicial = route.params?.curso || null;
  const cursoIdParam = route.params?.cursoId || null;

  useBloqueioAssinatura(navigation);

  const [curso, setCurso] = useState(cursoInicial);
  const [carregandoCurso, setCarregandoCurso] = useState(!!cursoIdParam && !cursoInicial);
  const [titulo, setTitulo] = useState(cursoInicial?.titulo || '');
  const [professor, setProfessor] = useState(cursoInicial?.professor || '');
  const [instituicao, setInstituicao] = useState(cursoInicial?.instituicao || '');
  // Carga horária deixou de ser digitada: sai de aulas × duração (ver
  // calcularCargaHoraria em services/cursos.js).
  const [quantidadeAulas, setQuantidadeAulas] = useState(cursoInicial?.quantidade_aulas ? String(cursoInicial.quantidade_aulas) : '');
  const [duracaoAulaMin, setDuracaoAulaMin] = useState(cursoInicial?.duracao_aula_min ? String(cursoInicial.duracao_aula_min) : '');
  const [horarioInicio, setHorarioInicio] = useState(cursoInicial?.horario_inicio || '');
  const [horarioFim, setHorarioFim] = useState(cursoInicial?.horario_fim || '');
  const [custo, setCusto] = useState(cursoInicial?.custo ? String(cursoInicial.custo) : '');
  const [formato, setFormato] = useState(cursoInicial?.formato || 'presencial');
  const [local, setLocal] = useState(cursoInicial?.local || '');
  const [data, setData] = useState(cursoInicial?.data ? dataISOParaBR(cursoInicial.data) : '');
  const [anotacoes, setAnotacoes] = useState(cursoInicial?.anotacoes || '');
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  // Chegando por notificação push (curso-transcrever-webhook), só o id vem
  // no params — busca o registro completo pra preencher a tela, mesmo
  // padrão do DetalheSessaoScreen.js com `sessionId`.
  useEffect(() => {
    if (!cursoIdParam || cursoInicial) return;
    getCursoById(cursoIdParam).then((encontrado) => {
      if (!encontrado) return;
      setCurso(encontrado);
      setTitulo(encontrado.titulo || '');
      setProfessor(encontrado.professor || '');
      setInstituicao(encontrado.instituicao || '');
      setQuantidadeAulas(encontrado.quantidade_aulas ? String(encontrado.quantidade_aulas) : '');
      setDuracaoAulaMin(encontrado.duracao_aula_min ? String(encontrado.duracao_aula_min) : '');
      setHorarioInicio(encontrado.horario_inicio || '');
      setHorarioFim(encontrado.horario_fim || '');
      setCusto(encontrado.custo ? String(encontrado.custo) : '');
      setFormato(encontrado.formato || 'presencial');
      setLocal(encontrado.local || '');
      setData(encontrado.data ? dataISOParaBR(encontrado.data) : '');
      setAnotacoes(encontrado.anotacoes || '');
      setTranscricaoManual(encontrado.transcript || '');
    }).finally(() => setCarregandoCurso(false));
  }, [cursoIdParam]);

  const [gravando, setGravando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [enviandoTranscricao, setEnviandoTranscricao] = useState(false);
  const [transcricaoManual, setTranscricaoManual] = useState(curso?.transcript || '');

  const recordingRef = useRef(new Audio.Recording());
  const timerRef = useRef(null);
  const notificationIdRef = useRef(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      notifee.createChannel({ id: 'gravacao_curso', name: 'Gravação de Aula', importance: AndroidImportance.LOW, sound: undefined });
    }
    return () => {
      clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      notifee.stopForegroundService().catch(() => {});
    };
  }, []);

  async function salvar() {
    if (!titulo.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o título do curso.');
      return;
    }
    setSalvando(true);
    try {
      const dados = {
        titulo, professor, instituicao,
        quantidadeAulas: quantidadeAulas ? parseInt(quantidadeAulas, 10) : null,
        duracaoAulaMin: duracaoAulaMin ? parseInt(duracaoAulaMin, 10) : null,
        horarioInicio, horarioFim,
        custo: custo ? parseFloat(custo.replace(',', '.')) : null,
        formato, local: formato === 'presencial' ? local : null,
        data: data ? dataBRParaISO(data) : null, anotacoes,
      };
      const salvo = curso ? await editarCurso(curso.id, dados) : await criarCurso(dados);
      setCurso(salvo);
      // Os campos voltam já normalizados ("845" -> "08:45", carga horária
      // calculada), pra tela refletir o que de fato foi gravado.
      setHorarioInicio(salvo.horario_inicio || '');
      setHorarioFim(salvo.horario_fim || '');

      // O curso é salvo mesmo se a Agenda recusar o horário (colisão com
      // outro compromisso) — nesse caso avisa, em vez de fingir que deu tudo
      // certo ou de perder o cadastro inteiro por causa disso.
      const base = curso ? 'Alterações salvas.' : 'Curso adicionado ao seu currículo. Agora você pode gravar a aula, se quiser.';
      if (salvo._agenda?.ok === false) {
        const detalhe = salvo._agenda.motivo === 'horario_ocupado'
          ? 'Mas o horário não entrou na Agenda: já existe outro compromisso nesse dia e horário.'
          : 'Mas não foi possível colocar o horário na Agenda agora.';
        Alert.alert('Curso salvo', `${base}\n\n${detalhe}`);
      } else {
        const naAgenda = salvo.data && salvo.horario_inicio ? '\n\nO horário foi lançado na Agenda.' : '';
        Alert.alert('Curso salvo', `${base}${naAgenda}`);
      }
    } catch (err) {
      Alert.alert('Erro ao salvar', mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  function confirmarRemocao() {
    Alert.alert('Remover curso', `Remover "${curso.titulo}" do seu currículo?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setRemovendo(true);
          try {
            await removerCurso(curso.id);
            navigation.goBack();
          } catch (err) {
            Alert.alert('Erro', mensagemDeErro(err));
            setRemovendo(false);
          }
        },
      },
    ]);
  }

  function pedirConsentimentoEGravar() {
    Alert.alert(
      'Consentimento do professor',
      'Antes de gravar, confirme com o professor/instituição que você tem autorização para gravar esta aula. A gravação e a transcrição são de uso pessoal — não devem ser divulgadas ou compartilhadas com terceiros, e cuidados legais (direitos autorais, propriedade do material) são de sua responsabilidade.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmo, tenho autorização',
          onPress: async () => {
            try {
              await marcarConsentimentoProfessor(curso.id);
              setCurso((atual) => ({ ...atual, consentimento_professor: true }));
              iniciarGravacao();
            } catch (err) {
              Alert.alert('Erro', mensagemDeErro(err));
            }
          },
        },
      ]
    );
  }

  async function mostrarNotificacao() {
    try {
      await notifee.requestPermission();
      const id = await notifee.displayNotification({
        title: 'Gravando aula',
        body: 'A gravação da aula está em segundo plano.',
        android: {
          channelId: 'gravacao_curso',
          asForegroundService: true,
          foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE],
          ongoing: true,
        },
      });
      notificationIdRef.current = id;
    } catch (_) {}
  }

  async function removerNotificacao() {
    try {
      await notifee.stopForegroundService();
      if (notificationIdRef.current) {
        await notifee.cancelNotification(notificationIdRef.current);
        notificationIdRef.current = null;
      }
    } catch (_) {}
  }

  async function iniciarGravacao() {
    setPreparando(true);
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permissão negada', 'Precisamos de acesso ao microfone.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
      });
      try { await recordingRef.current.stopAndUnloadAsync(); } catch (_) {}
      recordingRef.current = new Audio.Recording();
      await recordingRef.current.prepareToRecordAsync(RECORDING_OPTIONS);
      await recordingRef.current.startAsync();
      setGravando(true);
      setTempo(0);
      timerRef.current = setInterval(() => setTempo((t) => t + 1), 1000);
      await mostrarNotificacao();
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível iniciar a gravação:\n' + err.message);
    } finally {
      setPreparando(false);
    }
  }

  async function encerrarEEnviar() {
    clearInterval(timerRef.current);
    setGravando(false);
    setEnviandoTranscricao(true);
    await removerNotificacao();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false, playsInSilentModeIOS: false,
      shouldDuckAndroid: true, staysActiveInBackground: false,
    });

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      if (!uri) throw new Error('URI do áudio não encontrado após gravação.');
      await transcreverAudioCurso(uri, curso.id);
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (_) {}
      setCurso((atual) => ({ ...atual, transcricao_status: 'processando' }));
      Alert.alert('Enviado', 'A aula foi salva e está sendo transcrita. Você recebe um aviso quando terminar.');
    } catch (err) {
      Alert.alert('Erro ao enviar para transcrição', err.message);
    } finally {
      setEnviandoTranscricao(false);
      recordingRef.current = new Audio.Recording();
    }
  }

  // Horário do curso: mesma digitação por números do resto do app
  // ("1930" -> 19:30). O término sai da duração da aula enquanto a pessoa
  // não digitar um próprio.
  const terminoManualRef = useRef(!!cursoInicial?.horario_fim);

  function aoDigitarHorarioInicio(texto) {
    const mascarado = mascararHorario(texto);
    setHorarioInicio(mascarado);
    if (terminoManualRef.current) return;
    const sugerido = terminoDerivadoDaAula(mascarado, duracaoAulaMin);
    if (sugerido) setHorarioFim(sugerido);
  }

  function aoDigitarHorarioFim(texto) {
    terminoManualRef.current = true;
    setHorarioFim(mascararHorario(texto));
  }

  const cargaHorariaCalculada = calcularCargaHoraria(quantidadeAulas, duracaoAulaMin);

  async function salvarTranscricaoManualHandler() {
    try {
      await salvarTranscricaoManual(curso.id, transcricaoManual);
      Alert.alert('Salvo', 'Transcrição/anotações da aula salvas.');
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Curso" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scrollInner} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Título *</Text>
        <TextInput style={s.input} value={titulo} onChangeText={setTitulo} placeholder="Ex: Formação em Terapia Familiar" placeholderTextColor="#756E66" />

        <Text style={s.label}>Professor</Text>
        <TextInput style={s.input} value={professor} onChangeText={setProfessor} placeholder="Nome do professor" placeholderTextColor="#756E66" />

        <Text style={s.label}>Instituição</Text>
        <TextInput style={s.input} value={instituicao} onChangeText={setInstituicao} placeholder="Nome da instituição" placeholderTextColor="#756E66" />

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Quantidade de aulas</Text>
            <TextInput
              style={s.input}
              value={quantidadeAulas}
              onChangeText={(t) => setQuantidadeAulas(t.replace(/\D/g, ''))}
              placeholder="Ex: 12"
              placeholderTextColor="#756E66"
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Duração da aula (min)</Text>
            <TextInput
              style={s.input}
              value={duracaoAulaMin}
              onChangeText={(t) => setDuracaoAulaMin(t.replace(/\D/g, ''))}
              placeholder="Ex: 90"
              placeholderTextColor="#756E66"
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Text style={s.cargaCalculada}>
          {cargaHorariaCalculada != null
            ? `Carga horária total: ${String(cargaHorariaCalculada).replace('.', ',')}h`
            : 'Carga horária total: informe as aulas e a duração de cada uma.'}
        </Text>

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Horário de início</Text>
            <TextInput
              style={s.input}
              value={horarioInicio}
              onChangeText={aoDigitarHorarioInicio}
              onBlur={() => { const n = normalizarHorario(horarioInicio); if (n) setHorarioInicio(n); }}
              placeholder="1930"
              placeholderTextColor="#756E66"
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Horário de término</Text>
            <TextInput
              style={s.input}
              value={horarioFim}
              onChangeText={aoDigitarHorarioFim}
              onBlur={() => { const n = normalizarHorario(horarioFim); if (n) setHorarioFim(n); }}
              placeholder="21:00"
              placeholderTextColor="#756E66"
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
        </View>
        <Text style={s.cargaCalculada}>
          Com data e horário de início preenchidos, o curso aparece na Agenda.
          O término se preenche sozinho a partir da duração da aula.
        </Text>

        <Text style={s.label}>Custo (R$)</Text>
        <TextInput style={s.input} value={custo} onChangeText={setCusto} placeholder="0,00" placeholderTextColor="#756E66" keyboardType="decimal-pad" />

        <Text style={s.label}>Formato</Text>
        <View style={s.chipsRow}>
          {FORMATOS.map((f) => (
            <TouchableOpacity
              key={f.valor}
              style={[s.chip, formato === f.valor && s.chipAtivo]}
              onPress={() => setFormato(f.valor)}
            >
              <Text style={[s.chipTexto, formato === f.valor && s.chipTextoAtivo]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {formato === 'presencial' && (
          <>
            <Text style={s.label}>Local</Text>
            <TextInput style={s.input} value={local} onChangeText={setLocal} placeholder="Endereço ou nome do local" placeholderTextColor="#756E66" />
          </>
        )}

        <Text style={s.label}>Data</Text>
        <TextInput
          style={s.input}
          value={data}
          onChangeText={(t) => formatarDataDigitada(t, setData)}
          placeholder="DD/MM/AAAA"
          placeholderTextColor="#756E66"
          keyboardType="numeric"
          maxLength={10}
        />

        <Text style={s.label}>Anotações</Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={anotacoes}
          onChangeText={setAnotacoes}
          placeholder="Observações sobre o curso..."
          placeholderTextColor="#756E66"
          multiline
        />

        <TouchableOpacity style={[s.salvarBtn, salvando && { opacity: 0.7 }]} onPress={salvar} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.salvarBtnText}>{curso ? 'Salvar alterações' : 'Adicionar curso'}</Text>}
        </TouchableOpacity>

        {curso && (
          <>
            <Text style={s.sectionTitle}>Gravação e transcrição da aula</Text>
            <View style={s.gravacaoCard}>
              {!gravando && curso.transcricao_status !== 'processando' && (
                <TouchableOpacity
                  style={[s.gravarBtn, preparando && { opacity: 0.7 }]}
                  onPress={pedirConsentimentoEGravar}
                  disabled={preparando}
                >
                  {preparando ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Ionicons name="mic-outline" size={18} color="#FFFFFF" />
                      <Text style={s.gravarBtnText}>Gravar aula</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {gravando && (
                <View style={s.gravandoBox}>
                  <Text style={s.gravandoTimer}>⏱ {formatarTempo(tempo)}</Text>
                  <TouchableOpacity style={s.encerrarBtn} onPress={encerrarEEnviar} disabled={enviandoTranscricao}>
                    {enviandoTranscricao ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.encerrarBtnText}>Encerrar e transcrever</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {curso.transcricao_status === 'processando' && !gravando && (
                <View style={s.statusBox}>
                  <ActivityIndicator color={COLORS.btnBlue} />
                  <Text style={s.statusTexto}>Transcrevendo... você recebe um aviso quando terminar.</Text>
                </View>
              )}
              {curso.transcricao_status === 'erro' && (
                <Text style={s.statusErro}>Não foi possível transcrever a última gravação. Tente novamente.</Text>
              )}

              <Text style={s.label}>Transcrição / anotações da aula</Text>
              <TextInput
                style={[s.input, s.textArea, { minHeight: 160 }]}
                value={transcricaoManual}
                onChangeText={setTranscricaoManual}
                placeholder="A transcrição aparece aqui automaticamente após gravar, ou você pode digitar/colar suas anotações."
                placeholderTextColor="#756E66"
                multiline
              />
              <TouchableOpacity style={s.salvarTranscricaoBtn} onPress={salvarTranscricaoManualHandler}>
                <Text style={s.salvarTranscricaoBtnText}>Salvar transcrição/anotações</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.removerBtn} onPress={confirmarRemocao} disabled={removendo}>
              {removendo ? <ActivityIndicator color="#975451" /> : <Text style={s.removerBtnText}>Remover curso</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scrollInner: { padding: 20, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textDark, marginBottom: 6, marginTop: 14, lineHeight: 19 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark, borderWidth: 1, borderColor: COLORS.border,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 12 },
  cargaCalculada: {
    fontSize: 12, color: COLORS.textMid, fontStyle: 'italic',
    lineHeight: 17, marginTop: 8,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipAtivo: { backgroundColor: COLORS.btnBlue, borderColor: COLORS.btnBlue },
  chipTexto: { fontSize: 12.5, fontWeight: '600', color: COLORS.textMid, lineHeight: 18 },
  chipTextoAtivo: { color: '#FFFFFF' },
  salvarBtn: { backgroundColor: COLORS.btnBlue, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  salvarBtnText: { fontSize: 16, fontWeight: '500', color: '#FFFFFF', lineHeight: 23 },
  sectionTitle: { fontSize: 15, fontWeight: '500', color: COLORS.textDark, marginTop: 28, marginBottom: 10, lineHeight: 22 },
  gravacaoCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  gravarBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: COLORS.btnBlue, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  gravarBtnText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF', lineHeight: 22 },
  gravandoBox: { alignItems: 'center', paddingVertical: 10, gap: 12 },
  gravandoTimer: { fontSize: 30, fontWeight: '500', color: '#975451' },
  encerrarBtn: { backgroundColor: '#975451', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  encerrarBtnText: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', lineHeight: 20 },
  statusBox: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  statusTexto: { fontSize: 13, color: COLORS.textMid, flex: 1, lineHeight: 19 },
  statusErro: { fontSize: 13, color: '#975451', marginBottom: 8, lineHeight: 19 },
  salvarTranscricaoBtn: {
    marginTop: 12, backgroundColor: COLORS.bg, borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  salvarTranscricaoBtnText: { fontSize: 13, fontWeight: '500', color: COLORS.btnBlue, lineHeight: 19 },
  removerBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 20 },
  removerBtnText: { fontSize: 14, fontWeight: '500', color: '#975451', lineHeight: 20 },
});
