// ─── Motor de análise — Perfil por Núcleos Psíquicos ──────────────────────
// Instrumento de apoio à hipótese diagnóstica do clínico; NUNCA emite
// diagnóstico, rótulo ou "score" — mede densidade de referências e
// dinâmica entre núcleos. Toda evidência nasce "pendente" e só o
// terapeuta confirma/rejeita/reclassifica.
//
// Funções puras (sem tocar rede/banco) ficam testáveis isoladamente.
// Só `chamarIAEstruturada` faz rede; nenhuma função aqui importa
// `database.js` no topo do arquivo — expo-sqlite não roda em Jest, então
// qualquer import direto travaria os testes deste módulo.
//
// Provedor de IA para análise de texto (núcleos/objetivo/busca): DeepSeek,
// não Groq — a Groq fica só com a transcrição de áudio (NovaSessaoScreen),
// que é um limite de taxa completamente separado. Migrado porque o tier
// gratuito da Groq para llama-3.3-70b (12K tokens/minuto) não aguenta o
// volume dos prompts de análise, que embutem as rubricas completas.

import { getRubricaSemente, nucleoDiagonalDe } from './rubricas';

const DEEPSEEK_API_KEY = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

const TOKEN_PACIENTE = '[ANALISANTE]';
const NUCLEOS_VALIDOS = ['bem', 'mal', 'mau', 'bom', 'eu_nuclear'];

