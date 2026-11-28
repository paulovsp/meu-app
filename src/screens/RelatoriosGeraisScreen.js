// Relatórios gerais da clínica: o consultório inteiro num período —
// semana, mês, ano ou datas livres. A pessoa escolhe o período, confere o
// nome dele por extenso e só então gera; mudar o período apaga o relatório
// da tela, para nunca se ler números de um período achando que são de outro.
// As contas moram em services/relatorioGeral.js.
import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import CabecalhoTela from '../components/CabecalhoTela';
import {
  TIPOS_PERIODO, periodoDe, deslocarReferencia, rotuloPeriodo, marcaPeriodoAtual, validarPeriodo,
  gerarRelatorioGeral, montarTextoRelatorio, formatarReais, labelTipoSessao, labelModalidade,
  DIAS_SEMANA, MESES,
} from '../services/relatorioGeral';
import {
  mascararDataBR, interpretarDataDigitada, dataBRParaISO, dataISOParaBR, dataParaISO,
} from '../services/validacao';
import { mensagemDeErro } from '../services/erros';
import { compartilharTexto } from '../services/compartilhar';

const COLORS = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#EAE5DC',
  textDark: '#302C28',
  textMid: '#756E66',
  textLight: '#8C857B',
  btnBlue: '#497363',
  verde: '#44745B',
  vermelho: '#975451',
  ambar: '#7D6540',
  lavanda: '#6E5A8A',
  azul: '#4D6B88',
};

const TEXTO_BOTAO = {
  semana: 'Gerar relatório desta semana',
  mes: 'Gerar relatório deste mês',
  ano: 'Gerar relatório deste ano',
  personalizado: 'Gerar relatório deste período',
};

function porcentagem(n) {
  return `${String(n).replace('.', ',')}%`;
}

function nomeDoMes({ ano, mes }) {
  return `${MESES[mes]}/${ano}`;
}

function Numero({ valor, rotulo, explicacao, cor }) {
  return (
    <View style={s.numero}>
      <Text style={[s.numeroValor, cor && { color: cor }]}>{valor}</Text>
      <Text style={s.numeroRotulo}>{rotulo}</Text>
      {!!explicacao && <Text style={s.numeroExplicacao}>{explicacao}</Text>}
    </View>
  );
}

function Linha({ rotulo, valor, cor, forte }) {
  return (
    <View style={s.linha}>
      <Text style={[s.linhaRotulo, forte && s.forte]}>{rotulo}</Text>
      <Text style={[s.linhaValor, forte && s.forte, cor && { color: cor }]}>{valor}</Text>
    </View>
  );
}

