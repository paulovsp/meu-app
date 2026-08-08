// ─── Busca Dr.Sig: chatbot com acesso ao histórico dos analisantes ──────
// Não manda nenhum resumo pronto de "todos os pacientes" a cada pergunta —
// só busca (e envia pra IA) os dados do analisante identificado NA PERGUNTA
// em si (por nome), nada além disso. E antes de gastar crédito de verdade,
// calcula um orçamento estimado (pior caso, sem desconto de cache) pra
// psicanalista confirmar ou não — só chama a IA depois da confirmação.
import { listarPacientes, getSessions, getRecords } from './database';
import { calcularAnosEMeses } from './validacao';
import { criarPseudonimizador } from './pseudonimizacao';

export class CreditosInsuficientesError extends Error {}
export class AssinaturaInativaError extends Error {}

const MAX_ITENS_POR_PACIENTE = 30;
const TRUNCAR_SESSAO = 600;
const TRUNCAR_REGISTRO = 500;

// Espelha os preços da Edge Function `ia-busca` (DeepSeek V4-Flash, por 1M
// tokens) — só pra estimar o orçamento ANTES da chamada. O custo real
// (com desconto de cache, se houver) vem na resposta da própria função.
const PRECO_INPUT_POR_1M = 0.14;
const PRECO_OUTPUT_POR_1M = 0.28;
const MAX_TOKENS_RESPOSTA = 3000;

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatarDataBR(dataStr) {
  if (!dataStr) return '-';
  try {
    return new Date(dataStr).toLocaleDateString('pt-BR');
  } catch {
    return dataStr;
  }
}

function truncar(texto, max) {
  const limpo = (texto || '').trim();
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo;
}

/** Acha, por nome, o analisante mencionado na pergunta — casamento simples
 * (nome completo ou primeiro nome, ≥3 letras) contra a lista de pacientes
 * do usuário (consulta leve: só nome/id, sem sessões/registros). Se não
 * achar ninguém, a pergunta segue sem contexto de paciente nenhum. */
export async function identificarPacienteNaPergunta(pergunta) {
  const pacientes = await listarPacientes();
  const perguntaLower = (pergunta || '').toLowerCase();
  return (
    pacientes.find((p) => {
      const nomeLower = (p.nome || '').trim().toLowerCase();
      if (!nomeLower) return false;
      if (perguntaLower.includes(nomeLower)) return true;
      const primeiroNome = nomeLower.split(/\s+/)[0];
      return primeiroNome.length >= 3 && perguntaLower.includes(primeiroNome);
    }) || null
  );
}

function tokenizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[^\x00-\x7F]/g, '')
    .match(/[a-z0-9]{3,}/g) || [];
}

/** Escolhe os itens mais relevantes pra pergunta dentre TODO o histórico
 * (não só os mais recentes) — antes disso, um paciente com 200+ sessões
 * nunca tinha as sessões antigas nem consideradas, só as ~30 últimas
 * (item C.6). Pontua por sobreposição de palavras com a pergunta; sem
 * correspondência (pergunta genérica tipo "como ele está indo"), cai pro
 * comportamento anterior — os mais recentes primeiro. */
function selecionarItensRelevantes(itensOrdenados, queryTexto, limite) {
  if (itensOrdenados.length <= limite) return itensOrdenados;

  const tokensQuery = new Set(tokenizar(queryTexto));
  if (tokensQuery.size === 0) return itensOrdenados.slice(0, limite);

  const pontuados = itensOrdenados.map((item, index) => {
    const tokensItem = tokenizar(item.texto);
    let pontuacao = 0;
    for (const t of tokensItem) if (tokensQuery.has(t)) pontuacao++;
    return { item, pontuacao, index };
  });

  const relevantes = pontuados.filter((p) => p.pontuacao > 0);
  if (relevantes.length === 0) return itensOrdenados.slice(0, limite);

  relevantes.sort((a, b) => (b.pontuacao - a.pontuacao) || (a.index - b.index));
  const selecionados = relevantes.slice(0, limite).map((p) => p.item);

  // Preenche o resto do orçamento com os mais recentes que ainda não
  // entraram, pra sempre ter algum contexto temporal mesmo quando a
  // correspondência de palavras é escassa.
  if (selecionados.length < limite) {
    const jaSelecionados = new Set(selecionados);
    for (const item of itensOrdenados) {
      if (selecionados.length >= limite) break;
      if (!jaSelecionados.has(item)) selecionados.push(item);
    }
  }

  const conjuntoFinal = new Set(selecionados);
  return itensOrdenados.filter((item) => conjuntoFinal.has(item));
}

/** Contexto do histórico de UM analisante só — nunca de todos ao mesmo
 * tempo. `queryTexto` (a pergunta atual, ou a pergunta + histórico recente
 * da conversa) guia a seleção por relevância entre TODOS os itens do
 * paciente — sem isso, um histórico longo perderia tudo que não fosse
 * recente. Itens truncados individualmente pra não explodir o tamanho do
 * prompt.
 *
 * O nome do paciente nunca sai daqui: no cabeçalho ele já nasce como
 * `[ANALISANTE]`, e o corpo inteiro (transcrições e registros, onde o
 * nome pode aparecer dito/escrito) passa pela mesma substituição antes
 * de virar prompt. */
