// Edge Function: mercadopago-webhook
// Pública (deploy com --no-verify-jwt) — quem chama é o Mercado Pago, sem
// JWT de usuário. A autenticidade é garantida pela assinatura HMAC no
// header `x-signature`, validada com o segredo gerado em "Suas
// integrações" no painel do Mercado Pago (MERCADOPAGO_WEBHOOK_SECRET).
// Um endpoint público que ativa assinatura sem validar origem é um
// endpoint que qualquer pessoa usa pra se dar acesso vitalício — por isso
// a validação vem antes de qualquer outra coisa, e falha fecha (401), não
// abre.
//
// Correlação pagamento -> conta: os links de assinatura no site
// (drsig.com.br) são estáticos, iguais pra todo mundo — não carregam o id
// do usuário, só o e-mail de quem pagou. A solução definitiva é gerar o
// checkout por API do Mercado Pago com `external_reference` = id do
// usuário; isso exige a conta já existir ANTES da assinatura ser criada no
// Mercado Pago (um checkout dinâmico gerado depois do login/cadastro), o
// que não é o caso hoje — a venda acontece no site, antes ou depois de a
// pessoa ter conta no app. Enquanto isso, casa por e-mail; se não achar
// perfil, grava em `pagamentos_pendentes` (ver migration 0026), consultada
// no cadastro.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
const MP_WEBHOOK_SECRET = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')!;

const MP_API = 'https://api.mercadopago.com';
const GRACA_INADIMPLENCIA_DIAS = 7;
const CICLO_PADRAO_DIAS = 30; // fallback quando o recurso não informa next_payment_date

// Mesma taxa de referência usada em creditosIA.js/renovar-creditos — só
// pra converter o valor pago (BRL) pro saldo interno (US$).
const TAXA_REFERENCIA_USD_BRL = 5.08;

// Novo modelo de 3 planos (ver migration 0035). Decisão confirmada: a
// Referência de API do Mercado Pago só documenta `card_token_id` como meio
// de pagamento pra preapproval (assinatura recorrente) — Pix não aparece
// ali. Por isso:
//   • Mensal (recorrente, indefinido) — SEMPRE cartão, via preapproval
//     normal. Identificado pelo evento `preapproval`/`subscription`.
//   • Semestral/Anual — SEMPRE Pix, como pagamento ÚNICO (não é uma
//     preapproval — é só um pagamento avulso que o Paulo gera como link no
//     painel do Mercado Pago). Identificado pelo evento `payment` comum,
//     sem auto_recurring nem plan_id nenhum pra ler — a única forma de
//     saber qual dos dois é o valor cobrado (414 ou 588).
// Consequência importante pro ciclo de renovação (ver
// assinatura-processar-ciclo): como Pix não guarda cartão nenhum, NUNCA
// vai existir um mp_preapproval_id pra reaproveitar quando o semestral/anual
// vencer — o caminho de aviso por e-mail/push + confirmação manual não é
// um fallback de exceção, é o caminho normal e esperado pra essas contas.
const MP_PLANO_MENSAL_ID = Deno.env.get('MP_PLANO_MENSAL_ID') || '';

type Plano = 'mensal' | 'semestral' | 'anual';

const VALOR_MENSAL_EQUIVALENTE: Record<Plano, number> = {
  mensal: 89,
  semestral: 69,
  anual: 49,
};

// Preço do pagamento único (BRL) -> plano. Único jeito de saber qual dos
// dois é um pagamento Pix avulso, já que ele não carrega plan_id nem
// auto_recurring. Se o Paulo mudar esses preços, atualizar aqui também.
const VALOR_PAGAMENTO_UNICO_PARA_PLANO: Record<number, Plano> = {
  414: 'semestral',
  588: 'anual',
};

function identificarPlanoPagamentoUnico(transactionAmount: number): Plano | null {
  return VALOR_PAGAMENTO_UNICO_PARA_PLANO[Math.round(transactionAmount)] ?? null;
}

// deno-lint-ignore no-explicit-any
function identificarPlano(preapproval: any): Plano {
  const planId = preapproval?.preapproval_plan_id || '';
  if (planId && MP_PLANO_MENSAL_ID && planId === MP_PLANO_MENSAL_ID) return 'mensal';

  // Fallback defensivo — plan_id não configurado ou não bateu: infere pela
  // frequência declarada na própria preapproval (auto_recurring). Na
  // prática só preapproval mensal chega aqui (semestral/anual são Pix
  // avulso, tratados em identificarPlanoPagamentoUnico), mas mantém o
  // reconhecimento por meses caso isso mude no futuro.
  const freqType = preapproval?.auto_recurring?.frequency_type;
  const freq = Number(preapproval?.auto_recurring?.frequency) || 0;
  if (freqType === 'months' && freq >= 12) return 'anual';
  if (freqType === 'months' && freq >= 6) return 'semestral';
  return 'mensal';
}

