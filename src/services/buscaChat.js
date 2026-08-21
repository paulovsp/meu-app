// ─── Busca Dr.Sig: chatbot com acesso ao histórico dos analisantes ──────
// Não manda nenhum resumo pronto de "todos os pacientes" a cada pergunta —
// só busca (e envia pra IA) os dados do analisante identificado NA PERGUNTA
// em si (por nome), nada além disso. Dentro do analisante identificado,
// manda TODO o histórico (todas as sessões e registros, sem corte de
// quantidade nem de tamanho) — decisão deliberada: essa ferramenta existe
// pra dar à IA o máximo de acesso ao material da profissional, não pra
// economizar tokens escolhendo o que parece mais relevante. E antes de
// gastar crédito de verdade, calcula um orçamento estimado (pior caso, sem
// desconto de cache) pra psicanalista confirmar ou não — só chama a IA
// depois da confirmação.
import { listarPacientes, getSessions, getRecords } from './database';
import { calcularAnosEMeses } from './validacao';
import { criarPseudonimizador } from './pseudonimizacao';

export class CreditosInsuficientesError extends Error {}
export class AssinaturaInativaError extends Error {}

// Espelha os preços da Edge Function `ia-busca` (DeepSeek V4-Flash, por 1M
// tokens) — só pra estimar o orçamento ANTES da chamada. O custo real
// (com desconto de cache, se houver) vem na resposta da própria função.
const PRECO_INPUT_POR_1M = 0.14;
const PRECO_OUTPUT_POR_1M = 0.28;
// Teto de saída maior que o padrão da Edge Function — perguntas que pedem
// leitura clínica podem precisar de uma resposta bem mais longa que uma
// resposta factual simples.
const MAX_TOKENS_RESPOSTA = 6000;

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

