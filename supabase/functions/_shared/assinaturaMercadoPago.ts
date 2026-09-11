// ─── Estado da assinatura, num lugar só ───────────────────────────────
//
// Duas funções precisam saber ler uma preapproval do Mercado Pago e
// refletir esse estado na conta: o webhook, quando o Mercado Pago avisa, e
// assinatura-processar-ciclo, que confere todo dia o que o webhook possa
// ter perdido. Enquanto isso viveu duplicado em outro lugar deste projeto,
// os dois lados divergiram em silêncio — foi assim que o crédito do plano
// virou quatro números diferentes. Aqui é um só.
//
// Regra que atravessa o arquivo inteiro: quem manda é o `external_reference`
// (`assinatura:<plano>:<userId>`), gravado por nós na criação do checkout.
// Nunca o e-mail do pagador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creditoMensalUsd } from './creditoDoPlano.ts';

export const MP_API = 'https://api.mercadopago.com';

export type Plano = 'mensal' | 'semestral' | 'anual';
export const PLANOS_VALIDOS: Plano[] = ['mensal', 'semestral', 'anual'];

/** Quanto o plano custa por mês — só pra exibir em Pagamentos. O valor
 *  cobrado de fato é 89 / 414 / 588, em mercadopago-criar-checkout-assinatura. */
export const VALOR_MENSAL_EQUIVALENTE: Record<Plano, number> = {
  mensal: 89,
  semestral: 69,
  anual: 49,
};

export const MESES_DO_CICLO: Record<Plano, number> = { mensal: 1, semestral: 6, anual: 12 };

export function calcularCicloFim(plano: Plano, inicio: Date): Date {
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + MESES_DO_CICLO[plano]);
  return fim;
}

export function parseReferenciaAssinatura(
  externalReference: string,
): { plano: Plano; userId: string } | null {
  if (!externalReference.startsWith('assinatura:')) return null;
  const partes = externalReference.split(':');
  const plano = partes[1] as Plano;
  const userId = partes[2];
  if (!PLANOS_VALIDOS.includes(plano) || !userId) return null;
  return { plano, userId };
}

export type Cliente = ReturnType<typeof createClient>;

export type EstadoAssinatura = {
  assinatura_status: string;
  assinatura_expira_em: string | null;
  mp_preapproval_id: string | null;
  assinatura_plano?: Plano;
  assinatura_ciclo_inicio?: string;
  assinatura_valor_mensal_equivalente?: number;
};

/**
 * Aplica o estado da assinatura na conta, por id — nunca por e-mail.
 *
 * Entrega também o brinde de crédito do primeiro ciclo. O brinde é o valor
 * do PLANO (R$ 5/7/10 por mês, em creditoDoPlano.ts), não o valor pago: já
 * se creditou o preço inteiro da assinatura uma vez, e quem assinasse o
 * anual ficava com quase cinquenta vezes o combinado.
 */
