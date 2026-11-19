import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import CabecalhoTela from '../components/CabecalhoTela';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import {
  criarCurso, editarCurso, removerCurso,
  salvarTranscricaoManual, getCursoById, contarDadosDoCurso,
  calcularCargaHoraria, terminoDerivadoDaAula,
} from '../services/cursos';
import { removerDespesa } from '../services/despesas';
import { formatarMoeda } from '../services/database';
import { mensagemDeErro } from '../services/erros';
import {
  dataBRParaISO, dataISOParaBR, mascararDataBR, interpretarDataDigitada,
} from '../services/validacao';
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

// Mesmo padrão de máscara de data usado em FormularioAnalisanteScreen/
// PerfilScreen/CadastroScreen — insere as barras enquanto digita, sempre
// DD/MM/AAAA (esse campo antes aceitava texto livre em AAAA-MM-DD, o único
// lugar do app fora desse padrão).

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
  const [salvandoTranscricaoManual, setSalvandoTranscricaoManual] = useState(false);

  // Chegando só com o id no params, busca o curso completo pra preencher
  // a tela.
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

  // As anotações das aulas moram na coluna `transcript` do curso — o nome
  // ficou da época em que o app gravava e transcrevia a aula. As
  // transcrições já feitas continuam aqui, editáveis como anotação.
  const [transcricaoManual, setTranscricaoManual] = useState(curso?.transcript || '');

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
      const base = curso ? 'Alterações salvas.' : 'Curso adicionado ao seu currículo.';
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

  /**
   * "Remover do seu currículo?" descrevia tirar uma linha de uma lista de
   * formação. O que a exclusão faz de verdade: apaga as aulas da agenda
   * (`appointments.curso_id` é cascade) e as anotações das aulas, que
   * moram na própria linha do curso.
   *
   * E deixava um rastro ao contrário: a despesa usa `set null`, então
   * sobrevivia órfã em Pagamentos, sem curso nenhum atrás — um valor que
   * ninguém ia lembrar de onde veio. Agora ela entra na pergunta.
   */
  function confirmarRemocao() {
    (async () => {
      let dados = null;
      setRemovendo(true);
      try {
        dados = await contarDadosDoCurso(curso.id);
      } catch (_) {
        // Sem os números o aviso fica genérico, mas continua existindo.
      } finally {
        setRemovendo(false);
      }

      const perdas = [];
      if (dados?.aulas) {
        perdas.push(dados.aulas === 1 ? '1 aula na agenda' : `${dados.aulas} aulas na agenda`);
      }
      if (dados?.temTranscricao) perdas.push('as anotações das aulas');
      const detalhe = perdas.length > 0
        ? `Isto apaga em definitivo ${perdas.join(' e ')}.`
        : 'Isto apaga o curso e tudo que estiver ligado a ele — aulas na agenda e anotações.';

      const seguir = await new Promise((resolve) => {
        Alert.alert(
          `Apagar "${curso.titulo}"?`,
          `${detalhe}\n\nNão há como desfazer.`,
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continuar', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
      if (!seguir) return;

      // A despesa é decisão à parte: ela é um lançamento financeiro que
      // aconteceu de verdade, e apagar o curso não desfaz o gasto.
      let apagarDespesa = false;
      if (dados?.despesa) {
        const escolha = await new Promise((resolve) => {
          Alert.alert(
            'E a despesa deste curso?',
            `Existe uma despesa de ${formatarMoeda(dados.despesa.valor)} lançada em Pagamentos por causa deste curso.`
            + '\n\nO gasto aconteceu de verdade — apagar o curso não o desfaz. Mantê-la preserva o financeiro; apagá-la some com o lançamento.',
            [
              { text: 'Manter a despesa', onPress: () => resolve('manter') },
              { text: 'Apagar também', style: 'destructive', onPress: () => resolve('apagar') },
            ],
            { cancelable: false },
          );
        });
        apagarDespesa = escolha === 'apagar';
      }

      setRemovendo(true);
      try {
        if (apagarDespesa) await removerDespesa(dados.despesa.id);
        await removerCurso(curso.id);
        navigation.goBack();
      } catch (err) {
        Alert.alert('Erro', mensagemDeErro(err));
        setRemovendo(false);
      }
    })();
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
    setSalvandoTranscricaoManual(true);
    try {
      await salvarTranscricaoManual(curso.id, transcricaoManual);
      Alert.alert('Salvo', 'Anotações das aulas salvas.');
    } catch (err) {
      Alert.alert('Erro', mensagemDeErro(err));
    } finally {
      setSalvandoTranscricaoManual(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela titulo="Curso" onVoltar={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
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
          onChangeText={(t) => setData(mascararDataBR(t))}
          onBlur={() => setData((v) => interpretarDataDigitada(v) || v)}
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
            <Text style={s.sectionTitle}>Anotações das aulas</Text>
            <View style={s.gravacaoCard}>
                            <TextInput
                style={[s.input, s.textArea, { minHeight: 160 }]}
                value={transcricaoManual}
                onChangeText={setTranscricaoManual}
                placeholder="Digite ou cole aqui suas anotações das aulas."
                placeholderTextColor="#756E66"
                multiline
              />
              <TouchableOpacity
                style={s.salvarTranscricaoBtn}
                onPress={salvarTranscricaoManualHandler}
                disabled={salvandoTranscricaoManual}
              >
                {salvandoTranscricaoManual ? (
                  <ActivityIndicator color={COLORS.btnBlue} />
                ) : (
                  <Text style={s.salvarTranscricaoBtnText}>Salvar anotações das aulas</Text>
                )}
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
  salvarTranscricaoBtn: {
    marginTop: 12, backgroundColor: COLORS.bg, borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  salvarTranscricaoBtnText: { fontSize: 13, fontWeight: '500', color: COLORS.btnBlue, lineHeight: 19 },
  removerBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 20 },
  removerBtnText: { fontSize: 14, fontWeight: '500', color: '#975451', lineHeight: 20 },
});
