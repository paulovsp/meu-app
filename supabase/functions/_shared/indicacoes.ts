// ─── O desconto por indicações, aplicado onde ele existe de verdade ────
//
// A regra ("10% por indicado ativo, teto de dez") mora no banco, em
// `desconto_por_indicacoes`. Aqui é o outro lado: fazer o Mercado Pago
// cobrar esse valor. Enquanto o banco disser 30% e o Mercado Pago cobrar
// os R$ 89 cheios, o desconto não existe — existe uma promessa na tela.
//
// Verificado contra a API antes de escrever:
//   • dá pra mudar `auto_recurring.transaction_amount` de uma assinatura
//     já autorizada, pra baixo e pra cima, sem a pessoa reautorizar nada;
//   • R$ 0 é recusado ("must be a positive number");
//   • qualquer valor abaixo de R$ 0,50 também ("Cannot pay an amount
//     lower than R$ 0.50").
//
// Por isso 100% de desconto não é uma assinatura barata: é assinatura
// nenhuma. Aos dez indicados, a assinatura é cancelada no Mercado Pago e a
// conta passa para `gratuita_indicacao` — um estado sem data, que vale
// enquanto a condição valer.
import { MP_API, type Cliente, type Plano } from './assinaturaMercadoPago.ts';

/** Preço cheio de cada plano, e de quanto em quanto tempo ele é cobrado. */
export const PRECO_BASE: Record<Plano, { precoBRL: number; mesesPorCobranca: number }> = {
  mensal: { precoBRL: 89, mesesPorCobranca: 1 },
  semestral: { precoBRL: 414, mesesPorCobranca: 6 },
  anual: { precoBRL: 588, mesesPorCobranca: 12 },
};

/** Quanto a pessoa paga com `desconto`% de abatimento, em reais. */
export function precoComDesconto(plano: Plano, desconto: number): number {
  const base = PRECO_BASE[plano].precoBRL;
  const bruto = base * (1 - Math.min(Math.max(desconto, 0), 100) / 100);
  return Math.round(bruto * 100) / 100;
}

// Quando alguém perde o acesso gratuito (um indicado cancelou e a conta
// caiu de dez para nove), a assinatura no Mercado Pago já não existe: foi
// cancelada quando o desconto chegou a 100%. Não dá pra "religar" — a
// pessoa precisa informar o cartão de novo.
//
// Cortar no mesmo instante seria punir alguém por uma decisão de terceiro,
// tomada sem aviso. Estes quinze dias são o tempo de receber o aviso,
// entender, e decidir.
const DIAS_PARA_REASSINAR = 15;

export type ResultadoDesconto = {
  desconto: number;
  mudou: boolean;
  acao: 'nada' | 'valor-ajustado' | 'virou-gratuita' | 'perdeu-gratuidade' | 'sem-assinatura';
  detalhe?: string;
};

/**
 * Põe o desconto de indicações em dia para uma conta.
 *
 * Idempotente de propósito: roda no webhook, no cancelamento e na
 * conferência diária, e na imensa maioria das vezes não faz nada — que é
 * exatamente o resultado certo quando já está tudo em dia.
 */