export async function aplicarAssinaturaPorId(
  supabaseAdmin: Cliente,
  userId: string,
  estado: EstadoAssinatura,
  // Só é usado quando a conta não existe mais (ver abaixo). Quem chama
  // sem ele continua funcionando; só não consegue cancelar nesse caso.
  mpAccessToken?: string,
) {
  const patch: Record<string, unknown> = { assinatura_status: estado.assinatura_status };
  if (estado.assinatura_expira_em) patch.assinatura_expira_em = estado.assinatura_expira_em;
  if (estado.mp_preapproval_id) patch.mp_preapproval_id = estado.mp_preapproval_id;
  if (estado.assinatura_plano) patch.assinatura_plano = estado.assinatura_plano;
  if (estado.assinatura_ciclo_inicio) patch.assinatura_ciclo_inicio = estado.assinatura_ciclo_inicio;
  if (estado.assinatura_valor_mensal_equivalente != null) {
    patch.assinatura_valor_mensal_equivalente = estado.assinatura_valor_mensal_equivalente;
  }
  if (estado.assinatura_status === 'ativa') {
    patch.assinatura_renovacao_notificada_em = null;
    // Ciclo novo, avisos novos: sem isto, quem recebeu "seu acesso termina
    // em 7 dias" e assinou nunca mais receberia o aviso do ciclo seguinte.
    patch.aviso_fim_acesso_dias = null;
  }
  const { data: atualizados } = await supabaseAdmin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id');

  // Zero linhas: a conta não existe mais, e este `update` silencioso era
  // a única coisa que acontecia. O caso real é a pessoa excluir a conta
  // com a assinatura viva — excluir-conta cancela no Mercado Pago antes
  // de apagar, mas se aquele cancelamento falhar depois de a conta já ter
  // sumido (ou se a exclusão vier do painel), a cobrança continuaria todo
  // mês, para ninguém. Aqui é o último lugar que fica sabendo: registra
  // para conferência humana e cancela a recorrência.
  if (!atualizados || atualizados.length === 0) {
    await registrarNaoIdentificado(supabaseAdmin, {
      mp_id: estado.mp_preapproval_id || userId,
      tipo: 'assinatura-de-conta-inexistente',
      valor: null,
      status: estado.assinatura_status,
      email_pagador: null,
      motivo: `a conta ${userId} não existe mais; assinatura ${estado.mp_preapproval_id || '?'} ${estado.assinatura_status === 'ativa' ? 'cancelada agora no Mercado Pago' : 'já não estava ativa'}`,
    });
    if (estado.assinatura_status === 'ativa' && estado.mp_preapproval_id && mpAccessToken) {
      await cancelarPreapproval(mpAccessToken, estado.mp_preapproval_id);
    }
    return;
  }

  if (estado.assinatura_status !== 'ativa' || !estado.assinatura_plano) return;
  const creditoUsd = creditoMensalUsd(estado.assinatura_plano);
  if (creditoUsd == null) return;

  const { data: perfil } = await supabaseAdmin
    .from('profiles')
    .select('creditos_ia, proxima_renovacao_credito')
    .eq('id', userId)
    .maybeSingle();
  if (!perfil) return;

  // Só credita ao ENTRAR em ativa. O Mercado Pago reenvia a notificação de
  // uma assinatura já autorizada, toda renovação passa por aqui de novo, e
  // a conferência diária passa por aqui todo dia; sem esta guarda, cada
  // passagem somaria mais um mês de brinde. Os meses seguintes são
  // responsabilidade de renovar-creditos, que usa esta mesma data como
  // marcador.
  if (perfil.proxima_renovacao_credito) return;

  const proxima = new Date();
  proxima.setUTCMonth(proxima.getUTCMonth() + 1);
  await supabaseAdmin.from('profiles').update({
    creditos_ia: Number(perfil.creditos_ia ?? 0) + creditoUsd,
    proxima_renovacao_credito: proxima.toISOString().slice(0, 10),
  }).eq('id', userId);

  await supabaseAdmin.from('uso_ia').insert({
    user_id: userId,
    tipo: 'renovacao',
    provedor: 'sistema',
    modelo: `plano_${estado.assinatura_plano}`,
    unidades: null,
    custo_estimado: -creditoUsd,
  });
}

/**
 * Registra um pagamento que não diz de quem é, pra alguém conferir na mão.
 *
 * É o único destino de dinheiro que chega sem referência. Não tenta
 * adivinhar dono: guarda tudo que o Mercado Pago informou — inclusive o
 * e-mail do pagador, que ajuda uma pessoa a conferir, mas nunca a máquina
 * a decidir.
 */
export async function registrarNaoIdentificado(
  supabaseAdmin: Cliente,
  dados: {
    mp_id: string;
    tipo: string;
    valor: number | null;
    status: string | null;
    email_pagador: string | null;
    motivo: string;
  },
) {
  console.error('assinatura: pagamento sem referência de conta.', dados);
  await supabaseAdmin.from('pagamentos_nao_identificados').insert(dados);
}

/**
 * Cancela a recorrência no Mercado Pago. Devolve `true` quando ela está
 * cancelada ao fim — inclusive se já estava: o objetivo é o estado, não a
 * chamada. `false` quando o Mercado Pago recusou e ela pode seguir viva.
 */