// Sem tirar acento, "joão" digitado como "joao" (ou vice-versa — autocorrigido
// pelo teclado, por exemplo) nunca casava com o nome cadastrado, e a
// pergunta caía sem contexto nenhum de paciente — o sintoma era o chatbot
// parecendo "não integrado ao app".
function normalizarAcento(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Acha, por nome, o analisante mencionado na pergunta — casamento simples
 * (nome completo ou primeiro nome, ≥3 letras) contra a lista de pacientes
 * do usuário (consulta leve: só nome/id, sem sessões/registros), ignorando
 * acento dos dois lados. Se achar mais de um candidato possível (dois
 * analisantes com o mesmo primeiro nome, por exemplo) e nenhum bater pelo
 * nome completo, prefere não adivinhar — retorna ambíguo em vez de escolher
 * um dos dois errado. Se não achar ninguém, a pergunta segue sem contexto de
 * paciente nenhum. */
export async function identificarPacienteNaPergunta(pergunta) {
  const pacientes = await listarPacientes();
  const perguntaNorm = normalizarAcento((pergunta || '').toLowerCase());

  const candidatosNomeCompleto = pacientes.filter((p) => {
    const nomeNorm = normalizarAcento((p.nome || '').trim().toLowerCase());
    return nomeNorm && perguntaNorm.includes(nomeNorm);
  });
  if (candidatosNomeCompleto.length === 1) return candidatosNomeCompleto[0];
  if (candidatosNomeCompleto.length > 1) return { ambiguo: true, candidatos: candidatosNomeCompleto };

  const candidatosPrimeiroNome = pacientes.filter((p) => {
    const nomeNorm = normalizarAcento((p.nome || '').trim().toLowerCase());
    const primeiroNome = nomeNorm.split(/\s+/)[0] || '';
    return primeiroNome.length >= 3 && perguntaNorm.includes(primeiroNome);
  });
  if (candidatosPrimeiroNome.length === 1) return candidatosPrimeiroNome[0];
  if (candidatosPrimeiroNome.length > 1) return { ambiguo: true, candidatos: candidatosPrimeiroNome };

  return null;
}

/** Contexto do histórico de UM analisante só — nunca de todos ao mesmo
 * tempo. Manda TODAS as sessões e TODOS os registros, sem seleção por
 * relevância nem corte de tamanho — decisão deliberada (ver comentário no
 * topo do arquivo): a ferramenta existe pra dar o máximo de acesso ao
 * material da profissional, não pra economizar tokens adivinhando o que
 * "parece" relevante pra pergunta.
 *
 * O nome do paciente nunca sai daqui: no cabeçalho ele já nasce como
 * `[ANALISANTE]`, e o corpo inteiro (transcrições e registros, onde o
 * nome pode aparecer dito/escrito) passa pela mesma substituição antes
 * de virar prompt. */
export async function montarContextoPaciente(paciente) {
  const { redigir } = criarPseudonimizador(paciente);
  const [sessoes, registros] = await Promise.all([
    getSessions(paciente.id),
    getRecords(paciente.id),
  ]);

  const todosItens = [
    ...sessoes.map((s) => ({
      data: s.date,
      texto: `Sessão (${s.type === 'online' ? 'online' : 'presencial'}): ${s.transcript || '(sem transcrição)'}`,
    })),
    ...registros.map((r) => ({
      data: r.date,
      texto: `${r.type === 'estudo' ? 'Estudo' : 'Registro'}${r.title ? ` — ${r.title}` : ''}: ${stripHtml(r.content) || '(sem conteúdo)'}`,
    })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));

  const corpo = todosItens.length
    ? todosItens.map((i) => `  [${formatarDataBR(i.data)}] ${redigir(i.texto)}`).join('\n')
    : '  (nenhuma sessão ou registro ainda)';

  const idade = calcularAnosEMeses(paciente.nascimento)?.anos;

  return (
    `Histórico completo de [ANALISANTE] (todas as sessões e registros, mais recentes primeiro):\n` +
    `Idade: ${idade != null ? `${idade} anos` : '-'} · Início do acompanhamento: ${formatarDataBR(paciente.data_inicio)}\n` +
    `${corpo}`
  );
}

function promptSistema(contexto) {
  if (!contexto) {
    return (
      `Você está sendo acessado pelo aplicativo Dr.Sig, através da funcionalidade "Busca Dr.Sig" — uma ` +
      `ferramenta de consulta ao histórico clínico de UM analisante específico. Nenhum analisante foi ` +
      `identificado nesta pergunta — não invente dados de nenhum paciente. Peça pra a psicanalista ` +
      `mencionar o nome do analisante sobre quem quer consultar.`
    );
  }
  return (
    `Você está sendo acessado pelo aplicativo Dr.Sig, através da funcionalidade "Busca Dr.Sig" — uma ` +
    `ferramenta de consulta ao histórico clínico de UM analisante específico.\n\n` +
    `Escopo estrito: você SÓ responde perguntas relacionadas diretamente ao histórico clínico do ` +
    `analisante identificado — conteúdo de sessões, registros, frequência, dados cadastrais básicos ` +
    `(idade, início do acompanhamento, paralisações). Qualquer pergunta fora desse escopo — assuntos ` +
    `gerais, aconselhamento pessoal ao profissional, tópicos sem relação com o analisante em questão — ` +
    `deve ser recusada explicitamente, dizendo que está fora do escopo desta ferramenta, sem tentar ` +
    `responder de outra forma.\n\n` +
    `Todo o histórico disponível do analisante (todas as sessões e todos os registros, sem cortes) ` +
    `está abaixo, em ordem cronológica.\n\n` +
    `Responda com base estritamente nesse material, sob perspectiva psicanalítica ampla e detalhista ` +
    `quando a pergunta pedir leitura clínica. Nunca invente informações ausentes do material. Nunca ` +
    `emita diagnóstico psiquiátrico ou classificação nosológica. Se o material não permitir responder, ` +
    `diga isso claramente.\n\n${contexto}`
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
      maxTokens: MAX_TOKENS_RESPOSTA,
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
