// Repetir a consulta que segura o resto de um job.
//
// Sem nada de Deno de propósito: assim a mesma função roda nos testes
// (src/services/__tests__/tentarDeNovo.test.js).
//
// Por quê isso existe: em 12 e 13/09/2026 o `enviar-digest-diario` levou
// 504 ("Gateway Timeout") na PRIMEIRA consulta do dia — a lista de perfis
// que decide para quem o resumo vai. Uma resposta ruim, e o e-mail não
// saiu para ninguém: o laço nem começou (`enviados:0`, `erros:[]` no corpo
// do 500). E como o cron roda uma vez por dia e o `net.http_post` não olha
// a resposta, não havia segunda chance — dois dias de resumo se perderam
// em silêncio. Num job de uma tentativa por dia, a consulta que abre o
// trabalho não pode depender de a rede estar boa naquele segundo.
//
// O que se repete é só o que NÃO veio do Postgres. Erro com `code` é
// resposta do banco (coluna que não existe, permissão negada, dado
// inválido): repetir devolve o mesmo erro, mais devagar. Erro sem `code` —
// ou os PGRST00x, que são de conexão e de fila de conexão — é a resposta
// que não chegou até o banco.

export type ErroConsulta = { code?: string | null; message?: string } | null;

export type Resultado<T> = { data: T; error: ErroConsulta };

const TRANSITORIOS = new Set([
  'PGRST000', // não conseguiu conectar no banco
  'PGRST001', // erro interno de conexão
  'PGRST002', // não conseguiu montar o cache de schema
  'PGRST003', // esperou demais por uma conexão livre no pool
  '08000', '08003', '08006', // a conexão caiu no meio
  '53300', // conexões demais
  '57014', // consulta cancelada por statement_timeout
  // Quando o fetch nem responde, o supabase-js copia `code` do erro do
  // fetch — e um AbortSignal chega como DOMException, que traz o código
  // numérico antigo: 20 = abortado, 23 = estourou o tempo. É exatamente o
  // caso do teto de tempo que quem chama põe na consulta.
  '20', '23',
]);

/** Vale tentar de novo? Erro sem código não veio do banco — é rede ou gateway. */
export function ehTransitorio(erro: ErroConsulta): boolean {
  if (!erro) return false;
  const codigo = erro.code ? String(erro.code) : '';
  return codigo === '' || TRANSITORIOS.has(codigo);
}

/**
 * Executa `montarEExecutar` até `tentativas` vezes enquanto o erro for
 * transitório, esperando um pouco mais a cada vez.
 *
 * `montarEExecutar` monta a consulta de novo a cada chamada porque o
 * builder do supabase-js só pode ser aguardado uma vez — guardar a
 * promessa fora daqui repetiria a MESMA resposta.
 *
 * Exceção (fetch que nem completou) vira `{ error }` com a mensagem, para
 * quem chama tratar os dois casos no mesmo lugar.
 */
export async function tentarDeNovo<T>(
  montarEExecutar: () => Promise<Resultado<T>>,
  opcoes: {
    tentativas?: number;
    esperaMs?: number;
    dormir?: (ms: number) => Promise<void>;
  } = {},
): Promise<Resultado<T>> {
  const tentativas = Math.max(1, opcoes.tentativas ?? 3);
  const esperaMs = opcoes.esperaMs ?? 500;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));

  let ultimo: Resultado<T> = { data: null as unknown as T, error: { message: 'Sem tentativa nenhuma.' } };
  for (let i = 1; i <= tentativas; i++) {
    try {
      ultimo = await montarEExecutar();
    } catch (err) {
      ultimo = { data: null as unknown as T, error: { message: String((err as Error)?.message || err) } };
    }
    if (!ehTransitorio(ultimo.error)) return ultimo;
    if (i < tentativas) await dormir(esperaMs * i);
  }
  return ultimo;
}
