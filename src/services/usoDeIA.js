// ─── Pode usar IA paga agora? ───────────────────────────────────────────
//
// Uma pergunta só, respondida num lugar só, porque ela é feita em quatro
// telas diferentes (Busca, Relatórios, Nova Sessão, Cursos) e a resposta
// tem que ser a mesma nas quatro.
//
// Quem decide de verdade são as Edge Functions: `ia-busca` e
// `ia-transcrever` conferem assinatura e saldo antes de gastar qualquer
// centavo, e devolvem 403/402. Isto aqui não substitui essa checagem —
// serve pra avisar ANTES, em vez de deixar a pessoa escrever uma pergunta
// inteira, escolher analisante e tipo de relatório, ou gravar uma sessão
// de cinquenta minutos, pra levar o "não" no fim.
//
// ─── Como o saldo acaba ────────────────────────────────────────────────
//
// A regra, do jeito que o servidor a aplica: qualquer saldo POSITIVO
// autoriza a próxima ação, inteira. O custo real só é conhecido depois —
// quantos tokens a resposta usou, quantos minutos o áudio tinha —, e
// interromper uma transcrição no meio porque o crédito acabou seria pior
// do que deixá-la terminar. Então a última ação pode fechar o saldo em
// negativo, e a partir daí NADA que use IA paga funciona até recarregar.
//
// O que faltava era avisar. Uma pessoa que tem R$ 0,80 e manda transcrever
// uma sessão de cinquenta minutos vai gastar R$ 3,80 e descobrir depois.
// Por isso `avisoDeSaldoNegativo()`: onde o custo é estimável antes (é o
// caso dos dois), a tela diz o que vai acontecer e deixa a pessoa decidir.
import { supabase } from './supabase';
import { formatarSaldoBRL } from './creditosIA';

// Espelha _shared/precificacaoIA.ts e _shared/margemCobranca.ts (o app não
// pode importar módulo Deno). Se um mudar, o outro muda junto.
const PRECO_TRANSCRICAO_USD_HORA = 0.21 + 0.02; // base + diarização
const MULTIPLICADOR_COBRANCA_USUARIO = 2;

export const MOTIVO_ASSINATURA = 'assinatura';
export const MOTIVO_CREDITOS = 'creditos';

// Política do Google Play proíbe preço, link ou instrução de pagamento nas
// telas do app — por isso as duas mensagens apontam para uma tela do
// próprio app, e é lá que a ponte pra fora existe.
export const MENSAGEM_SEM_CREDITOS =
  'Seus créditos de IA acabaram. Transcrição, relatórios e a Busca Dr.Sig ficam ' +
  'indisponíveis até você recarregar — o resto do app continua funcionando normalmente, ' +
  'e nada do que você já registrou foi afetado.\n\n' +
  'Para recarregar, abra Meu Perfil › Créditos de IA.';

/** Custo, em US$, que será debitado por transcrever `segundos` de áudio. */
export function estimarCustoTranscricaoUSD(segundos) {
  const horas = (Number(segundos) || 0) / 3600;
  return horas * PRECO_TRANSCRICAO_USD_HORA * MULTIPLICADOR_COBRANCA_USUARIO;
}

/**
 * O estado da conta para uso de IA paga.
 *
 * `pode: true` com `motivo: null` é o caminho normal. Falha de rede também
 * devolve `pode: true`, de propósito: a checagem que vale é a do servidor,
 * e tirar a ferramenta de quem paga por causa de uma consulta que não
 * respondeu seria trocar um aviso por um bloqueio falso.
 */
export async function getSituacaoIA() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { pode: true, motivo: null, saldoUsd: null };

    const [{ data: ativa, error: erroAtiva }, { data: perfil }] = await Promise.all([
      supabase.rpc('assinatura_ativa', { uid: session.user.id }),
      supabase.from('profiles').select('creditos_ia').eq('id', session.user.id).maybeSingle(),
    ]);

    // Erro de rede na consulta devolve `data: null`, que é indistinguível
    // de "não tem assinatura" se a gente só olhar o valor. Sem esta linha,
    // um segundo de rede ruim tira a ferramenta de quem paga. A checagem
    // que vale é a da Edge Function, que roda no servidor e não depende
    // disto pra nada.
    if (erroAtiva) return { pode: true, motivo: null, saldoUsd: null };

    const saldoUsd = perfil ? Number(perfil.creditos_ia ?? 0) : null;
    if (!ativa) return { pode: false, motivo: MOTIVO_ASSINATURA, saldoUsd };
    if (saldoUsd != null && saldoUsd <= 0) return { pode: false, motivo: MOTIVO_CREDITOS, saldoUsd };
    return { pode: true, motivo: null, saldoUsd };
  } catch (_) {
    return { pode: true, motivo: null, saldoUsd: null };
  }
}

/**
 * O texto do aviso quando esta ação vai zerar o saldo, ou `null` quando
 * não vai. Devolve texto em vez de mostrar o alerta: quem decide como
 * perguntar é a tela, que já tem o próprio diálogo de confirmação.
 */
export function avisoDeSaldoNegativo(custoEstimadoUsd, saldoUsd) {
  if (saldoUsd == null || custoEstimadoUsd == null) return null;
  if (custoEstimadoUsd <= saldoUsd) return null;
  return (
    `Isto custa cerca de ${formatarSaldoBRL(custoEstimadoUsd)} e seu saldo é ` +
    `${formatarSaldoBRL(saldoUsd)}.\n\nA ação vai até o fim, mas deixa seu saldo negativo — ` +
    'e depois dela nada que use IA funciona até você recarregar, em Meu Perfil › Créditos de IA.'
  );
}