// ─── Pseudonimização (LGPD) ────────────────────────────────────────────
// v1: troca determinística do nome/primeiro-nome já cadastrado do
// analisante por um token, antes de qualquer chamada à IA externa.
// Não cobre nomes de terceiros citados na fala (limitação conhecida,
// aceita para v1 — ver plano).
export function pseudonimizar(texto, paciente) {
  if (!texto || !paciente?.nome) return texto;
  const nomeCompleto = paciente.nome.trim();
  if (!nomeCompleto) return texto;
  const primeiroNome = nomeCompleto.split(/\s+/)[0];

  let resultado = texto;
  const nomes = [...new Set([nomeCompleto, primeiroNome])].filter(Boolean);
  for (const nome of nomes) {
    const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapado}\\b`, 'gi');
    resultado = resultado.replace(regex, TOKEN_PACIENTE);
  }
  return resultado;
}

/** Reversão só para uso local (nunca reenviar o texto revertido a uma API externa). */
export function reverterPseudonimizacao(texto, paciente) {
  if (!texto || !paciente?.nome) return texto;
  const primeiroNome = paciente.nome.trim().split(/\s+/)[0];
  if (!primeiroNome) return texto;
  return texto.split(TOKEN_PACIENTE).join(primeiroNome);
}

// ─── Segmentação ───────────────────────────────────────────────────────
function extrairTurnos(texto) {
  const ANALYST_PREFIX = /^(A|Analista)\s*:\s*/i;
  const ANALYSAND_PREFIX = /^(P|Paciente|Analisante)\s*:\s*/i;
  const linhas = (texto || '').split('\n');
  const turnos = [];
  let atual = null;

  for (const linha of linhas) {
    const mA = linha.match(ANALYST_PREFIX);
    const mP = linha.match(ANALYSAND_PREFIX);
    if (mA) {
      if (atual) turnos.push(atual);
      atual = { speaker: 'analyst', texto: linha.slice(mA[0].length) };
    } else if (mP) {
      if (atual) turnos.push(atual);
      atual = { speaker: 'analysand', texto: linha.slice(mP[0].length) };
    } else if (atual) {
      atual.texto += `\n${linha}`;
    } else {
      atual = { speaker: 'analyst', texto: linha };
    }
  }
  if (atual) turnos.push(atual);

  return turnos.map((t) => ({ ...t, texto: t.texto.trim() })).filter((t) => t.texto);
}

/**
 * Divide um registro em unidades analisáveis:
 * - transcrição: só as falas do analisante viram unidade; a fala do
 *   analista imediatamente anterior entra como contexto (não é analisada).
 * - anotação de sessão / estudo de caso / outro: parágrafos.
 */
export function segmentarRegistro({ tipoRegistro, conteudo }) {
  const textoLimpo = (conteudo || '').trim();
  if (!textoLimpo) return [];

  if (tipoRegistro === 'transcricao') {
    const turnos = extrairTurnos(textoLimpo);
    const unidades = [];
    turnos.forEach((turno, i) => {
      if (turno.speaker !== 'analysand') return;
      const anterior = i > 0 ? turnos[i - 1] : null;
      unidades.push({
        texto: turno.texto,
        contexto_anterior: anterior
          ? `${anterior.speaker === 'analyst' ? 'Analista' : 'Analisante'}: ${anterior.texto}`
          : null,
        indice: unidades.length,
      });
    });
    return unidades;
  }

  return textoLimpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((texto, indice) => ({ texto, contexto_anterior: null, indice }));
}

// ─── Prompt ─────────────────────────────────────────────────────────────
export function montarPromptAnalise(unidades, rubrica = getRubricaSemente()) {
  const blocosRubrica = Object.entries(rubrica.nucleos)
    .map(([chave, n]) => {
      const indicadores = n.indicadores.map((i) => `    - ${i.codigo}: ${i.descricao}`).join('\n');
      const diferenciais = (n.diferenciais || []).map((d) => `    - ${d}`).join('\n');
      const ancoras = (n.ancoras || [])
        .map((a) => `    - (${a.tipo}${a.aponta_para ? ` → ${a.aponta_para}` : ''}) "${a.texto}"`)
        .join('\n');
      return (
        `Núcleo "${chave}" (${n.numero} · ${n.nome} · moral ${n.moral}):\n` +
        `  Definição: ${n.definicao}\n` +
        (n.regra_pontuacao ? `  Regra: ${n.regra_pontuacao}\n` : '') +
        `  Indicadores:\n${indicadores}\n` +
        (diferenciais ? `  Diferenciais:\n${diferenciais}\n` : '') +
        (ancoras ? `  Âncoras de referência:\n${ancoras}\n` : '')
      );
    })
    .join('\n');

  const promptSistema =
    'Você é um assistente de apoio à hipótese diagnóstica em psicanálise, seguindo ESTRITAMENTE ' +
    'o modelo teórico de "Núcleos Psíquicos" abaixo. Isto NÃO é um diagnóstico — é um mapa de ' +
    'hipóteses baseado em densidade de referências no discurso do analisante.\n\n' +
    `${blocosRubrica}\n` +
    'Regras de prudência (inegociáveis):\n' +
    (rubrica.regras_prudencia || []).map((r) => `- ${r}`).join('\n') +
    '\n\nPara cada unidade de texto numerada, decida se ela contém referência a algum núcleo. ' +
    'Só marque quando houver conteúdo claro — na dúvida, não marque. Cite o trecho EXATAMENTE ' +
    'como aparece no texto original (não parafraseie, não corrija ortografia). Responda SOMENTE ' +
    'em JSON, no formato:\n' +
    '{"evidencias": [{"indice_unidade": 0, "trecho_literal": "...", "nucleo": "bem|mal|mau|bom|eu_nuclear", ' +
    '"indicador": "N1|...|null", "via": "defensiva|elaborativa|null", "intensidade": 0, "confianca": 0.0, ' +
    '"justificativa": "...", "diferenciais_considerados": "..."}]}';

  const promptUsuario = unidades
    .map(
      (u) =>
        `Unidade ${u.indice}${u.contexto_anterior ? ` (contexto anterior: "${u.contexto_anterior}")` : ''}:\n"${u.texto}"`
    )
    .join('\n\n');

  return { promptSistema, promptUsuario };
}

// ─── Chamada à IA (DeepSeek) ────────────────────────────────────────────
// Provedores de LLM costumam limitar tokens por minuto (TPM) — com prompts
// grandes (rubricas completas) e vários registros analisados em sequência,
// é fácil bater no limite. Quando a resposta 429 diz quanto tempo esperar
// ("Please try again in 4.4s"), em vez de falhar de cara, esperamos esse
// tempo e tentamos 1x de novo antes de desistir.
function extrairEsperaRetryMs(corpoErro) {
  const match = /try again in ([\d.]+)s/i.exec(corpoErro || '');
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]) * 1000) + 500;
}

async function requisicaoIA(promptSistema, promptUsuario) {
  return fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: promptUsuario },
      ],
    }),
  });
}

/** Chamada genérica de análise estruturada à IA, com retentativa automática em caso de rate limit (429). */
export async function chamarIAJson(promptSistema, promptUsuario) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('Chave do DeepSeek não configurada.\n\nDefina EXPO_PUBLIC_DEEPSEEK_API_KEY no .env.');
  }

  let resp = await requisicaoIA(promptSistema, promptUsuario);

  if (resp.status === 429) {
    const raw = await resp.text().catch(() => '');
    const esperaMs = extrairEsperaRetryMs(raw);
    if (esperaMs && esperaMs < 30000) {
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
      resp = await requisicaoIA(promptSistema, promptUsuario);
    }
  }

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error('Limite de uso da IA atingido no momento. Aguarde cerca de 1 minuto e tente novamente.');
    }
    const raw = await resp.text().catch(() => '');
    throw new Error(`Erro da IA (${resp.status}): ${raw}`);
  }

  const data = await resp.json();
  const conteudo = data?.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(conteudo);
  } catch {
    throw new Error('Resposta da IA não é um JSON válido.');
  }
}

export async function chamarIAEstruturada(promptSistema, promptUsuario) {
  return chamarIAJson(promptSistema, promptUsuario);
}

// ─── Validação de evidência ─────────────────────────────────────────────
/**
 * Aceita a evidência só se o trecho citado existir literalmente no texto
 * de origem (já revertida a pseudonimização) — nunca aceitar trecho
 * inventado. Retorna a evidência normalizada, ou null se inválida.
 */
export function validarEvidencia(evidenciaBruta, textoOriginal) {
  if (!evidenciaBruta || typeof evidenciaBruta.trecho_literal !== 'string') return null;
  const trecho = evidenciaBruta.trecho_literal.trim();
  if (!trecho || !textoOriginal) return null;

  const posicaoInicio = textoOriginal.indexOf(trecho);
  if (posicaoInicio === -1) return null;

  if (!NUCLEOS_VALIDOS.includes(evidenciaBruta.nucleo)) return null;

  const intensidade = Number(evidenciaBruta.intensidade);
  if (!Number.isFinite(intensidade) || intensidade < 0 || intensidade > 3) return null;

  const confiancaBruta = Number(evidenciaBruta.confianca);
  const confianca = Number.isFinite(confiancaBruta) ? Math.min(1, Math.max(0, confiancaBruta)) : 0.5;

  const via = ['defensiva', 'elaborativa'].includes(evidenciaBruta.via) ? evidenciaBruta.via : null;

  return {
    trecho_literal: trecho,
    posicao_inicio: posicaoInicio,
    posicao_fim: posicaoInicio + trecho.length,
    nucleo: evidenciaBruta.nucleo,
    indicador: evidenciaBruta.indicador || null,
    via,
    intensidade,
    confianca,
    justificativa: evidenciaBruta.justificativa || '',
    diferenciais_considerados: evidenciaBruta.diferenciais_considerados || '',
  };
}

// ─── Transições ─────────────────────────────────────────────────────────
/** Instâncias cujo conjunto de 3 núcleos contém os dois núcleos informados. */
export function instanciasCandidatas(nucleoA, nucleoB, rubrica = getRubricaSemente()) {
  return Object.entries(rubrica.instancias)
    .filter(([, inst]) => inst.nucleos.includes(nucleoA) && inst.nucleos.includes(nucleoB))
    .map(([chave]) => chave);
}

/**
 * Detecta transições (mudança de núcleo) numa sequência de evidências já
 * ordenada pela posição no discurso. `asa_mediadora` fica em aberto para
 * transições não-diagonais (mais de uma instância é topologicamente
 * possível — quem decide qual delas é a IA, num segundo passe; ver
 * `instancias_candidatas`). Transição diagonal direta (bem⇄bom, mal⇄mau)
 * é sempre marcada como anômala, mediada pelo Eu nuclear.
 */
export function detectarTransicoes(evidencias, rubrica = getRubricaSemente()) {
  const comNucleo = evidencias.filter((e) => e.nucleo !== 'eu_nuclear');
  const transicoes = [];

  for (let i = 1; i < comNucleo.length; i++) {
    const anterior = comNucleo[i - 1];
    const atual = comNucleo[i];
    if (anterior.nucleo === atual.nucleo) continue;

    const diagonal = nucleoDiagonalDe(anterior.nucleo, rubrica) === atual.nucleo;
    const candidatas = diagonal ? [] : instanciasCandidatas(anterior.nucleo, atual.nucleo, rubrica);
    const gatilhoPorFrustracao = anterior.indicador === 'N1';

    transicoes.push({
      de_nucleo: anterior.nucleo,
      para_nucleo: atual.nucleo,
      evidencia_origem_id: anterior.id || null,
      evidencia_destino_id: atual.id || null,
      gatilho_trecho: gatilhoPorFrustracao ? anterior.trecho_literal : null,
      gatilho_tipo: gatilhoPorFrustracao ? 'frustracao_desejo' : null,
      asa_mediadora: diagonal ? 'eu_nuclear' : null,
      instancias_candidatas: candidatas,
      diagonal_direta: diagonal,
    });
  }

  return transicoes;
}

// ─── Idempotência ───────────────────────────────────────────────────────
/** Ao reanalisar um registro, evidências já validadas pelo terapeuta são preservadas. */
export function evidenciasParaManter(evidenciasExistentes) {
  return (evidenciasExistentes || []).filter((e) => e.status_validacao !== 'pendente');
}
