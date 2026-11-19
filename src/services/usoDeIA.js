// ─── Pode usar IA paga agora? ───────────────────────────────────────────
//
// Uma pergunta só, respondida num lugar só, porque ela é feita em duas
// telas diferentes (Busca, Relatórios) e a resposta tem que ser a mesma.
//
// Quem decide de verdade é a Edge Function `ia-busca`: confere assinatura,
// versão e saldo antes de gastar qualquer centavo, e devolve 403/402. Isto
// aqui não substitui essa checagem — serve pra avisar ANTES, em vez de
// deixar a pessoa escrever uma pergunta inteira ou escolher analisante e
// tipo de relatório pra levar o "não" no fim.
//
// ─── Como o saldo acaba ────────────────────────────────────────────────
//
// A regra, do jeito que o servidor a aplica: qualquer saldo POSITIVO
// autoriza a próxima ação, inteira. O custo real só é conhecido depois —
// quantos tokens a resposta usou —, e interromper uma resposta no meio
// porque o crédito acabou seria pior do que deixá-la terminar. Então a última ação pode fechar o saldo em
// negativo, e a partir daí NADA que use IA paga funciona até recarregar.
//
// O que faltava era avisar. Por isso `avisoDeSaldoNegativo()`: onde o
// custo é estimável antes, a tela diz o que vai acontecer e deixa a pessoa
// decidir.
import { supabase, estaEmModoSomenteLeitura } from './supabase';
import { formatarSaldoBRL } from './creditosIA';
import { MENSAGEM_ASSINATURA_INATIVA } from './assinatura';

export const MOTIVO_ASSINATURA = 'assinatura';
export const MOTIVO_CREDITOS = 'creditos';
export const MOTIVO_DEMONSTRACAO = 'demonstracao';

// Política do Google Play proíbe preço, link ou instrução de pagamento nas
// telas do app — por isso as duas mensagens apontam para uma tela do
// próprio app, e é lá que a ponte pra fora existe.
export const MENSAGEM_SEM_CREDITOS =
  'Seus créditos de IA acabaram. Os relatórios por IA e a Busca Dr.Sig ficam ' +
  'indisponíveis até você recarregar — o resto do app continua funcionando normalmente, ' +
  'e nada do que você já registrou foi afetado.\n\n' +
  'Para recarregar, abra Meu Perfil › Créditos de IA e peça o link por e-mail.';

// A conta de demonstração não gasta: o servidor recusa (é dinheiro do
// dono, pago por token e por minuto), e esta é a explicação que a pessoa
// vê antes de tentar.
export const MENSAGEM_DEMONSTRACAO_SEM_IA =
  'No consultório de demonstração os recursos de IA — relatórios e a Busca Dr.Sig — ' +
  'ficam desligados. Dá para ver os registros e os relatórios já gerados; para usar a ' +
  'IA com os seus próprios analisantes, crie a sua conta.';

/** Título e texto do aviso para cada motivo de bloqueio de IA. */
export function avisoDeBloqueioIA(motivo) {
  if (motivo === MOTIVO_ASSINATURA) return { titulo: 'Assinatura inativa', texto: MENSAGEM_ASSINATURA_INATIVA };
  if (motivo === MOTIVO_DEMONSTRACAO) return { titulo: 'Demonstração sem IA', texto: MENSAGEM_DEMONSTRACAO_SEM_IA };
  return { titulo: 'Créditos de IA esgotados', texto: MENSAGEM_SEM_CREDITOS };
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

    // Decidido antes de qualquer consulta: a demonstração nunca gasta, e
    // o servidor recusaria de qualquer jeito — aqui é só para avisar na
    // entrada, em vez de no último toque.
    if (estaEmModoSomenteLeitura()) return { pode: false, motivo: MOTIVO_DEMONSTRACAO, saldoUsd: 0 };

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