function Secao({ titulo, children }) {
  return (
    <View style={s.cartao}>
      <Text style={s.cartaoTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

export default function RelatoriosGeraisScreen() {
  const navigation = useNavigation();
  const [tipo, setTipo] = useState('mes');
  const [referencia, setReferencia] = useState(() => new Date());
  const hojeBR = dataISOParaBR(dataParaISO(new Date()));
  const [deTexto, setDeTexto] = useState(() => dataISOParaBR(periodoDe('mes').inicioISO));
  const [ateTexto, setAteTexto] = useState(hojeBR);
  const [personalizadoConfirmado, setPersonalizadoConfirmado] = useState(null);

  const [relatorio, setRelatorio] = useState(null);
  const [gerando, setGerando] = useState(false);

  const periodo = useMemo(() => {
    if (tipo !== 'personalizado') return periodoDe(tipo, referencia);
    return personalizadoConfirmado;
  }, [tipo, referencia, personalizadoConfirmado]);

  // Qualquer mudança no período tira o relatório anterior da tela.
  function trocarTipo(novo) {
    if (novo === tipo) return;
    setTipo(novo);
    setReferencia(new Date());
    setRelatorio(null);
  }

  function andar(passo) {
    setReferencia((r) => deslocarReferencia(tipo, r, passo));
    setRelatorio(null);
  }

  function voltarParaAtual() {
    setReferencia(new Date());
    setRelatorio(null);
  }

  function aoDigitar(setter) {
    return (texto) => {
      setter(mascararDataBR(texto));
      setPersonalizadoConfirmado(null);
      setRelatorio(null);
    };
  }

  function completarData(texto, setter) {
    const lida = interpretarDataDigitada(texto);
    if (lida) setter(lida);
  }

  function confirmarPersonalizado() {
    const de = interpretarDataDigitada(deTexto) || deTexto;
    const ate = interpretarDataDigitada(ateTexto) || ateTexto;
    setDeTexto(de);
    setAteTexto(ate);
    const inicioISO = dataBRParaISO(de);
    const fimISO = dataBRParaISO(ate);
    const erro = validarPeriodo(inicioISO, fimISO);
    if (erro) {
      Alert.alert('Período inválido', erro);
      return;
    }
    setPersonalizadoConfirmado({ tipo: 'personalizado', inicioISO, fimISO });
    setRelatorio(null);
  }

  async function gerar() {
    if (!periodo) return;
    setGerando(true);
    try {
      const rel = await gerarRelatorioGeral(periodo);
      setRelatorio(rel);
    } catch (err) {
      Alert.alert('Não foi possível gerar o relatório', mensagemDeErro(err));
    } finally {
      setGerando(false);
    }
  }

  async function compartilhar() {
    if (!relatorio) return;
    try {
      await compartilharTexto(montarTextoRelatorio(relatorio));
    } catch (err) {
      Alert.alert('Não foi possível compartilhar', mensagemDeErro(err));
    }
  }

  const marcaAtual = periodo && tipo !== 'personalizado' ? marcaPeriodoAtual(periodo) : '';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <CabecalhoTela
        titulo="Relatórios gerais"
        onVoltar={() => navigation.goBack()}
        acoes={relatorio ? (
          <TouchableOpacity onPress={compartilhar} style={s.acaoBtn} accessibilityLabel="Compartilhar relatório">
            <Ionicons name="share-social-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.intro}>Relatório da clínica inteira: sessões, recebimentos, pendências e despesas no período que você escolher.</Text>

          <View style={s.tipos}>
            {TIPOS_PERIODO.map((t) => (
              <TouchableOpacity
                key={t.valor}
                style={[s.tipoChip, tipo === t.valor && s.tipoChipAtivo]}
                onPress={() => trocarTipo(t.valor)}
              >
                <Text style={[s.tipoChipTexto, tipo === t.valor && s.tipoChipTextoAtivo]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tipo !== 'personalizado' ? (
            <View style={s.navegador}>
              <TouchableOpacity onPress={() => andar(-1)} style={s.seta} accessibilityLabel="Período anterior">
                <Ionicons name="chevron-back" size={22} color={COLORS.btnBlue} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.navegadorTexto}>{rotuloPeriodo(periodo)}</Text>
                {marcaAtual ? (
                  <Text style={s.navegadorMarca}>{marcaAtual}</Text>
                ) : (
                  <TouchableOpacity onPress={voltarParaAtual}>
                    <Text style={s.navegadorLink}>
                      {tipo === 'semana' ? 'ir para esta semana' : tipo === 'mes' ? 'ir para este mês' : 'ir para este ano'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={() => andar(1)} style={s.seta} accessibilityLabel="Próximo período">
                <Ionicons name="chevron-forward" size={22} color={COLORS.btnBlue} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.cartao}>
              <View style={s.datas}>
                <View style={{ flex: 1 }}>
                  <Text style={s.campoRotulo}>De</Text>
                  <TextInput
                    style={s.campo}
                    value={deTexto}
                    onChangeText={aoDigitar(setDeTexto)}
                    onBlur={() => completarData(deTexto, setDeTexto)}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="number-pad"
                    maxLength={10}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.campoRotulo}>Até</Text>
                  <TextInput
                    style={s.campo}
                    value={ateTexto}
                    onChangeText={aoDigitar(setAteTexto)}
                    onBlur={() => completarData(ateTexto, setAteTexto)}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="number-pad"
                    maxLength={10}
                  />
                </View>
              </View>
              <TouchableOpacity style={s.btnSecundario} onPress={confirmarPersonalizado}>
                <Text style={s.btnSecundarioTexto}>Confirmar período</Text>
              </TouchableOpacity>
            </View>
          )}

          {periodo && (
            <View style={s.confirmacao}>
              <Text style={s.confirmacaoRotulo}>Período selecionado</Text>
              <Text style={s.confirmacaoPeriodo}>{rotuloPeriodo(periodo)}</Text>
              <TouchableOpacity style={[s.btnGerar, gerando && { opacity: 0.6 }]} onPress={gerar} disabled={gerando}>
                {gerando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnGerarTexto}>{TEXTO_BOTAO[tipo]}</Text>}
              </TouchableOpacity>
              {gerando && tipo !== 'semana' && (
                <Text style={s.aviso}>Juntando a agenda e as cobranças de cada mês… pode levar alguns segundos.</Text>
              )}
            </View>
          )}

          {relatorio && <Resultado relatorio={relatorio} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Resultado({ relatorio }) {
  const { sessoes: ss, recebidos, cobrancas, despesas, pessoas, ferias, mesesCobranca } = relatorio;
  const saldo = recebidos.total - despesas.total;
  const tipos = Object.entries(ss.porTipo).sort((a, b) => b[1] - a[1]);
  const modalidades = Object.entries(ss.porModalidade).sort((a, b) => b[1] - a[1]);
  const dias = ss.porDiaSemana.map((n, i) => [i, n]).filter(([, n]) => n > 0);

  return (
    <View>
      <View style={s.resultadoTopo}>
        <Text style={s.resultadoTitulo}>Relatório geral da clínica</Text>
        <Text style={s.resultadoPeriodo}>{rotuloPeriodo(relatorio.periodo)}</Text>
      </View>

      <Secao titulo="Sessões">
        <View style={s.grade}>
          <Numero valor={ss.agendadas} rotulo="Agendadas" explicacao="tudo o que esteve na agenda" />
          <Numero valor={ss.realizadas} rotulo="Feitas" cor={COLORS.verde} />
          <Numero valor={ss.faltas} rotulo="Faltas" explicacao="ou canceladas com cobrança" cor={COLORS.vermelho} />
          <Numero valor={ss.canceladas} rotulo="Canceladas" explicacao="sem cobrança" />
          <Numero valor={ss.desmarcadas} rotulo="Desmarcadas" explicacao="horário apagado ou remarcado no dia" />
          <Numero valor={ss.ferias} rotulo="Em férias" cor={COLORS.lavanda} />
          <Numero valor={ss.aguardando} rotulo="Aguardando confirmação" explicacao="já passaram, sem resposta" cor={COLORS.ambar} />
          <Numero valor={ss.porVir} rotulo="Por vir" cor={COLORS.azul} />
          <Numero valor={ss.temporariamenteLivres} rotulo="Temporariamente livres" explicacao="quinzenais fora da semana" />
        </View>
        {ss.comparecimento != null && (
          <Linha rotulo="Comparecimento (feitas ÷ feitas + faltas)" valor={porcentagem(ss.comparecimento)} forte />
        )}
        {ss.taxaCancelamento != null && (
          <Linha rotulo="Canceladas sem cobrança, entre as já resolvidas" valor={porcentagem(ss.taxaCancelamento)} />
        )}
        <Linha rotulo="Pessoas atendidas (sessões individuais)" valor={String(ss.pessoasAtendidas)} />
        {ss.outros > 0 && <Linha rotulo="Outros compromissos (não são sessão)" valor={String(ss.outros)} />}
      </Secao>

      <Secao titulo="Dinheiro no período">
        <Linha
          rotulo={`Recebido (${recebidos.quantidade} pagamento${recebidos.quantidade === 1 ? '' : 's'} confirmado${recebidos.quantidade === 1 ? '' : 's'})`}
          valor={formatarReais(recebidos.total)}
          cor={COLORS.verde}
          forte
        />
        <Linha rotulo={`Despesas lançadas em Saídas (${despesas.quantidade})`} valor={formatarReais(despesas.total)} cor={COLORS.vermelho} />
        <Linha rotulo="Saldo (recebido − despesas)" valor={formatarReais(saldo)} cor={saldo < 0 ? COLORS.vermelho : COLORS.textDark} forte />
        <Text style={s.nota}>
          Recebido conta pela data em que o pagamento foi marcado como recebido no app.
          {recebidos.semValor > 0 ? ` ${recebidos.semValor} pagamento(s) foram marcados sem valor e não entram na soma.` : ''}
        </Text>
        {recebidos.porPessoa.length > 0 && (
          <>
            <Text style={s.subtitulo}>Quem pagou</Text>
            {recebidos.porPessoa.map((p) => (
              <Linha key={p.nome} rotulo={`${p.nome} (${p.quantidade})`} valor={formatarReais(p.valor)} />
            ))}
          </>
        )}
        {despesas.porCategoria.length > 0 && (
          <>
            <Text style={s.subtitulo}>Despesas por categoria</Text>
            {despesas.porCategoria.map((d) => <Linha key={d.label} rotulo={d.label} valor={formatarReais(d.valor)} />)}
          </>
        )}
      </Secao>

      <Secao titulo={`Cobranças de ${mesesCobranca.map(nomeDoMes).join(', ')}`}>
        <Linha rotulo="Previsto" valor={formatarReais(cobrancas.previsto)} forte />
        <Linha rotulo="Já recebido (confirmado)" valor={formatarReais(cobrancas.recebido)} cor={COLORS.verde} />
        <Linha rotulo="Em aberto, já devia ter entrado" valor={formatarReais(cobrancas.emAtraso)} cor={COLORS.vermelho} />
        <Linha rotulo="A vencer" valor={formatarReais(cobrancas.aVencer)} cor={COLORS.ambar} />
        <Text style={s.nota}>
          Mensalidades entram inteiras, no mês em que são cobradas (como na tela de Cobrança), mesmo que o período escolhido seja só uma semana.
        </Text>
        {cobrancas.pendencias.length > 0 && (
          <>
            <Text style={s.subtitulo}>Em aberto</Text>
            {cobrancas.pendencias.map((p) => (
              <View key={`${p.nome}-${p.ano}-${p.mes}-${p.situacao}`} style={s.pendencia}>
                <View style={{ flex: 1 }}>
                  <Text style={s.pendenciaNome}>{p.nome}</Text>
                  <Text style={s.pendenciaDetalhe}>{nomeDoMes(p)} · {p.detalhe}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.pendenciaValor, { color: p.situacao === 'atrasado' ? COLORS.vermelho : COLORS.ambar }]}>
                    {formatarReais(p.valor)}
                  </Text>
                  <Text style={s.pendenciaDetalhe}>{p.situacao === 'atrasado' ? 'em atraso' : 'a vencer'}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </Secao>

      {ss.realizadas > 0 && (
        <Secao titulo="Sessões feitas, por tipo e dia">
          {tipos.map(([t, n]) => <Linha key={t} rotulo={labelTipoSessao(t)} valor={String(n)} />)}
          <Text style={s.subtitulo}>Modalidade</Text>
          {modalidades.map(([m, n]) => <Linha key={m} rotulo={labelModalidade(m)} valor={String(n)} />)}
          <Text style={s.subtitulo}>Dia da semana</Text>
          {dias.map(([i, n]) => (
            <Linha key={i} rotulo={DIAS_SEMANA[i].charAt(0).toUpperCase() + DIAS_SEMANA[i].slice(1)} valor={String(n)} />
          ))}
        </Secao>
      )}

      {(pessoas.comecaram.length > 0 || pessoas.pararam.length > 0 || pessoas.voltaram.length > 0 || ferias.length > 0) && (
        <Secao titulo="Analisantes e férias">
          {pessoas.comecaram.length > 0 && <Linha rotulo={`Começaram: ${pessoas.comecaram.join(', ')}`} valor={String(pessoas.comecaram.length)} />}
          {pessoas.pararam.length > 0 && <Linha rotulo={`Paralisaram: ${pessoas.pararam.join(', ')}`} valor={String(pessoas.pararam.length)} />}
          {pessoas.voltaram.length > 0 && <Linha rotulo={`Retomaram: ${pessoas.voltaram.join(', ')}`} valor={String(pessoas.voltaram.length)} />}
          {ferias.map((f) => (
            <Linha
              key={`${f.quem}-${f.inicioISO}`}
              rotulo={`Férias — ${f.quem}`}
              valor={`${dataISOParaBR(f.inicioISO).slice(0, 5)} a ${dataISOParaBR(f.fimISO)}${f.paga == null ? '' : f.paga ? ' (paga)' : ' (não paga)'}`}
            />
          ))}
        </Secao>
      )}

      {ss.porPessoa.length > 0 && (
        <Secao titulo="Por analisante">
          {ss.porPessoa.map((p) => (
            <View key={p.chave} style={s.pessoa}>
              <Text style={s.pessoaNome}>{p.nome}</Text>
              <Text style={s.pessoaDetalhe}>
                {[
                  `${p.realizadas} feita${p.realizadas === 1 ? '' : 's'}`,
                  p.faltas ? `${p.faltas} falta${p.faltas === 1 ? '' : 's'}` : null,
                  p.canceladas ? `${p.canceladas} cancelada${p.canceladas === 1 ? '' : 's'}` : null,
                  p.desmarcadas ? `${p.desmarcadas} desmarcada${p.desmarcadas === 1 ? '' : 's'}` : null,
                  p.ferias ? `${p.ferias} em férias` : null,
                  p.aguardando ? `${p.aguardando} aguardando` : null,
                  p.porVir ? `${p.porVir} por vir` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
        </Secao>
      )}

      <Text style={s.rodape}>
        Como contamos: no passado, só o que foi registrado na Agenda. De hoje em diante, também os horários fixos que ainda vão acontecer
        (sem quem está com a análise paralisada). Férias e horários temporariamente livres ficam à parte e não contam como sessão.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 13, color: COLORS.textMid, lineHeight: 19, marginBottom: 12 },
  acaoBtn: { padding: 8 },
  tipos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tipoChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  tipoChipAtivo: { backgroundColor: COLORS.btnBlue, borderColor: COLORS.btnBlue },
  tipoChipTexto: { fontSize: 14, color: COLORS.textDark, lineHeight: 20 },
  tipoChipTextoAtivo: { color: '#FFFFFF', fontWeight: '600' },
  navegador: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 10, marginBottom: 12,
  },
  seta: { paddingHorizontal: 12, paddingVertical: 6 },
  navegadorTexto: { fontSize: 15, fontWeight: '600', color: COLORS.textDark, textAlign: 'center', lineHeight: 21 },
  navegadorMarca: { fontSize: 12, color: COLORS.verde, marginTop: 2, lineHeight: 17 },
  navegadorLink: { fontSize: 12, color: COLORS.btnBlue, marginTop: 2, textDecorationLine: 'underline', lineHeight: 17 },
  datas: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  campoRotulo: { fontSize: 12, color: COLORS.textMid, marginBottom: 4, lineHeight: 17 },
  campo: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: COLORS.textDark, backgroundColor: COLORS.bg,
  },
  btnSecundario: {
    borderWidth: 1, borderColor: COLORS.btnBlue, borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  btnSecundarioTexto: { fontSize: 14, fontWeight: '600', color: COLORS.btnBlue, lineHeight: 20 },
  confirmacao: {
    backgroundColor: '#EEF3EF', borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#C9DACF',
  },
  confirmacaoRotulo: { fontSize: 12, color: COLORS.textMid, lineHeight: 17 },
  confirmacaoPeriodo: { fontSize: 17, fontWeight: '700', color: COLORS.textDark, marginTop: 2, marginBottom: 12, lineHeight: 24 },
  btnGerar: { backgroundColor: COLORS.btnBlue, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnGerarTexto: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', lineHeight: 21 },
  aviso: { fontSize: 12, color: COLORS.textMid, marginTop: 8, textAlign: 'center', lineHeight: 17 },
  resultadoTopo: { marginBottom: 10 },
  resultadoTitulo: { fontSize: 13, color: COLORS.textMid, lineHeight: 19 },
  resultadoPeriodo: { fontSize: 18, fontWeight: '700', color: COLORS.textDark, lineHeight: 25 },
  cartao: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cartaoTitulo: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 10, lineHeight: 21 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 6 },
  numero: { width: '33.33%', paddingHorizontal: 4, paddingVertical: 8 },
  numeroValor: { fontSize: 22, fontWeight: '700', color: COLORS.textDark, lineHeight: 28 },
  numeroRotulo: { fontSize: 12, fontWeight: '600', color: COLORS.textDark, lineHeight: 16 },
  numeroExplicacao: { fontSize: 11, color: COLORS.textLight, lineHeight: 15 },
  linha: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  linhaRotulo: { flex: 1, fontSize: 13, color: COLORS.textDark, lineHeight: 19 },
  linhaValor: { fontSize: 13, color: COLORS.textDark, lineHeight: 19 },
  forte: { fontWeight: '700' },
  subtitulo: { fontSize: 13, fontWeight: '600', color: COLORS.textMid, marginTop: 12, marginBottom: 4, lineHeight: 19 },
  nota: { fontSize: 11, color: COLORS.textLight, marginTop: 6, lineHeight: 16 },
  pendencia: {
    flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  pendenciaNome: { fontSize: 14, fontWeight: '600', color: COLORS.textDark, lineHeight: 20 },
  pendenciaDetalhe: { fontSize: 12, color: COLORS.textMid, lineHeight: 17 },
  pendenciaValor: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  pessoa: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  pessoaNome: { fontSize: 14, fontWeight: '600', color: COLORS.textDark, lineHeight: 20 },
  pessoaDetalhe: { fontSize: 12, color: COLORS.textMid, marginTop: 2, lineHeight: 17 },
  rodape: { fontSize: 11, color: COLORS.textLight, lineHeight: 16, marginTop: 4, marginBottom: 8 },
});
