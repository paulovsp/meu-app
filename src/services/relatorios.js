// Relatórios por analisante, gerados via IA (mesmo motor da Busca Dr.Sig,
// Edge Function `ia-busca` — genérica, só recebe um array de mensagens
// prontas e devolve a resposta, sem saber nada sobre "tipos de relatório").
// A tabela `relatorios` já existe (migration 0016) e nunca tinha sido usada
// por nenhum código — arquiva aqui o que a IA gera, por analisante.
import { supabase } from './supabase';
import {
  getSessions, getRecords, getPatientById, getHistoricoParalizacoes,
  getAppointmentsByPatient, getPagamentosPorPaciente,
} from './database';

export const TIPOS_RELATORIO = [
  { valor: 'ultimas_sessoes', label: 'Resumo das últimas sessões' },
  { valor: 'resumo_geral', label: 'Resumo geral do caso' },
  { valor: 'frequencia', label: 'Relatório de frequência' },
  { valor: 'pagamento', label: 'Relatório de pagamento' },
];

export const OPCOES_ULTIMAS_SESSOES = [1, 2, 3, 5, 10];

const MESES_LABEL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const SYSTEM_PROMPT =
  'Você é o assistente clínico do Dr.Sig, um app de prontuário e agenda pra ' +
  'psicoterapeutas. Gere relatórios claros, objetivos e bem organizados a ' +
  'partir dos dados fornecidos, em português do Brasil. Nunca invente dados ' +
  'que não estejam no material fornecido — se faltar informação, diga que ' +
  'não há registro disso. O relatório é uso interno da profissional, não é ' +
  'lido pelo analisante.';

function formatarData(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

async function montarMensagensUltimasSessoes(paciente, quantidade) {
  const sessoes = (await getSessions(paciente.id)).slice(0, quantidade);
  if (sessoes.length === 0) {
    throw new Error('Este analisante ainda não tem sessões registradas.');
  }
  const corpo = sessoes
    .map((sess, i) => `--- Sessão ${i + 1} (${formatarData(sess.date)}) ---\n${sess.transcript || '(sem transcrição)'}`)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Analisante: ${paciente.nome}.\n\nAbaixo estão as transcrições/anotações das últimas ` +
        `${sessoes.length} sessão(ões), da mais recente pra mais antiga. Escreva um resumo clínico ` +
        `dessas sessões: principais temas trabalhados, movimentos observados, e o que parece relevante ` +
        `acompanhar na próxima sessão.\n\n${corpo}`,
    },
  ];
}

async function montarMensagensResumoGeral(paciente) {
  const [sessoes, registros, paralizacoes] = await Promise.all([
    getSessions(paciente.id),
    getRecords(paciente.id),
    getHistoricoParalizacoes(paciente.id),
  ]);
  if (sessoes.length === 0 && registros.length === 0) {
    throw new Error('Este analisante ainda não tem sessões ou registros.');
  }
  const resumoSessoes = sessoes
    .map((sess, i) => `Sessão ${i + 1} (${formatarData(sess.date)}): ${(sess.transcript || '').slice(0, 800)}`)
    .join('\n\n');
  const resumoRegistros = registros
    .map((r) => `Registro (${formatarData(r.created_at?.slice(0, 10))}) — ${r.title}: ${(r.content || '').slice(0, 400)}`)
    .join('\n');
  const paralizacoesTexto = paralizacoes.length
    ? paralizacoes.map((p) => `Paralização em ${formatarData(p.data_paralizacao)}${p.data_retorno ? `, retorno em ${formatarData(p.data_retorno)}` : ''}`).join('\n')
    : 'Nenhuma paralização registrada.';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Analisante: ${paciente.nome}. Início da análise: ${formatarData(paciente.data_inicio)}.\n\n` +
        `Escreva um resumo geral do caso, cobrindo: motivo de busca/queixa inicial (se identificável), ` +
        `evolução ao longo do tempo, temas centrais e recorrentes, e o estado atual do processo.\n\n` +
        `--- Sessões (${sessoes.length}) ---\n${resumoSessoes || '(nenhuma)'}\n\n` +
        `--- Registros/observações (${registros.length}) ---\n${resumoRegistros || '(nenhum)'}\n\n` +
        `--- Histórico de paralizações ---\n${paralizacoesTexto}`,
    },
  ];
}

