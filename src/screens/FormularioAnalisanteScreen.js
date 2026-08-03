import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  inserirPaciente, editarPaciente, parsePreco,
  getAvailabilitySlotsByPatient, deleteAvailabilitySlotsByPatient,
  resolverConflitoEAdicionarSlot, sincronizarModalidadeCompromissosAgendados,
} from '../services/database';
import {
  MOEDAS, formatarValorMoeda, atualizarCotacao, getCotacaoCacheada, formatarDataCotacao,
} from '../services/currency';
import { mensagemDeErro } from '../services/erros';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';

const DIAS_SEMANA = [
  { valor: 1, label: 'Seg' },
  { valor: 2, label: 'Ter' },
  { valor: 3, label: 'Qua' },
  { valor: 4, label: 'Qui' },
  { valor: 5, label: 'Sex' },
  { valor: 6, label: 'Sáb' },
  { valor: 0, label: 'Dom' },
];

function labelDia(valor) {
  return DIAS_SEMANA.find(d => d.valor === valor)?.label ?? '';
}

export default function FormularioAnalisanteScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  useBloqueioAssinatura(navigation);

  const pacienteExistente = route.params?.paciente ?? null;
  const editando = pacienteExistente !== null;

  const [nome, setNome]           = useState(pacienteExistente?.nome ?? '');
  const [nascimento, setNascimento] = useState(dataISOParaBR(pacienteExistente?.nascimento) || pacienteExistente?.nascimento || '');
  const [dataInicio, setDataInicio] = useState(dataISOParaBR(pacienteExistente?.data_inicio) || pacienteExistente?.data_inicio || '');
  const [dataParalizacao, setDataParalizacao] = useState(dataISOParaBR(pacienteExistente?.data_paralizacao) || pacienteExistente?.data_paralizacao || '');
  const [telefone, setTelefone]   = useState(pacienteExistente?.telefone ?? '');
  const [email, setEmail]         = useState(pacienteExistente?.email ?? '');
  const [cpf, setCpf]             = useState(pacienteExistente?.cpf ?? '');

  const [precoValor, setPrecoValor] = useState(() => {
    const v = parsePreco(pacienteExistente?.preco_sessao);
    return v > 0 ? v : null;
  });
  const [precoMoeda, setPrecoMoeda] = useState(pacienteExistente?.preco_moeda || 'BRL');
  const [cotacao, setCotacao] = useState(null);
  const [buscandoCotacao, setBuscandoCotacao] = useState(false);
  const [erroCotacao, setErroCotacao] = useState(false);

  const [diaPagamento, setDiaPagamento] = useState(
    pacienteExistente?.dia_pagamento ? String(pacienteExistente.dia_pagamento) : ''
  );
  const [tipoCobranca, setTipoCobranca] = useState(pacienteExistente?.tipo_cobranca || 'mensal');
  const [endereco, setEndereco]   = useState(pacienteExistente?.endereco ?? '');
  const [contatoEmergencia, setContatoEmergencia] = useState(pacienteExistente?.contato_emergencia ?? '');
  const [comoChegou, setComoChegou] = useState(pacienteExistente?.como_chegou ?? '');
  const [infoRelevantes, setInfoRelevantes] = useState(pacienteExistente?.info_relevantes ?? '');

  // ── Múltiplos horários da sessão ──
  // cada item: { id, day_of_week, start_time, end_time, modality }
  // `modality` aqui é sempre binário ('online' ou 'presencial') — cada
  // horário é de fato UM ou OUTRO. Não existe mais um campo "Modalidade"
  // manual do paciente — a modalidade geral dele (incl. "Híbrido") é
  // derivada automaticamente a partir da modalidade de cada horário (ver
  // getModalidadeDerivada/getModalidadesPorPaciente em database.js).
  const [horarios, setHorarios] = useState([]);

  useEffect(() => {
    async function carregarHorarios() {
      if (editando && pacienteExistente?.id) {
        try {
          const slots = await getAvailabilitySlotsByPatient(pacienteExistente.id);
          if (slots && slots.length > 0) {
            setHorarios(slots.map(s => ({
              id: s.id,
              day_of_week: s.day_of_week,
              start_time: s.start_time,
              end_time: s.end_time,
              modality: s.modality === 'online' ? 'online' : 'presencial',
            })));
            return;
          }
        } catch (e) {
          Alert.alert('Erro ao carregar horários', mensagemDeErro(e));
        }
      }
      // Nenhum slot cadastrado ainda: começa com um horário vazio
      setHorarios([{ id: Date.now(), day_of_week: 1, start_time: '', end_time: '', modality: 'presencial' }]);
    }
    carregarHorarios();
  }, []);

  // Busca a cotação PTAX (BCB) sempre que a moeda selecionada mudar,
  // para mostrar o equivalente em Reais junto ao preço da sessão.
  useEffect(() => {
    if (precoMoeda === 'BRL') return;
    buscarCotacao(precoMoeda);
  }, [precoMoeda]);

  async function buscarCotacao(moeda) {
    setBuscandoCotacao(true);
    setErroCotacao(false);
    try {
      const resultado = await atualizarCotacao(moeda);
      setCotacao({ valor_brl: resultado.valor, data_cotacao: resultado.data });
    } catch (e) {
      setErroCotacao(true);
      setCotacao(await getCotacaoCacheada(moeda));
    } finally {
      setBuscandoCotacao(false);
    }
  }

  function adicionarHorario() {
    setHorarios(prev => [...prev, {
      id: Date.now(), day_of_week: 1, start_time: '', end_time: '', modality: 'presencial',
    }]);
  }

  function removerHorario(id) {
    setHorarios(prev => prev.length > 1 ? prev.filter(h => h.id !== id) : prev);
  }

  function atualizarHorario(id, campo, valor) {
    setHorarios(prev => prev.map(h => h.id === id ? { ...h, [campo]: valor } : h));
  }

  function formatarHora(texto, id, campo) {
    const numeros = texto.replace(/\D/g, '').slice(0, 4);
    let formatado = numeros;
    if (numeros.length > 2) {
      formatado = `${numeros.slice(0, 2)}:${numeros.slice(2)}`;
    }
    atualizarHorario(id, campo, formatado);
  }

  function formatarData(texto, setter) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length >= 3 && numeros.length <= 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    } else if (numeros.length > 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4, 8)}`;
    }
    setter(formatado);
  }

  function formatarTelefone(texto, setter) {
    const numeros = texto.replace(/\D/g, '');
    let formatado = numeros;
    if (numeros.length > 2 && numeros.length <= 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    } else if (numeros.length > 7) {
      formatado = `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7, 11)}`;
    }
    setter(formatado);
  }

  function formatarCpf(texto) {
    const numeros = texto.replace(/\D/g, '').slice(0, 11);
    let formatado = numeros;
    if (numeros.length > 9) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6, 9)}-${numeros.slice(9)}`;
    } else if (numeros.length > 6) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6)}`;
    } else if (numeros.length > 3) {
      formatado = `${numeros.slice(0, 3)}.${numeros.slice(3)}`;
    }
    setCpf(formatado);
  }

  function alterarPreco(texto) {
    const numeros = texto.replace(/\D/g, '');
    if (!numeros) { setPrecoValor(null); return; }
    setPrecoValor(Number(numeros) / 100);
  }

  function formatarDiaPagamento(texto) {
    const numeros = texto.replace(/\D/g, '').slice(0, 2);
    if (numeros.length === 2 && Number(numeros) > 31) {
      setDiaPagamento(numeros.slice(0, 1));
      return;
    }
    setDiaPagamento(numeros);
  }

  function gerarResumoHorarios(lista) {
    const validos = lista.filter(h => h.start_time && h.start_time.length === 5);
    if (validos.length === 0) return null;
    return validos
      .map(h => `${labelDia(h.day_of_week)} ${h.start_time}`)
      .join(', ');
  }

  function validarHorarios() {
    for (const h of horarios) {
      if (h.start_time && h.start_time.length !== 5) {
        Alert.alert('Horário inválido', 'Preencha o horário no formato HH:MM (ex: 14:00).');
        return false;
      }
      if (h.end_time && h.end_time.length !== 5) {
        Alert.alert('Horário inválido', 'Preencha o horário final no formato HH:MM (ex: 15:00).');
        return false;
      }
    }
    return true;
  }

  async function sincronizarAgenda(patientId) {
    // Remove todos os slots antigos deste paciente e recria com os atuais
    await deleteAvailabilitySlotsByPatient(patientId);
    const validos = horarios.filter(h => h.start_time && h.start_time.length === 5);
    const conflitos = [];

    for (const h of validos) {
      const inicio = h.start_time;
      const fim = h.end_time && h.end_time.length === 5
        ? h.end_time
        : somarUmaHora(inicio);

      // Verifica sobreposição: se houver horário OCUPADO com modalidade
      // compatível, pula este horário e avisa. Se houver apenas horários
      // LIVRES compatíveis sobrepostos, eles são substituídos automaticamente
      // (modalidades incompatíveis, como presencial x online, não conflitam).
      const resultado = await resolverConflitoEAdicionarSlot({
        day_of_week: h.day_of_week,
        start_time: inicio,
        end_time: fim,
        modality: h.modality === 'online' ? 'online' : 'presencial',
        patient_id: patientId,
      });

      if (!resultado.success) {
        conflitos.push(`${labelDia(h.day_of_week)} ${inicio}–${fim}`);
      }
    }

    // Compromissos futuros já criados pra datas específicas não se atualizam
    // sozinhos quando o horário recorrente muda (ver comentário na função) —
    // sem isso, a Agenda continuaria mostrando a modalidade antiga.
    const horariosNormalizados = validos.map((h) => ({
      day_of_week: h.day_of_week,
      start_time: h.start_time,
      modality: h.modality === 'online' ? 'online' : 'presencial',
    }));
    await sincronizarModalidadeCompromissosAgendados(patientId, horariosNormalizados);

    if (conflitos.length > 0) {
      Alert.alert(
        'Conflito de horário',
        `Os seguintes horários já estão ocupados por outro analisante e não foram aplicados:\n\n${conflitos.join('\n')}`
      );
    }
  }

  function somarUmaHora(hora) {
    const [hh, mm] = hora.split(':').map(Number);
    const total = (hh * 60 + mm + 60) % (24 * 60);
    const novaHH = String(Math.floor(total / 60)).padStart(2, '0');
    const novaMM = String(total % 60).padStart(2, '0');
    return `${novaHH}:${novaMM}`;
  }

  async function salvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Por favor, informe o nome do analisante.');
      return;
    }
    if (!validarHorarios()) return;

    const resumoHorario = gerarResumoHorarios(horarios);
    const diaPagamentoNum = Number(diaPagamento) > 0 ? Number(diaPagamento) : null;
    const nascimentoISO = dataBRParaISO(nascimento);
    const dataInicioISO = dataBRParaISO(dataInicio);
    const dataParalizacaoISO = dataBRParaISO(dataParalizacao);

    try {
      let patientId;
      if (editando) {
        patientId = pacienteExistente.id;
        await editarPaciente({
          id: patientId,
          nome: nome.trim(),
          nascimento: nascimentoISO,
          data_inicio: dataInicioISO,
          data_paralizacao: dataParalizacaoISO,
          telefone,
          email: email.trim() || null,
          cpf: cpf.trim() || null,
          horario: resumoHorario,
          preco_sessao: precoValor != null ? String(precoValor) : null,
          preco_moeda: precoMoeda,
          endereco: endereco.trim() || null,
          contato_emergencia: contatoEmergencia.trim() || null,
          como_chegou: comoChegou.trim() || null,
          info_relevantes: infoRelevantes.trim() || null,
          dia_pagamento: tipoCobranca === 'mensal' ? diaPagamentoNum : null,
          tipo_cobranca: tipoCobranca,
        });
      } else {
        patientId = await inserirPaciente({
          nome: nome.trim(),
          nascimento: nascimentoISO,
          data_inicio: dataInicioISO,
          data_paralizacao: dataParalizacaoISO,
          telefone,
          email: email.trim() || null,
          cpf: cpf.trim() || null,
          horario: resumoHorario,
          preco_sessao: precoValor != null ? String(precoValor) : null,
          preco_moeda: precoMoeda,
          endereco: endereco.trim() || null,
          contato_emergencia: contatoEmergencia.trim() || null,
          como_chegou: comoChegou.trim() || null,
          info_relevantes: infoRelevantes.trim() || null,
          dia_pagamento: tipoCobranca === 'mensal' ? diaPagamentoNum : null,
          tipo_cobranca: tipoCobranca,
        });
      }

      await sincronizarAgenda(patientId);

      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
      console.error(e);
    }
  }

  function renderTipoCobrancaOption(key, icon, label) {
    const ativo = tipoCobranca === key;
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.modalidadeOption,
          ativo && styles.modalidadeOptionAtivo
        ]}
        onPress={() => setTipoCobranca(key)}
      >
        <Text style={styles.modalidadeOptionIcon}>{icon}</Text>
        <Text style={[
          styles.modalidadeOptionText,
          ativo && styles.modalidadeOptionTextAtivo
        ]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  function renderHorarioItem(item, index) {
    return (
      <View key={item.id} style={styles.horarioCard}>
        <View style={styles.horarioCardHeader}>
          <Text style={styles.horarioCardTitle}>Horário {index + 1}</Text>
          {horarios.length > 1 && (
            <TouchableOpacity onPress={() => removerHorario(item.id)}>
              <Text style={styles.removerHorarioText}>🗑️ Remover</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.subLabel}>Dia da semana</Text>
        <View style={styles.diasContainer}>
          {DIAS_SEMANA.map(dia => {
            const ativo = item.day_of_week === dia.valor;
            return (
              <TouchableOpacity
                key={dia.valor}
                style={[styles.diaChip, ativo && styles.diaChipAtivo]}
                onPress={() => atualizarHorario(item.id, 'day_of_week', dia.valor)}
              >
                <Text style={[styles.diaChipText, ativo && styles.diaChipTextAtivo]}>
                  {dia.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.horaRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.subLabel}>Início</Text>
            <TextInput
              style={styles.input}
              placeholder="14:00"
              placeholderTextColor="#bbb"
              value={item.start_time}
              onChangeText={(t) => formatarHora(t, item.id, 'start_time')}
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subLabel}>Fim (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="15:00"
              placeholderTextColor="#bbb"
              value={item.end_time}
              onChangeText={(t) => formatarHora(t, item.id, 'end_time')}
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
        </View>

        <Text style={styles.subLabel}>Modalidade deste horário</Text>
        <View style={styles.diasContainer}>
          {[{ valor: 'online', label: '💻 Online' }, { valor: 'presencial', label: '🏥 Presencial' }].map(op => {
            const ativo = (item.modality || 'presencial') === op.valor;
            return (
              <TouchableOpacity
                key={op.valor}
                style={[styles.diaChip, ativo && styles.diaChipAtivo]}
                onPress={() => atualizarHorario(item.id, 'modality', op.valor)}
              >
                <Text style={[styles.diaChipText, ativo && styles.diaChipTextAtivo]}>
                  {op.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editando ? 'Editar Analisante' : 'Novo Analisante'}
        </Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.form,
          { paddingBottom: insets.bottom + 30 }
        ]}
        keyboardShouldPersistTaps="handled"
      >

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Nome do analisante</Text>
          <TextInput
            style={styles.input}
            placeholder="Nome completo do analisante"
            placeholderTextColor="#bbb"
            value={nome}
            onChangeText={setNome}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Data de nascimento</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#bbb"
            value={nascimento}
            onChangeText={(t) => formatarData(t, setNascimento)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Início do acompanhamento</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#bbb"
            value={dataInicio}
            onChangeText={(t) => formatarData(t, setDataInicio)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Paralização da análise</Text>
          <Text style={styles.hint}>
            Preencha só se o acompanhamento estiver parado no momento.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#bbb"
            value={dataParalizacao}
            onChangeText={(t) => formatarData(t, setDataParalizacao)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Telefone / WhatsApp</Text>
          <TextInput
            style={styles.input}
            placeholder="(11) 99999-9999"
            placeholderTextColor="#bbb"
            value={telefone}
            onChangeText={(t) => formatarTelefone(t, setTelefone)}
            keyboardType="phone-pad"
            maxLength={15}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            style={styles.input}
            placeholder="analisante@email.com"
            placeholderTextColor="#bbb"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>CPF</Text>
          <Text style={styles.hint}>
            Necessário para emitir o recibo de prestação de serviços (dedução no IR).
          </Text>
          <TextInput
            style={styles.input}
            placeholder="000.000.000-00"
            placeholderTextColor="#bbb"
            value={cpf}
            onChangeText={formatarCpf}
            keyboardType="numeric"
            maxLength={14}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Endereço</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Endereço completo (se presencial)"
            placeholderTextColor="#bbb"
            value={endereco}
            onChangeText={setEndereco}
            multiline={true}
            numberOfLines={3}
            textAlignVertical="top"
            returnKeyType="next"
          />
        </View>

        {/* ── Horários da sessão (múltiplos, sincronizados com a Agenda) ── */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Horário(s) da sessão</Text>
          <Text style={styles.hint}>
            Esses horários aparecerão automaticamente na Agenda.
          </Text>

          {horarios.map((item, index) => renderHorarioItem(item, index))}

          <TouchableOpacity style={styles.addHorarioBtn} onPress={adicionarHorario}>
            <Text style={styles.addHorarioBtnText}>+ Adicionar outro horário</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Preço da sessão</Text>

          <View style={styles.moedaRow}>
            {MOEDAS.map((m) => (
              <TouchableOpacity
                key={m.codigo}
                style={[styles.moedaChip, precoMoeda === m.codigo && styles.moedaChipAtiva]}
                onPress={() => setPrecoMoeda(m.codigo)}
              >
                <Text style={[styles.moedaChipText, precoMoeda === m.codigo && styles.moedaChipTextAtiva]}>
                  {m.simbolo} {m.codigo}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder={formatarValorMoeda(0, precoMoeda)}
            placeholderTextColor="#bbb"
            value={precoValor != null ? formatarValorMoeda(precoValor, precoMoeda) : ''}
            onChangeText={alterarPreco}
            keyboardType="numeric"
            returnKeyType="next"
          />

          {precoMoeda !== 'BRL' && precoValor != null && (
            <View style={styles.conversaoBox}>
              {buscandoCotacao ? (
                <View style={styles.conversaoLinha}>
                  <ActivityIndicator size="small" color="#3D5A80" />
                  <Text style={styles.conversaoTexto}>Buscando cotação oficial (PTAX/BCB)...</Text>
                </View>
              ) : cotacao?.valor_brl ? (
                <>
                  <Text style={styles.conversaoTexto}>
                    ≈ {formatarValorMoeda(precoValor * cotacao.valor_brl, 'BRL')}
                    {'  '}· 1 {precoMoeda} = {formatarValorMoeda(cotacao.valor_brl, 'BRL')}
                    {cotacao.data_cotacao ? ` (PTAX ${formatarDataCotacao(cotacao.data_cotacao)})` : ''}
                  </Text>
                  {erroCotacao && (
                    <Text style={styles.conversaoAviso}>
                      Não foi possível atualizar agora — mostrando a última cotação conhecida.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.conversaoAviso}>
                  Não foi possível obter a cotação oficial agora.
                </Text>
              )}
              <TouchableOpacity onPress={() => buscarCotacao(precoMoeda)} disabled={buscandoCotacao}>
                <Text style={styles.atualizarCotacaoLink}>🔄 Atualizar cotação</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Tipo de cobrança</Text>
          <View style={styles.modalidadeContainer}>
            {renderTipoCobrancaOption('mensal', '📅', 'Mensal')}
            {renderTipoCobrancaOption('por_sessao', '🧾', 'Por sessão')}
          </View>
        </View>

        {tipoCobranca === 'mensal' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Dia de pagamento</Text>
            <Text style={styles.hint}>
              Dia do mês em que o analisante costuma pagar — usado para marcar a
              data prevista de recebimento no planejamento financeiro.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 10"
              placeholderTextColor="#bbb"
              value={diaPagamento}
              onChangeText={formatarDiaPagamento}
              keyboardType="numeric"
              maxLength={2}
              returnKeyType="next"
            />
          </View>
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Contato de emergência</Text>
          <TextInput
            style={styles.input}
            placeholder="(11) 99999-9999"
            placeholderTextColor="#bbb"
            value={contatoEmergencia}
            onChangeText={(t) => formatarTelefone(t, setContatoEmergencia)}
            keyboardType="phone-pad"
            maxLength={15}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Como chegou</Text>
          <TextInput
            style={styles.input}
            placeholder="Indicação, Instagram, Google..."
            placeholderTextColor="#bbb"
            value={comoChegou}
            onChangeText={setComoChegou}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Informações relevantes</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Anotações importantes sobre o analisante"
            placeholderTextColor="#bbb"
            value={infoRelevantes}
            onChangeText={setInfoRelevantes}
            multiline={true}
            numberOfLines={4}
            textAlignVertical="top"
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={salvar}>
          <Text style={styles.saveBtnText}>
            {editando ? '💾 Salvar alterações' : '✅ Cadastrar analisante'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  backBtn:      { width: 80 },
  backBtnText:  { color: '#3D5A80', fontSize: 15, fontWeight: '600' },
  headerTitle:  { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E' },
  form:         { padding: 24, gap: 20 },
  fieldGroup:   { gap: 6 },
  label: {
    fontSize: 13, fontWeight: '600', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  subLabel: {
    fontSize: 11, fontWeight: '600', color: '#777',
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, marginTop: 6,
  },
  hint:         { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, color: '#1A1A2E',
    borderWidth: 1, borderColor: '#E0E4EA',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  inputMultiline: {
    minHeight: 80,
    paddingTop: 14,
  },

  // Horários
  horarioCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E0E4EA',
    marginBottom: 10,
    gap: 4,
  },
  horarioCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  horarioCardTitle: {
    fontSize: 13, fontWeight: '700', color: '#3D5A80',
  },
  removerHorarioText: {
    fontSize: 12, color: '#d9534f', fontWeight: '600',
  },
  diasContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  diaChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F7FA',
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  diaChipAtivo: {
    backgroundColor: '#3D5A80',
    borderColor: '#3D5A80',
  },
  diaChipText: {
    fontSize: 12, fontWeight: '600', color: '#555',
  },
  diaChipTextAtivo: {
    color: '#fff',
  },
  horaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addHorarioBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  addHorarioBtnText: {
    color: '#3D5A80', fontSize: 14, fontWeight: '700',
  },

  // Modalidade
  modalidadeContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  modalidadeOption: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  modalidadeOptionAtivo: {
    backgroundColor: '#3D5A80',
    borderColor: '#3D5A80',
  },
  modalidadeOptionIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  modalidadeOptionText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '600',
  },
  modalidadeOptionTextAtivo: {
    color: '#fff',
  },

  // Moeda do preço da sessão
  moedaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  moedaChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F5F7FA',
    borderWidth: 1,
    borderColor: '#E0E4EA',
  },
  moedaChipAtiva: {
    backgroundColor: '#3D5A80',
    borderColor: '#3D5A80',
  },
  moedaChipText: {
    fontSize: 12, fontWeight: '600', color: '#555',
  },
  moedaChipTextAtiva: {
    color: '#fff',
  },
  conversaoBox: {
    backgroundColor: '#F0F4F8',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3D5A80',
    gap: 6,
  },
  conversaoLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  conversaoTexto: {
    fontSize: 12.5, color: '#3D5A80', lineHeight: 17,
  },
  conversaoAviso: {
    fontSize: 11.5, color: '#B45309', lineHeight: 16, fontStyle: 'italic',
  },
  atualizarCotacaoLink: {
    fontSize: 12, fontWeight: '700', color: '#3D5A80',
  },

  saveBtn: {
    backgroundColor: '#3D5A80', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 12,
  },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText:{ color: '#999', fontSize: 15 },
});