export async function aplicarDescontoDeIndicacoes(
  admin: Cliente,
  mpAccessToken: string,
  userId: string,
): Promise<ResultadoDesconto> {
  const { data: perfil } = await admin
    .from('profiles')
    .select('assinatura_status, assinatura_plano, assinatura_expira_em, mp_preapproval_id, indicacao_desconto_percentual')
    .eq('id', userId)
    .maybeSingle();
  if (!perfil) return { desconto: 0, mudou: false, acao: 'nada', detalhe: 'conta não encontrada' };

  const { data: alvoBruto } = await admin.rpc('desconto_por_indicacoes', { uid: userId });
  const alvo = Number(alvoBruto) || 0;
  const atual = Number(perfil.indicacao_desconto_percentual) || 0;
  const status = String(perfil.assinatura_status || '');
  const plano = perfil.assinatura_plano as Plano | null;

  // ── Já estava de graça e continua tendo direito ──────────────────────
  if (status === 'gratuita_indicacao' && alvo >= 100) {
    return { desconto: 100, mudou: false, acao: 'nada' };
  }

  // ── Estava de graça e perdeu o direito ───────────────────────────────
  if (status === 'gratuita_indicacao' && alvo < 100) {
    const prazo = new Date(Date.now() + DIAS_PARA_REASSINAR * 86400000);
    await admin.from('profiles').update({
      assinatura_status: 'cancelada',
      assinatura_expira_em: prazo.toISOString(),
      indicacao_desconto_percentual: alvo,
    }).eq('id', userId);
    return {
      desconto: alvo,
      mudou: true,
      acao: 'perdeu-gratuidade',
      detalhe: `acesso garantido até ${prazo.toISOString().slice(0, 10)}`,
    };
  }

  // ── Sem assinatura viva: não há o que descontar ──────────────────────
  // O desconto fica registrado assim mesmo, pra valer já na hora de
  // assinar — quem indicou dez pessoas antes de assinar não pode ser
  // cobrado o preço cheio por ter feito na ordem "errada".
  if (status !== 'ativa' || !perfil.mp_preapproval_id || !plano) {
    if (alvo !== atual) {
      await admin.from('profiles').update({ indicacao_desconto_percentual: alvo }).eq('id', userId);
    }
    return { desconto: alvo, mudou: alvo !== atual, acao: 'sem-assinatura' };
  }

  if (alvo === atual) return { desconto: atual, mudou: false, acao: 'nada' };

  // ── Chegou aos dez: a assinatura sai de cena ─────────────────────────
  if (alvo >= 100) {
    const resp = await fetch(`${MP_API}/preapproval/${perfil.mp_preapproval_id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${mpAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => '');
      console.error('indicacoes: não consegui cancelar a assinatura para liberar o acesso gratuito.', {
        userId, http: resp.status, detalhe: detalhe.slice(0, 300),
      });
      return { desconto: atual, mudou: false, acao: 'nada', detalhe: 'Mercado Pago recusou o cancelamento' };
    }
    await admin.from('profiles').update({
      assinatura_status: 'gratuita_indicacao',
      indicacao_desconto_percentual: 100,
      mp_preapproval_id: null,
    }).eq('id', userId);
    return { desconto: 100, mudou: true, acao: 'virou-gratuita' };
  }

  // ── Ajuste normal: muda o valor cobrado ──────────────────────────────
  const novoValor = precoComDesconto(plano, alvo);
  const resp = await fetch(`${MP_API}/preapproval/${perfil.mp_preapproval_id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${mpAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auto_recurring: {
        frequency: PRECO_BASE[plano].mesesPorCobranca,
        frequency_type: 'months',
        transaction_amount: novoValor,
        currency_id: 'BRL',
      },
    }),
  });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    console.error('indicacoes: o Mercado Pago recusou o novo valor.', {
      userId, alvo, novoValor, http: resp.status, detalhe: detalhe.slice(0, 300),
    });
    // Não grava a coluna: ela existe justamente pra espelhar o que o
    // Mercado Pago cobra. Mentir aqui é mostrar um desconto que a fatura
    // não tem.
    return { desconto: atual, mudou: false, acao: 'nada', detalhe: 'Mercado Pago recusou o novo valor' };
  }

  await admin.from('profiles').update({ indicacao_desconto_percentual: alvo }).eq('id', userId);
  return { desconto: alvo, mudou: true, acao: 'valor-ajustado', detalhe: `R$ ${novoValor.toFixed(2)}` };
}

/**
 * Põe em dia o desconto de QUEM INDICOU esta conta.
 *
 * É o gancho que faz a coisa acontecer sozinha: toda vez que a assinatura
 * de alguém muda de estado, quem indicou essa pessoa pode ter ganhado ou
 * perdido 10%.
 */
export async function atualizarQuemIndicou(
  admin: Cliente,
  mpAccessToken: string,
  userId: string,
): Promise<void> {
  try {
    const { data: perfil } = await admin
      .from('profiles')
      .select('indicado_por')
      .eq('id', userId)
      .maybeSingle();
    if (!perfil?.indicado_por) return;
    await aplicarDescontoDeIndicacoes(admin, mpAccessToken, String(perfil.indicado_por));
  } catch (err) {
    // Nunca derruba o fluxo principal. Um pagamento não pode falhar
    // porque o desconto de terceiro não pôde ser recalculado — a
    // conferência diária passa por todo mundo e acerta.
    console.error('indicacoes: não consegui atualizar quem indicou.', err);
  }
}
