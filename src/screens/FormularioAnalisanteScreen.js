import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  inserirPaciente, editarPaciente, parsePreco, registrarParalizacaoInicial,
  getAvailabilitySlotsByPatient, deleteAvailabilitySlotsByPatient,
  resolverConflitoEAdicionarSlot, sincronizarModalidadeCompromissosAgendados,
} from '../services/database';
import {
  MOEDAS, formatarValorMoeda, atualizarCotacao, getCotacaoCacheada, formatarDataCotacao,
} from '../services/currency';
import { mensagemDeErro } from '../services/erros';
import { dataBRParaISO, dataISOParaBR } from '../services/validacao';
import TelefoneInput from '../components/TelefoneInput';
import { useBloqueioAssinatura } from '../hooks/useBloqueioAssinatura';
import { mascararHorario, normalizarHorario, horarioValido, terminoPadrao } from '../services/horarios';

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

const SEMANAS_CICLO = [1, 2, 3, 4];

function dataValida(dataBR) {
  const iso = dataBRParaISO(dataBR);
  if (!iso) return false;
  const [ano, mes, dia] = iso.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

export default function FormularioAnalisanteScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  useBloqueioAssinatura(navigation);

  const pacienteExistente = route.params?.paciente ?? null;
  const editando = pacienteExistente !== null;

  // ── Analisante e/ou Supervisionando (não exclusivos, ao menos um marcado) ──
  const [ehAnalisante, setEhAnalisante] = useState(
    pacienteExistente ? pacienteExistente.eh_analisante !== false : true
  );
  const [ehSupervisionando, setEhSupervisionando] = useState(pacienteExistente?.eh_supervisionando === true);

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
  const [valorMensalFixo, setValorMensalFixo] = useState(
    pacienteExistente?.valor_mensal_fixo ? String(pacienteExistente.valor_mensal_fixo).replace('.', ',') : ''
  );
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
  const [salvando, setSalvando] = useState(false);

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
              recorrencia_tipo: s.recorrencia_tipo === 'avulso' ? 'semanal' : (s.recorrencia_tipo || 'semanal'),
              recorrencia_data_referencia: dataISOParaBR(s.recorrencia_data_referencia),
              recorrencia_semanas_ativas: s.recorrencia_semanas_ativas?.length ? s.recorrencia_semanas_ativas : SEMANAS_CICLO,
              // Horário que já existe já tem término escolhido — editar o
              // início não pode sobrescrever isso com o padrão de 50min.
              terminoManual: true,
            })));
            return;
          }
        } catch (e) {
          Alert.alert('Erro ao carregar horários', mensagemDeErro(e));
        }
      }
      // Nenhum slot cadastrado ainda: começa com um horário vazio
      setHorarios([{
        id: Date.now(), day_of_week: 1, start_time: '', end_time: '', modality: 'presencial',
        recorrencia_tipo: 'semanal', recorrencia_data_referencia: '', recorrencia_semanas_ativas: SEMANAS_CICLO,
        terminoManual: false,
      }]);
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

  // ⚠️ CORRIGIDO: analisante e supervisionando eram marcáveis juntos no
  // mesmo cadastro, mas o cadastro só tem UM preço de sessão/tipo de
  // cobrança — pra alguém que é as duas coisas, isso misturava o valor da
  // análise com o da supervisão no cômputo financeiro (Financeiro/
  // Recebíveis/Fiscal usam o mesmo `preco_sessao` pros dois tipos de
  // horário desse paciente). Agora é uma escolha só; quem precisa das duas
  // pontas cria dois cadastros separados (cada um com seu próprio preço,
  // horário e cobrança).
  function selecionarTipoCadastro(tipo) {
    setEhAnalisante(tipo === 'analisante');
    setEhSupervisionando(tipo === 'supervisionando');
  }

  function adicionarHorario() {
    setHorarios(prev => [...prev, {
      id: Date.now(), day_of_week: 1, start_time: '', end_time: '', modality: 'presencial',
      recorrencia_tipo: 'semanal', recorrencia_data_referencia: '', recorrencia_semanas_ativas: SEMANAS_CICLO,
      terminoManual: false,
    }]);
  }

  function removerHorario(id) {
    setHorarios(prev => prev.length > 1 ? prev.filter(h => h.id !== id) : prev);
  }

  function atualizarHorario(id, campo, valor) {
    setHorarios(prev => prev.map(h => h.id === id ? { ...h, [campo]: valor } : h));
  }

  // Digitação livre do horário (ver src/services/horarios.js — "845" vira
  // "8:45" enquanto digita, "08:45" ao sair do campo). O término deste
  // horário se preenche sozinho (início + 50min) enquanto não tiver sido
  // mexido à mão nesta linha específica.
  function digitarInicioHorario(texto, id) {
    const mascarado = mascararHorario(texto);
    setHorarios(prev => prev.map(h => {
      if (h.id !== id) return h;
      const atualizado = { ...h, start_time: mascarado };
      if (!h.terminoManual) {
        const sugerido = terminoPadrao(mascarado);
        if (sugerido) atualizado.end_time = sugerido;
      }
      return atualizado;
    }));
  }

  function digitarFimHorario(texto, id) {
    const mascarado = mascararHorario(texto);
    setHorarios(prev => prev.map(h => (h.id === id ? { ...h, end_time: mascarado, terminoManual: true } : h)));
  }

  function normalizarInicioHorario(id) {
    setHorarios(prev => prev.map(h => {
      if (h.id !== id) return h;
      const normalizado = normalizarHorario(h.start_time);
      if (!normalizado) return h;
      const atualizado = { ...h, start_time: normalizado };
      if (!h.terminoManual) {
        const sugerido = terminoPadrao(normalizado);
        if (sugerido) atualizado.end_time = sugerido;
      }
      return atualizado;
    }));
  }

  function normalizarFimHorario(id) {
    setHorarios(prev => prev.map(h => {
      if (h.id !== id) return h;
      const normalizado = normalizarHorario(h.end_time);
      return normalizado ? { ...h, end_time: normalizado } : h;
    }));
  }

  function formatarDataHorario(texto, id, campo) {
    const numeros = texto.replace(/\D/g, '').slice(0, 8);
    let formatado = numeros;
    if (numeros.length > 2 && numeros.length <= 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    } else if (numeros.length > 4) {
      formatado = `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
    }
    atualizarHorario(id, campo, formatado);
  }

  function alternarSemanaAtivaHorario(id, semana) {
    setHorarios(prev => prev.map(h => {
      if (h.id !== id) return h;
      const atual = h.recorrencia_semanas_ativas || SEMANAS_CICLO;
      const semanas = atual.includes(semana) ? atual.filter(s => s !== semana) : [...atual, semana].sort();
      return { ...h, recorrencia_semanas_ativas: semanas };
    }));
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

  // Normaliza start_time/end_time de toda a lista de uma vez só, no
  // momento de salvar — cobre o caso de a pessoa tocar em "Salvar" sem
  // sair do campo (onBlur não chegou a disparar). Daqui em diante,
  // validação/resumo/sincronização usam sempre esta lista normalizada,
  // nunca o `horarios` do state direto.
  function normalizarListaHorarios(lista) {
    return lista.map(h => ({
      ...h,
      start_time: normalizarHorario(h.start_time) || h.start_time,
      end_time: normalizarHorario(h.end_time) || h.end_time,
    }));
  }

  function validarHorarios(lista) {
    for (const h of lista) {
      if (h.start_time && !horarioValido(h.start_time)) {
        Alert.alert('Horário inválido', 'Preencha o horário no formato HH:MM (ex: 14:00, ou só 1400).');
        return false;
      }
      if (h.end_time && !horarioValido(h.end_time)) {
        Alert.alert('Horário inválido', 'Preencha o horário final no formato HH:MM (ex: 15:00, ou só 1500).');
        return false;
      }
      if (!h.start_time || h.start_time.length !== 5) continue;
      const tipo = h.recorrencia_tipo || 'semanal';
      if ((tipo === 'quinzenal' || tipo === 'personalizada') && !dataValida(h.recorrencia_data_referencia)) {
        Alert.alert('Data inválida', 'Informe a data da 1ª sessão (DD/MM/AAAA) pro horário com recorrência quinzenal/personalizada.');
        return false;
      }
      if (tipo === 'personalizada' && (h.recorrencia_semanas_ativas || []).length === 0) {
        Alert.alert('Semanas obrigatórias', 'Marque ao menos uma semana do ciclo pra recorrência personalizada.');
        return false;
      }
    }
    return true;
  }

  async function sincronizarAgenda(patientId, listaNormalizada) {
    // Remove todos os slots antigos deste paciente e recria com os atuais
    await deleteAvailabilitySlotsByPatient(patientId);
    const validos = listaNormalizada.filter(h => h.start_time && h.start_time.length === 5);
    const conflitos = [];

    for (const h of validos) {
      const inicio = h.start_time;
      const fim = (h.end_time && h.end_time.length === 5)
        ? h.end_time
        : terminoPadrao(inicio);

      // Verifica sobreposição: se houver horário OCUPADO com modalidade
      // compatível, pula este horário e avisa. Se houver apenas horários
      // LIVRES compatíveis sobrepostos, eles são substituídos automaticamente
      // (modalidades incompatíveis, como presencial x online, não conflitam).
      const tipoRecorrencia = h.recorrencia_tipo || 'semanal';
      const recorrencia = tipoRecorrencia === 'semanal'
        ? { tipo: 'semanal' }
        : tipoRecorrencia === 'quinzenal'
          ? { tipo: 'quinzenal', data_referencia: dataBRParaISO(h.recorrencia_data_referencia) }
          : { tipo: 'personalizada', data_referencia: dataBRParaISO(h.recorrencia_data_referencia), semanas_ativas: h.recorrencia_semanas_ativas || SEMANAS_CICLO };

      // ⚠️ CORRIGIDO: horário sempre ia como "sessao_individual" no banco,
      // mesmo pra supervisionando — o tipo aqui precisa seguir o vínculo
      // deste cadastro (ver seletor "Vínculo" acima), senão o horário
      // aparece errado na Agenda e o picker de participantes de um
      // horário de grupo (DisponibilidadeScreen.js) não reconhece essa
      // pessoa como supervisionanda.
      const resultado = await resolverConflitoEAdicionarSlot({
        day_of_week: h.day_of_week,
        start_time: inicio,
        end_time: fim,
        modality: h.modality === 'online' ? 'online' : 'presencial',
        patient_id: patientId,
        recorrencia,
        tipo: ehSupervisionando ? 'supervisao_individual' : 'sessao_individual',
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

  async function salvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Por favor, informe o nome do analisante.');
      return;
    }
    const horariosNormalizados = normalizarListaHorarios(horarios);
    if (!validarHorarios(horariosNormalizados)) return;
    if (tipoCobranca === 'mensal_fixo' && !(Number(valorMensalFixo.replace(',', '.')) > 0)) {
      Alert.alert('Campo obrigatório', 'Informe o valor mensal fixo.');
      return;
    }

    const resumoHorario = gerarResumoHorarios(horariosNormalizados);
    const diaPagamentoNum = Number(diaPagamento) > 0 ? Number(diaPagamento) : null;
    const nascimentoISO = dataBRParaISO(nascimento);
    const dataInicioISO = dataBRParaISO(dataInicio);
    const dataParalizacaoISO = dataBRParaISO(dataParalizacao);

    setSalvando(true);
    try {
      let patientId;
      if (editando) {
        patientId = pacienteExistente.id;
        // data_paralizacao não é enviado aqui: uma vez cadastrado, esse
        // status só muda pelo botão Paralisação/Retorno (ou editando um
        // período no histórico), nunca por "salvar" a ficha — ver
        // editarPaciente em services/database.js.
        await editarPaciente({
          id: patientId,
          eh_analisante: ehAnalisante,
          eh_supervisionando: ehSupervisionando,
          nome: nome.trim(),
          nascimento: nascimentoISO,
          data_inicio: dataInicioISO,
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
          dia_pagamento: tipoCobranca !== 'por_sessao' ? diaPagamentoNum : null,
          tipo_cobranca: tipoCobranca,
          valor_mensal_fixo: valorMensalFixo ? Number(valorMensalFixo.replace(',', '.')) : null,
        });
      } else {
        patientId = await inserirPaciente({
          eh_analisante: ehAnalisante,
          eh_supervisionando: ehSupervisionando,
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
          dia_pagamento: tipoCobranca !== 'por_sessao' ? diaPagamentoNum : null,
          tipo_cobranca: tipoCobranca,
          valor_mensal_fixo: valorMensalFixo ? Number(valorMensalFixo.replace(',', '.')) : null,
        });
        // Só faz sentido na criação: um cadastro novo pode já entrar
        // paralisado (ex: caso antigo importado), e como ainda não existe
        // nenhum botão apertado pra isso, registramos o período aqui.
        if (dataParalizacaoISO) {
          await registrarParalizacaoInicial(patientId, dataParalizacaoISO);
        }
      }

      await sincronizarAgenda(patientId, horariosNormalizados);

      navigation.goBack();
    } catch (e) {
      Alert.alert('Erro ao salvar', mensagemDeErro(e));
      console.error(e);
    } finally {
      setSalvando(false);
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
        <Ionicons name={icon} size={19} color={ativo ? '#FFFFFF' : '#497363'} style={styles.modalidadeOptionIcon} />
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
              <Text style={styles.removerHorarioText}>Remover</Text>
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
              placeholder="1400"
              placeholderTextColor="#A9A299"
              value={item.start_time}
              onChangeText={(t) => digitarInicioHorario(t, item.id)}
              onBlur={() => normalizarInicioHorario(item.id)}
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subLabel}>Fim (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="1450"
              placeholderTextColor="#A9A299"
              value={item.end_time}
              onChangeText={(t) => digitarFimHorario(t, item.id)}
              onBlur={() => normalizarFimHorario(item.id)}
              keyboardType="numeric"
              maxLength={5}
            />
          </View>
        </View>

        <Text style={styles.subLabel}>Modalidade deste horário</Text>
        <View style={styles.diasContainer}>
          {[{ valor: 'online', label: 'Online' }, { valor: 'presencial', label: 'Presencial' }].map(op => {
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

        <Text style={styles.subLabel}>Recorrência</Text>
        <View style={styles.diasContainer}>
          {[{ valor: 'semanal', label: 'Semanal' }, { valor: 'quinzenal', label: 'Quinzenal' }, { valor: 'personalizada', label: 'Personalizada' }].map(op => {
            const ativo = (item.recorrencia_tipo || 'semanal') === op.valor;
            return (
              <TouchableOpacity
                key={op.valor}
                style={[styles.diaChip, ativo && styles.diaChipAtivo]}
                onPress={() => atualizarHorario(item.id, 'recorrencia_tipo', op.valor)}
              >
                <Text style={[styles.diaChipText, ativo && styles.diaChipTextAtivo]}>
                  {op.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {(item.recorrencia_tipo === 'quinzenal' || item.recorrencia_tipo === 'personalizada') && (
          <>
            <Text style={styles.subLabel}>Data da 1ª sessão</Text>
            <TextInput
              style={styles.input}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#A9A299"
              value={item.recorrencia_data_referencia}
              onChangeText={(t) => formatarDataHorario(t, item.id, 'recorrencia_data_referencia')}
              keyboardType="numeric"
              maxLength={10}
            />
          </>
        )}

        {item.recorrencia_tipo === 'personalizada' && (
          <>
            <Text style={styles.subLabel}>Semanas ativas do ciclo</Text>
            <View style={styles.diasContainer}>
              {SEMANAS_CICLO.map(semana => {
                const ativa = (item.recorrencia_semanas_ativas || SEMANAS_CICLO).includes(semana);
                return (
                  <TouchableOpacity
                    key={semana}
                    style={[styles.diaChip, ativa && styles.diaChipAtivo]}
                    onPress={() => alternarSemanaAtivaHorario(item.id, semana)}
                  >
                    <Text style={[styles.diaChipText, ativa && styles.diaChipTextAtivo]}>
                      Semana {semana}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editando ? 'Editar Analisante' : 'Novo Analisante'}
        </Text>
        <View style={{ width: 80 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            placeholderTextColor="#A9A299"
            value={nome}
            onChangeText={setNome}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Vínculo</Text>
          <Text style={styles.hint}>
            Uma escolha só — preço, horário e cobrança deste cadastro valem só pra este papel.
            Se a mesma pessoa for analisante E estiver em supervisão com você, crie um segundo
            cadastro pra supervisão (evita misturar os dois valores no Financeiro).
          </Text>
          <View style={styles.modalidadeContainer}>
            <TouchableOpacity
              style={[styles.modalidadeOption, ehAnalisante && styles.modalidadeOptionAtivo]}
              onPress={() => selecionarTipoCadastro('analisante')}
            >
              <Ionicons name="chatbubble-outline" size={20} color={ehAnalisante ? '#FFFFFF' : '#497363'} style={styles.modalidadeOptionIcon} />
              <Text style={[styles.modalidadeOptionText, ehAnalisante && styles.modalidadeOptionTextAtivo]}>
                Analisante
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalidadeOption, ehSupervisionando && styles.modalidadeOptionAtivo]}
              onPress={() => selecionarTipoCadastro('supervisionando')}
            >
              <Ionicons name="school-outline" size={20} color={ehSupervisionando ? '#FFFFFF' : '#497363'} style={styles.modalidadeOptionIcon} />
              <Text style={[styles.modalidadeOptionText, ehSupervisionando && styles.modalidadeOptionTextAtivo]}>
                Supervisionando
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Data de nascimento</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#A9A299"
            value={nascimento}
            onChangeText={(t) => formatarData(t, setNascimento)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Início da análise</Text>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#A9A299"
            value={dataInicio}
            onChangeText={(t) => formatarData(t, setDataInicio)}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Paralização da análise</Text>
          {editando ? (
            <>
              <Text style={styles.hint}>
                Não editável aqui — use o botão "Paralisação/Retorno da análise" ou o
                histórico de paralisações na tela do analisante.
              </Text>
              <View style={[styles.input, styles.inputSomenteLeitura]}>
                <Text style={styles.inputSomenteLeituraTexto}>
                  {dataParalizacao ? `Pausado desde ${dataParalizacao}` : 'Análise ativa (não pausada)'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Preencha só se o acompanhamento já começar parado (ex: caso antigo importado).
              </Text>
              <TextInput
                style={styles.input}
                placeholder="DD/MM/AAAA"
                placeholderTextColor="#A9A299"
                value={dataParalizacao}
                onChangeText={(t) => formatarData(t, setDataParalizacao)}
                keyboardType="numeric"
                maxLength={10}
                returnKeyType="next"
              />
            </>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Telefone / WhatsApp</Text>
          <TelefoneInput value={telefone} onChangeText={setTelefone} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            style={styles.input}
            placeholder="analisante@email.com"
            placeholderTextColor="#A9A299"
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
            placeholderTextColor="#A9A299"
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
            placeholderTextColor="#A9A299"
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
            placeholderTextColor="#A9A299"
            value={precoValor != null ? formatarValorMoeda(precoValor, precoMoeda) : ''}
            onChangeText={alterarPreco}
            keyboardType="numeric"
            returnKeyType="next"
          />

          {precoMoeda !== 'BRL' && precoValor != null && (
            <View style={styles.conversaoBox}>
              {buscandoCotacao ? (
                <View style={styles.conversaoLinha}>
                  <ActivityIndicator size="small" color="#497363" />
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
                <Text style={styles.atualizarCotacaoLink}>Atualizar cotação</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Tipo de cobrança</Text>
          <View style={styles.modalidadeContainer}>
            {renderTipoCobrancaOption('mensal', 'calendar-outline', 'Mensal variável')}
            {renderTipoCobrancaOption('mensal_fixo', 'cash-outline', 'Mensal fixo')}
            {renderTipoCobrancaOption('por_sessao', 'receipt-outline', 'Por sessão')}
          </View>
        </View>

        {tipoCobranca === 'mensal_fixo' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Valor mensal fixo *</Text>
            <Text style={styles.hint}>
              Valor único cobrado todo mês, independente do número de sessões.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 800,00"
              placeholderTextColor="#A9A299"
              value={valorMensalFixo}
              onChangeText={setValorMensalFixo}
              keyboardType="numeric"
              returnKeyType="next"
            />
          </View>
        )}

        {tipoCobranca !== 'por_sessao' && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Dia de pagamento</Text>
            <Text style={styles.hint}>
              Dia do mês em que o analisante costuma pagar — usado para marcar a
              data prevista de recebimento no planejamento financeiro.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 10"
              placeholderTextColor="#A9A299"
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
          <TelefoneInput value={contatoEmergencia} onChangeText={setContatoEmergencia} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Como chegou</Text>
          <TextInput
            style={styles.input}
            placeholder="Indicação, Instagram, Google..."
            placeholderTextColor="#A9A299"
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
            placeholderTextColor="#A9A299"
            value={infoRelevantes}
            onChangeText={setInfoRelevantes}
            multiline={true}
            numberOfLines={4}
            textAlignVertical="top"
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>
              {editando ? 'Salvar alterações' : 'Cadastrar analisante'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F7F5F0' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FDFCFA', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#EAE5DC',
  },
  backBtn:      { width: 80 },
  backBtnText: { color: '#497363', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  headerTitle:  { fontSize: 17, fontWeight: '500', color: '#302C28' },
  form:         { padding: 24, gap: 20 },
  fieldGroup:   { gap: 6 },
  label: {
    fontSize: 13, fontWeight: '600', color: '#756E66',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  subLabel: {
    fontSize: 11, fontWeight: '600', color: '#8C857B',
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, marginTop: 6,
  },
  hint: { fontSize: 12, color: '#8C857B', marginTop: 4, fontStyle: 'italic', lineHeight: 17 },
  input: {
    backgroundColor: '#FDFCFA', borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, color: '#302C28',
    borderWidth: 1, borderColor: '#EAE5DC',
    shadowColor: '#4E4941', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  inputMultiline: {
    minHeight: 80,
    paddingTop: 14,
  },
  inputSomenteLeitura: { backgroundColor: '#F1EDE5', shadowOpacity: 0.0, elevation: 0 },
  inputSomenteLeituraTexto: { fontSize: 16, color: '#756E66', lineHeight: 23 },

  // Horários
  horarioCard: {
    backgroundColor: '#FDFCFA',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAE5DC',
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
    fontSize: 13, fontWeight: '500', color: '#497363',
  },
  removerHorarioText: {
    fontSize: 12, color: '#975451', fontWeight: '600',
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
    backgroundColor: '#F7F5F0',
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  diaChipAtivo: {
    backgroundColor: '#497363',
    borderColor: '#497363',
  },
  diaChipText: {
    fontSize: 12, fontWeight: '600', color: '#756E66',
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
    color: '#497363', fontSize: 14, fontWeight: '500',
  },

  // Modalidade
  modalidadeContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  modalidadeOption: {
    flex: 1,
    backgroundColor: '#FDFCFA',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  modalidadeOptionAtivo: {
    backgroundColor: '#497363',
    borderColor: '#497363',
  },
  modalidadeOptionIcon: {
    marginBottom: 4,
  },
  modalidadeOptionText: {
    fontSize: 12,
    color: '#756E66',
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
    backgroundColor: '#F7F5F0',
    borderWidth: 1,
    borderColor: '#EAE5DC',
  },
  moedaChipAtiva: {
    backgroundColor: '#497363',
    borderColor: '#497363',
  },
  moedaChipText: {
    fontSize: 12, fontWeight: '600', color: '#756E66',
  },
  moedaChipTextAtiva: {
    color: '#fff',
  },
  conversaoBox: {
    backgroundColor: '#E4EFE9',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#497363',
    gap: 6,
  },
  conversaoLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  conversaoTexto: {
    fontSize: 12.5, color: '#497363', lineHeight: 17,
  },
  conversaoAviso: {
    fontSize: 11.5, color: '#7D6540', lineHeight: 16, fontStyle: 'italic',
  },
  atualizarCotacaoLink: {
    fontSize: 12, fontWeight: '500', color: '#497363',
  },

  saveBtn: {
    backgroundColor: '#497363', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 12,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '500', lineHeight: 23 },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { color: '#8C857B', fontSize: 15, lineHeight: 22 },
});