export async function cancelarPreapproval(mpAccessToken: string, preapprovalId: string): Promise<boolean> {
  const resp = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${mpAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (resp.ok) return true;

  // O PUT falha em assinatura já cancelada. Antes de dizer "não deu",
  // confere o estado real.
  const leitura = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${mpAccessToken}` },
  });
  const atual = leitura.ok ? await leitura.json().catch(() => null) : null;
  if (atual?.status === 'cancelled') return true;

  console.error('assinatura: o Mercado Pago não cancelou a preapproval.', {
    preapprovalId,
    http: resp.status,
    detalhe: (await resp.text().catch(() => '')).slice(0, 500),
  });
  return false;
}

export type ResultadoSincronizacao =
  | { ok: true; situacao: string; plano?: Plano; userId?: string }
  | { ok: false; erro: string; httpMercadoPago?: number };

/**
 * Lê a preapproval no Mercado Pago e reflete o estado dela na conta.
 *
 * `origem` só aparece no registro de pagamento não identificado, pra
 * distinguir "chegou pelo webhook" de "achado na conferência diária".
 */
export async function sincronizarPreapproval(
  supabaseAdmin: Cliente,
  mpAccessToken: string,
  preapprovalId: string,
  origem: string,
): Promise<ResultadoSincronizacao> {
  const resp = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${mpAccessToken}` },
  });
  if (!resp.ok) {
    return { ok: false, erro: `Erro ao buscar assinatura no Mercado Pago.`, httpMercadoPago: resp.status };
  }
  const preapproval = await resp.json();

  const referencia = parseReferenciaAssinatura(String(preapproval?.external_reference || ''));
  if (!referencia) {
    await registrarNaoIdentificado(supabaseAdmin, {
      mp_id: preapprovalId,
      tipo: origem,
      valor: Number(preapproval?.auto_recurring?.transaction_amount) || null,
      status: preapproval?.status ?? null,
      email_pagador: preapproval?.payer_email ?? null,
      motivo: 'preapproval sem external_reference no formato assinatura:<plano>:<userId>',
    });
    return { ok: true, situacao: 'nao_identificado' };
  }

  const { plano, userId } = referencia;

  if (preapproval.status === 'authorized') {
    const cicloInicio = preapproval.date_created ? new Date(preapproval.date_created) : new Date();
    // `next_payment_date` é a data da PRÓXIMA cobrança — exatamente até
    // onde o acesso vale. Numa renovação ela já vem adiantada de um ciclo,
    // que é como o acesso se estende sozinho.
    const expiraEm = preapproval.next_payment_date
      ? new Date(preapproval.next_payment_date)
      : calcularCicloFim(plano, new Date());
    await aplicarAssinaturaPorId(supabaseAdmin, userId, {
      assinatura_status: 'ativa',
      assinatura_expira_em: expiraEm.toISOString(),
      mp_preapproval_id: preapprovalId,
      assinatura_plano: plano,
      assinatura_ciclo_inicio: cicloInicio.toISOString(),
      assinatura_valor_mensal_equivalente: VALOR_MENSAL_EQUIVALENTE[plano],
    }, mpAccessToken);
    return { ok: true, situacao: 'ativa', plano, userId };
  }

  if (['cancelled', 'paused'].includes(preapproval.status)) {
    // Cancelada não é expirada: `assinatura_expira_em` fica como está, e
    // quem já pagou usa até o fim do que pagou.
    await aplicarAssinaturaPorId(supabaseAdmin, userId, {
      assinatura_status: 'cancelada',
      assinatura_expira_em: null,
      mp_preapproval_id: preapprovalId,
    });
    return { ok: true, situacao: 'cancelada', plano, userId };
  }

  // `pending`: checkout criado, pessoa ainda não autorizou. Nada a fazer —
  // e nada a registrar como problema.
  return { ok: true, situacao: String(preapproval.status || 'desconhecida'), plano, userId };
}