async function montarMensagensFrequencia(paciente) {
  const compromissos = await getAppointmentsByPatient(paciente.id);
  if (compromissos.length === 0) {
    throw new Error('Este analisante ainda não tem compromissos na agenda.');
  }
  const contagem = compromissos.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  const lista = compromissos
    .map((c) => `${formatarData(c.date)} ${c.start_time?.slice(0, 5)} — ${c.status}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Analisante: ${paciente.nome}.\n\nEscreva um relatório de frequência a partir dos compromissos ` +
        `abaixo: total de sessões agendadas, realizadas, canceladas e faltas, taxa de comparecimento, e ` +
        `qualquer padrão notável (ex: dias/horários com mais falta).\n\n` +
        `Totais por status: ${JSON.stringify(contagem)}\n\n--- Lista completa ---\n${lista}`,
    },
  ];
}

async function montarMensagensPagamento(paciente) {
  const pagamentos = await getPagamentosPorPaciente(paciente.id);
  if (pagamentos.length === 0) {
    throw new Error('Este analisante ainda não tem histórico de pagamentos.');
  }
  const lista = pagamentos
    .map((p) => `${MESES_LABEL[p.mes]}/${p.ano} — ${p.recebido ? `recebido em ${formatarData(p.data_recebimento?.slice(0, 10))}` : 'em aberto'}${p.valor ? `, R$ ${p.valor}` : ''}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Analisante: ${paciente.nome}.\n\nEscreva um relatório de pagamento a partir do histórico abaixo: ` +
        `pontualidade, meses em aberto, valor total recebido no período, e qualquer padrão de atraso.\n\n${lista}`,
    },
  ];
}

async function montarMensagens(paciente, tipo, parametros) {
  if (tipo === 'ultimas_sessoes') return montarMensagensUltimasSessoes(paciente, parametros?.quantidade || 3);
  if (tipo === 'resumo_geral') return montarMensagensResumoGeral(paciente);
  if (tipo === 'frequencia') return montarMensagensFrequencia(paciente);
  if (tipo === 'pagamento') return montarMensagensPagamento(paciente);
  throw new Error(`Tipo de relatório desconhecido: ${tipo}`);
}

/** Gera um relatório via IA e já arquiva em `relatorios`. Lança erro se a
 * IA falhar (crédito insuficiente, assinatura inativa, etc — mesmo
 * tratamento de erro do restante do app via mensagemDeErro). */
export async function gerarRelatorio(paciente, tipo, parametros = {}) {
  const mensagens = await montarMensagens(paciente, tipo, parametros);

  const { data, error } = await supabase.functions.invoke('ia-busca', { body: { mensagens } });
  if (error) {
    let mensagemErro = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagemErro = corpo.error;
      if (corpo?.assinaturaInativa || corpo?.creditosInsuficientes) {
        const erro2 = new Error(mensagemErro);
        erro2.assinaturaInativa = corpo.assinaturaInativa;
        erro2.creditosInsuficientes = corpo.creditosInsuficientes;
        throw erro2;
      }
    } catch (_) {}
    throw new Error(mensagemErro);
  }

  const conteudo = data?.resposta || '';
  const { data: salvo, error: erroSalvar } = await supabase
    .from('relatorios')
    .insert({
      patient_id: paciente.id,
      tipo,
      parametros: JSON.stringify(parametros),
      conteudo,
      custo_estimado: data?.custo || 0,
    })
    .select()
    .single();
  if (erroSalvar) throw erroSalvar;

  return salvo;
}

export async function listarRelatorios(patientId) {
  const { data, error } = await supabase
    .from('relatorios')
    .select('*')
    .eq('patient_id', patientId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data;
}

export async function deletarRelatorio(id) {
  const { error } = await supabase.from('relatorios').delete().eq('id', id);
  if (error) throw error;
}
