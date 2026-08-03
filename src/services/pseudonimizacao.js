// ─── Pseudonimização pro Busca Dr.Sig ──────────────────────────────────
// Nenhum texto que sai pro provedor de IA (DeepSeek, via ia-busca) pode
// carregar o nome do analisante — nem no contexto montado pelo app, nem
// nas mensagens que a psicanalista digita, nem no que a transcrição da
// sessão eventualmente cita. `criarPseudonimizador(paciente)` devolve um
// par (redigir/restaurar) específico daquele paciente: `redigir` troca o
// nome completo e cada nome isolado (≥3 letras) por um marcador fixo;
// `restaurar` desfaz a troca, pra psicanalista continuar lendo o nome
// real na tela. A busca é insensível a maiúsculas/minúsculas e a acento
// (via normalização NFD, que preserva o comprimento da string — cada
// caractere acentuado vira exatamente uma letra-base + marca combinante
// removida, então os índices encontrados na versão normalizada continuam
// válidos pra recortar o texto original).

export const MARCADOR_ANALISANTE = '[ANALISANTE]';

// Faixa Unicode U+0300 a U+036F: marcas diacríticas combinantes (acentos).
// Escrita via código de ponto de propósito — caractere literal na regex é
// frágil e fácil de corromper na edição do arquivo.
const REGEX_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizarChave(texto) {
  return texto.normalize('NFD').replace(REGEX_DIACRITICOS, '').toLowerCase();
}

function escapeRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nome completo + cada nome isolado (≥3 letras), maior primeiro — pra
 * "joão da silva" ganhar de "joão" quando os dois batem na mesma posição. */
function extrairTermos(nomeCompleto) {
  const chaveNome = normalizarChave((nomeCompleto || '').trim());
  if (!chaveNome) return [];
  const partes = chaveNome.split(/\s+/).filter((p) => p.length >= 3);
  const termos = new Set(partes);
  if (chaveNome.length >= 3) termos.add(chaveNome);
  return Array.from(termos).sort((a, b) => b.length - a.length);
}

export function criarPseudonimizador(paciente) {
  const nomeReal = (paciente?.nome || '').trim();
  const termos = extrairTermos(nomeReal);
  const regex = termos.length
    ? new RegExp(`\\b(?:${termos.map(escapeRegex).join('|')})\\b`, 'g')
    : null;

  function redigir(texto) {
    if (!texto || !regex) return texto || '';
    const chave = normalizarChave(texto);
    let resultado = '';
    let ultimoIndex = 0;
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(chave)) !== null) {
      resultado += texto.slice(ultimoIndex, m.index) + MARCADOR_ANALISANTE;
      ultimoIndex = m.index + m[0].length;
    }
    resultado += texto.slice(ultimoIndex);
    return resultado;
  }

  function restaurar(texto) {
    if (!texto || !nomeReal) return texto || '';
    return texto.split(MARCADOR_ANALISANTE).join(nomeReal);
  }

  return { redigir, restaurar };
}