export async function montarContextoPaciente(paciente, queryTexto = '') {
  const { redigir } = criarPseudonimizador(paciente);
  const [sessoes, registros] = await Promise.all([
    getSessions(paciente.id),
    getRecords(paciente.id),
  ]);

  const todosItens = [
    ...sessoes.map((s) => ({
      data: s.date,
      texto: `Sessão (${s.type === 'online' ? 'online' : 'presencial'}): ${truncar(s.transcript, TRUNCAR_SESSAO) || '(sem transcrição)'}`,
    })),
    ...registros.map((r) => ({
      data: r.date,
      texto: `${r.type === 'estudo' ? 'Estudo' : 'Registro'}${r.title ? ` — ${r.title}` : ''}: ${truncar(stripHtml(r.content), TRUNCAR_REGISTRO) || '(sem conteúdo)'}`,
    })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));

  const itens = selecionarItensRelevantes(todosItens, queryTexto, MAX_ITENS_POR_PACIENTE);

  const corpo = itens.length
    ? itens.map((i) => `  [${formatarDataBR(i.data)}] ${redigir(i.texto)}`).join('\n')
    : '  (nenhuma sessão ou registro ainda)';

  const idade = calcularAnosEMeses(paciente.nascimento)?.anos;

  return (
    `Histórico de [ANALISANTE] (mais recentes primeiro, alguns trechos truncados):\n` +
    `Idade: ${idade != null ? `${idade} anos` : '-'} · Início do acompanhamento: ${formatarDataBR(paciente.data_inicio)}\n` +
    `${corpo}`
  );
}

function promptSistema(contexto) {
  if (!contexto) {
    return (
      `Você é o "Busca Dr.Sig", assistente de uma psicanalista. Nenhum analisante específico foi ` +
      `identificado nesta pergunta — responda de forma geral, SEM inventar dados de nenhum paciente. ` +
      `Se a pergunta parecer ser sobre um analisante específico, peça pra ela mencionar o nome dele.`
    );
  }
  return (
    `Você é o "Busca Dr.Sig", assistente que ajuda uma psicanalista a consultar o histórico clínico ` +
    `de um analisante específico. Responda em português, tom profissional, baseado ESTRITAMENTE nos ` +
    `dados abaixo — não invente informações, não faça diagnóstico. Se não puder responder com esses ` +
    `dados, diga isso claramente.\n\n${contexto}`
  );
}

function estimarTokens(texto) {
  return Math.ceil((texto || '').length / 3.5);
}

/** Orçamento em US$ (pior caso, sem desconto de cache) do que esta
 * pergunta deve custar — calculado localmente, sem chamar a IA. A
 * psicanalista confirma (ou não) com base nisso antes de qualquer
 * crédito de verdade ser gasto; o custo real (na resposta da Edge
 * Function) pode sair menor, nunca maior. */
export function estimarCustoResposta({ contexto, pergunta, historico }) {
  const textoHistorico = (historico || []).map((m) => m.content).join(' ');
  const tokensEntrada = estimarTokens(contexto) + estimarTokens(pergunta) + estimarTokens(textoHistorico);
  const custoEntrada = (tokensEntrada / 1_000_000) * PRECO_INPUT_POR_1M;
  const custoSaidaMax = (MAX_TOKENS_RESPOSTA / 1_000_000) * PRECO_OUTPUT_POR_1M;
  return custoEntrada + custoSaidaMax;
}

/** `historico` é a lista de mensagens do chat já trocadas ({role, content},
 * sem o system prompt — este é montado aqui com o `contexto` já pronto).
 *
 * `paciente` pode ser null (pergunta sem analisante identificado — nada a
 * redigir). Quando existe, toda mensagem de `historico` é redigida antes
 * do envio (é aqui que o nome escapa se a psicanalista digitou "como está
 * o João?" na própria pergunta — o `contexto` sozinho não cobre isso), e a
 * resposta da IA é restaurada (marcador → nome real) antes de voltar pra
 * tela, de forma transparente pra quem está lendo. */
export async function chamarBuscaChat(contexto, historico, paciente) {
  const { redigir, restaurar } = criarPseudonimizador(paciente);
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.functions.invoke('ia-busca', {
    body: {
      mensagens: [
        { role: 'system', content: promptSistema(contexto) },
        ...historico.map((m) => ({ ...m, content: redigir(m.content) })),
      ],
    },
  });

  if (error) {
    let mensagem = error.message;
    let creditosInsuficientes = false;
    let assinaturaInativa = false;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
      creditosInsuficientes = !!corpo?.creditosInsuficientes;
      assinaturaInativa = !!corpo?.assinaturaInativa;
    } catch (_) {}
    if (assinaturaInativa) throw new AssinaturaInativaError(mensagem);
    if (creditosInsuficientes) throw new CreditosInsuficientesError(mensagem);
    throw new Error(mensagem);
  }
  if (data?.error) throw new Error(data.error);

  return { texto: restaurar(data?.resposta || ''), custo: data?.custo || 0 };
}