function calcularCicloFim(plano: Plano, inicio: Date): Date {
  const fim = new Date(inicio);
  if (plano === 'semestral') fim.setMonth(fim.getMonth() + 6);
  else if (plano === 'anual') fim.setMonth(fim.getMonth() + 12);
  else fim.setDate(fim.getDate() + CICLO_PADRAO_DIAS);
  return fim;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Algoritmo oficial do Mercado Pago: manifest "id:{data.id};request-id:{x-request-id};ts:{ts};",
// HMAC-SHA256 com o secret, comparado (hex) com o v1 do header x-signature.
async function validarAssinatura(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  const dataId = (url.searchParams.get('data.id') || url.searchParams.get('id') || '').toLowerCase();
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  if (!xSignature || !xRequestId || !dataId) return false;

  const partes: Record<string, string> = {};
  for (const parte of xSignature.split(',')) {
    const [chave, valor] = parte.split('=');
    if (chave && valor) partes[chave.trim()] = valor.trim();
  }
  const ts = partes.ts;
  const v1Recebido = partes.v1;
  if (!ts || !v1Recebido) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinaturaCalculada = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const v1Calculado = hexEncode(new Uint8Array(assinaturaCalculada));

  return v1Calculado === v1Recebido;
}

// Assinatura gerada por mercadopago-criar-checkout-assinatura (usuário já
// tem conta e já está autenticado — ver comentário lá) — aplica direto por
// id, sem precisar casar por e-mail nem passar por `pagamentos_pendentes`.
async function aplicarAssinaturaPorId(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  estado: {
    assinatura_status: string;
    assinatura_expira_em: string | null;
    mp_preapproval_id: string | null;
    assinatura_plano?: Plano;
    assinatura_ciclo_inicio?: string;
    assinatura_valor_mensal_equivalente?: number;
  },
) {
  const patch: Record<string, unknown> = { assinatura_status: estado.assinatura_status };
  if (estado.assinatura_expira_em) patch.assinatura_expira_em = estado.assinatura_expira_em;
  if (estado.mp_preapproval_id) patch.mp_preapproval_id = estado.mp_preapproval_id;
  if (estado.assinatura_plano) patch.assinatura_plano = estado.assinatura_plano;
  if (estado.assinatura_ciclo_inicio) patch.assinatura_ciclo_inicio = estado.assinatura_ciclo_inicio;
  if (estado.assinatura_valor_mensal_equivalente != null) {
    patch.assinatura_valor_mensal_equivalente = estado.assinatura_valor_mensal_equivalente;
  }
  if (estado.assinatura_status === 'ativa') patch.assinatura_renovacao_notificada_em = null;
  await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
}

function parseReferenciaAssinatura(externalReference: string): { plano: Plano; userId: string } | null {
  if (!externalReference.startsWith('assinatura:')) return null;
  const partes = externalReference.split(':');
  const plano = partes[1] as Plano;
  const userId = partes[2];
  if (!PLANOS_VALIDOS_REFERENCIA.includes(plano) || !userId) return null;
  return { plano, userId };
}

const PLANOS_VALIDOS_REFERENCIA: Plano[] = ['mensal', 'semestral', 'anual'];

async function aplicarNaContaOuPendente(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
  estado: {
    assinatura_status: string;
    assinatura_expira_em: string | null;
    mp_preapproval_id: string | null;
    assinatura_plano?: Plano;
    assinatura_ciclo_inicio?: string;
    assinatura_valor_mensal_equivalente?: number;
  },
  valorPagoBRL: number,
) {
  const { data: perfil } = await supabaseAdmin
    .from('profiles')
    .select('id, assinatura_expira_em, creditos_ia')
    .eq('email', email)
    .maybeSingle();

  if (!perfil) {
    // Conta ainda não existe (venda aconteceu no site antes do cadastro no
    // app) — grava pendente; o trigger de criação de conta consulta isso.
    await supabaseAdmin.from('pagamentos_pendentes').insert({
      email,
      mp_preapproval_id: estado.mp_preapproval_id,
      assinatura_status: estado.assinatura_status,
      assinatura_expira_em: estado.assinatura_expira_em,
      assinatura_plano: estado.assinatura_plano ?? null,
      assinatura_ciclo_inicio: estado.assinatura_ciclo_inicio ?? null,
      assinatura_valor_mensal_equivalente: estado.assinatura_valor_mensal_equivalente ?? null,
      valor: valorPagoBRL,
    });
    return;
  }

  const patch: Record<string, unknown> = { assinatura_status: estado.assinatura_status };
  if (estado.assinatura_expira_em) patch.assinatura_expira_em = estado.assinatura_expira_em;
  if (estado.mp_preapproval_id) patch.mp_preapproval_id = estado.mp_preapproval_id;
  if (estado.assinatura_plano) patch.assinatura_plano = estado.assinatura_plano;
  if (estado.assinatura_ciclo_inicio) patch.assinatura_ciclo_inicio = estado.assinatura_ciclo_inicio;
  if (estado.assinatura_valor_mensal_equivalente != null) {
    patch.assinatura_valor_mensal_equivalente = estado.assinatura_valor_mensal_equivalente;
  }
  // Uma renovação bem-sucedida (webhook de preapproval autorizada) encerra
  // qualquer aviso de renovação pendente que estivesse em aberto.
  if (estado.assinatura_status === 'ativa') patch.assinatura_renovacao_notificada_em = null;
  await supabaseAdmin.from('profiles').update(patch).eq('id', perfil.id);

  if (valorPagoBRL > 0) {
    const creditoUsd = valorPagoBRL / TAXA_REFERENCIA_USD_BRL;
    await supabaseAdmin
      .from('profiles')
      .update({ creditos_ia: Number(perfil.creditos_ia) + creditoUsd })
      .eq('id', perfil.id);
    await supabaseAdmin.from('uso_ia').insert({
      user_id: perfil.id,
      tipo: 'renovacao',
      provedor: 'sistema',
      modelo: 'assinatura_mercadopago',
      unidades: null,
      custo_estimado: -creditoUsd,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const assinaturaValida = await validarAssinatura(req).catch(() => false);
  if (!assinaturaValida) {
    console.error('mercadopago-webhook: assinatura inválida ou ausente.', {
      url: req.url,
      temXSignature: !!req.headers.get('x-signature'),
    });
    return json({ error: 'Assinatura inválida.' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const notificacaoId = String(body?.id ?? '');
    // Formatos antigos (IPN) mandam `topic`/`id` só na query string, sem
    // corpo JSON — cobre os dois formatos.
    const tipo = String(body?.type ?? body?.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '');
    const recursoId = body?.data?.id
      ? String(body.data.id)
      : (url.searchParams.get('data.id') || url.searchParams.get('id') || null);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Idempotência — o Mercado Pago reenvia a mesma notificação quando não
    // recebe 200 rápido o bastante, ou por retry de rede.
    if (notificacaoId) {
      const { data: jaProcessado } = await supabaseAdmin
        .from('mercadopago_eventos_processados')
        .select('id')
        .eq('id', notificacaoId)
        .maybeSingle();
      if (jaProcessado) return json({ ok: true, duplicado: true });
    }

    if (!recursoId) {
      // Evento sem recurso associado (ex: teste do painel) — só confirma.
      return json({ ok: true });
    }

    if (tipo.includes('payment')) {
      const resp = await fetch(`${MP_API}/v1/payments/${recursoId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      if (!resp.ok) return json({ error: `Erro ao buscar pagamento (${resp.status}).` }, 502);
      const pagamento = await resp.json();

      // Recarga avulsa de créditos de IA (gerada por mercadopago-criar-checkout-creditos,
      // com o usuário já logado no app) — diferente da assinatura, aqui o
      // checkout já nasce com o id da conta no `external_reference`, então
      // credita direto por id, sem precisar casar por e-mail nem passar
      // pela lógica de ciclo/plano de assinatura.
      const referenciaCreditos = String(pagamento?.external_reference || '');
      if (referenciaCreditos.startsWith('creditos:')) {
        const userIdCreditos = referenciaCreditos.slice('creditos:'.length);
        if (pagamento.status === 'approved' && userIdCreditos) {
          const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          const { data: perfil } = await supabaseAdmin
            .from('profiles')
            .select('creditos_ia')
            .eq('id', userIdCreditos)
            .maybeSingle();
          if (perfil) {
            const creditoUsd = (Number(pagamento.transaction_amount) || 0) / TAXA_REFERENCIA_USD_BRL;
            await supabaseAdmin
              .from('profiles')
              .update({ creditos_ia: Number(perfil.creditos_ia) + creditoUsd })
              .eq('id', userIdCreditos);
            await supabaseAdmin.from('uso_ia').insert({
              user_id: userIdCreditos,
              tipo: 'recarga_avulsa',
              provedor: 'sistema',
              modelo: 'creditos_mercadopago',
              unidades: null,
              custo_estimado: -creditoUsd,
            });
          }
        }
        if (notificacaoId) {
          await createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
            .from('mercadopago_eventos_processados').insert({ id: notificacaoId, tipo });
        }
        return json({ ok: true, recargaCreditos: true });
      }

      // Assinatura semestral/anual (pagamento único, gerada por
      // mercadopago-criar-checkout-assinatura) — plano e conta já vêm no
      // external_reference, sem precisar adivinhar o plano pelo valor nem
      // casar por e-mail.
      const referenciaAssinatura = parseReferenciaAssinatura(String(pagamento?.external_reference || ''));
      if (referenciaAssinatura && referenciaAssinatura.plano !== 'mensal') {
        if (pagamento.status === 'approved') {
          const cicloInicio = new Date();
          await aplicarAssinaturaPorId(supabaseAdmin, referenciaAssinatura.userId, {
            assinatura_status: 'ativa',
            assinatura_expira_em: calcularCicloFim(referenciaAssinatura.plano, cicloInicio).toISOString(),
            mp_preapproval_id: null,
            assinatura_plano: referenciaAssinatura.plano,
            assinatura_ciclo_inicio: cicloInicio.toISOString(),
            assinatura_valor_mensal_equivalente: VALOR_MENSAL_EQUIVALENTE[referenciaAssinatura.plano],
          });
        }
        if (notificacaoId) {
          await supabaseAdmin.from('mercadopago_eventos_processados').insert({ id: notificacaoId, tipo });
        }
        return json({ ok: true, assinaturaPorId: true });
      }

      const email = pagamento?.payer?.email;
      if (!email) return json({ ok: true, semEmail: true });

      // Pagamento gerado por uma preapproval mensal (cartão) já é tratado
      // com a duração certa pelo evento `preapproval` — aplicar aqui de
      // novo sobrescreveria com o ciclo padrão errado. `operation_type` é o
      // campo documentado do Mercado Pago pra distinguir ('recurring_payment'
      // vs 'regular_payment') — se isso mudar de nome/comportamento no
      // futuro, reconferir na documentação de pagamentos.
      if (pagamento.operation_type === 'recurring_payment') {
        return json({ ok: true, ignoradoPorSerRecorrente: true });
      }

      // Pix avulso do Semestral/Anual: sem plan_id nem auto_recurring pra
      // ler, o valor cobrado é o único jeito de saber qual dos dois é.
      const planoPagamentoUnico = pagamento.status === 'approved'
        ? identificarPlanoPagamentoUnico(Number(pagamento.transaction_amount) || 0)
        : null;

      if (pagamento.status === 'approved' && planoPagamentoUnico) {
        const cicloInicio = new Date();
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          {
            assinatura_status: 'ativa',
            assinatura_expira_em: calcularCicloFim(planoPagamentoUnico, cicloInicio).toISOString(),
            // Pix não guarda cartão — não há preapproval nenhuma associada
            // a este pagamento (ver nota de renovação no topo do arquivo).
            mp_preapproval_id: null,
            assinatura_plano: planoPagamentoUnico,
            assinatura_ciclo_inicio: cicloInicio.toISOString(),
            assinatura_valor_mensal_equivalente: VALOR_MENSAL_EQUIVALENTE[planoPagamentoUnico],
          },
          Number(pagamento.transaction_amount) || 0,
        );
      } else if (pagamento.status === 'approved') {
        // Valor não bate com nenhum dos dois planos de pagamento único —
        // trata como cobrança avulsa genérica (ciclo padrão de 30 dias),
        // mesmo comportamento de sempre pra qualquer pagamento fora do
        // padrão dos 3 planos.
        const expiraEm = new Date(Date.now() + CICLO_PADRAO_DIAS * 24 * 60 * 60 * 1000).toISOString();
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          { assinatura_status: 'ativa', assinatura_expira_em: expiraEm, mp_preapproval_id: null },
          Number(pagamento.transaction_amount) || 0,
        );
      } else if (['rejected', 'cancelled'].includes(pagamento.status)) {
        // Carência: estende a partir do que já estava valendo (ou de agora,
        // se for a primeira cobrança) — cartão que falhou por bobagem não
        // derruba o atendimento de ninguém no meio da semana.
        const { data: perfilAtual } = await supabaseAdmin
          .from('profiles')
          .select('id, assinatura_expira_em')
          .eq('email', email)
          .maybeSingle();
        const baseData = perfilAtual?.assinatura_expira_em
          ? new Date(perfilAtual.assinatura_expira_em)
          : new Date();
        const expiraComCarencia = new Date(
          baseData.getTime() + GRACA_INADIMPLENCIA_DIAS * 24 * 60 * 60 * 1000,
        ).toISOString();
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          { assinatura_status: 'inadimplente', assinatura_expira_em: expiraComCarencia, mp_preapproval_id: null },
          0,
        );
      }
    } else if (tipo.includes('preapproval') || tipo.includes('subscription')) {
      const resp = await fetch(`${MP_API}/preapproval/${recursoId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      if (!resp.ok) return json({ error: `Erro ao buscar assinatura (${resp.status}).` }, 502);
      const preapproval = await resp.json();

      // Assinatura mensal gerada por mercadopago-criar-checkout-assinatura —
      // conta já vem no external_reference, aplica direto por id.
      const referenciaAssinaturaMensal = parseReferenciaAssinatura(String(preapproval?.external_reference || ''));
      if (referenciaAssinaturaMensal) {
        if (preapproval.status === 'authorized') {
          const cicloInicio = preapproval.date_created ? new Date(preapproval.date_created) : new Date();
          const expiraEm = preapproval.next_payment_date
            ? new Date(preapproval.next_payment_date)
            : calcularCicloFim('mensal', cicloInicio);
          await aplicarAssinaturaPorId(supabaseAdmin, referenciaAssinaturaMensal.userId, {
            assinatura_status: 'ativa',
            assinatura_expira_em: expiraEm.toISOString(),
            mp_preapproval_id: recursoId,
            assinatura_plano: 'mensal',
            assinatura_ciclo_inicio: cicloInicio.toISOString(),
            assinatura_valor_mensal_equivalente: VALOR_MENSAL_EQUIVALENTE.mensal,
          });
        } else if (['cancelled', 'paused'].includes(preapproval.status)) {
          await aplicarAssinaturaPorId(supabaseAdmin, referenciaAssinaturaMensal.userId, {
            assinatura_status: 'cancelada',
            assinatura_expira_em: null,
            mp_preapproval_id: recursoId,
          });
        }
        if (notificacaoId) {
          await supabaseAdmin.from('mercadopago_eventos_processados').insert({ id: notificacaoId, tipo });
        }
        return json({ ok: true, assinaturaPorId: true });
      }

      const email = preapproval?.payer_email;
      if (!email) return json({ ok: true, semEmail: true });

      if (preapproval.status === 'authorized') {
        const plano = identificarPlano(preapproval);
        const cicloInicio = preapproval.date_created ? new Date(preapproval.date_created) : new Date();
        // next_payment_date só é confiável pro mensal (cobra de novo no mês
        // seguinte); semestral/anual têm repetitions:1 — não há "próxima
        // cobrança" a esperar, o fim do ciclo é calculado pela duração do
        // plano mesmo.
        const expiraEm = plano === 'mensal' && preapproval.next_payment_date
          ? new Date(preapproval.next_payment_date)
          : calcularCicloFim(plano, cicloInicio);
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          {
            assinatura_status: 'ativa',
            assinatura_expira_em: expiraEm.toISOString(),
            mp_preapproval_id: recursoId,
            assinatura_plano: plano,
            assinatura_ciclo_inicio: cicloInicio.toISOString(),
            assinatura_valor_mensal_equivalente: VALOR_MENSAL_EQUIVALENTE[plano],
          },
          Number(preapproval?.auto_recurring?.transaction_amount) || 0,
        );
      } else if (['cancelled', 'paused'].includes(preapproval.status)) {
        // Mantém assinatura_expira_em como está — o acesso segue até o fim
        // do que já foi pago, não é revogado na hora do cancelamento.
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          { assinatura_status: 'cancelada', assinatura_expira_em: null, mp_preapproval_id: recursoId },
          0,
        );
      }
    }
    // Outros tipos de notificação (merchant_order, chargebacks, etc.) —
    // não dizem respeito à assinatura, só confirma recebimento.

    if (notificacaoId) {
      await supabaseAdmin.from('mercadopago_eventos_processados').insert({ id: notificacaoId, tipo });
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
