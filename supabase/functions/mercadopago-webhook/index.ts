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
// Correlação pagamento -> conta: o link de assinatura hoje é estático
// (mpago.la/2NjrpL3, igual pra todo mundo) — não carrega o id do usuário,
// só o e-mail de quem pagou. A solução definitiva é gerar o checkout por
// API do Mercado Pago com `external_reference` = id do usuário; isso exige
// a conta já existir ANTES da assinatura ser criada no Mercado Pago (um
// checkout dinâmico gerado depois do login/cadastro), o que não é o caso
// hoje — a venda acontece no site, antes ou depois de a pessoa ter conta
// no app. Enquanto isso, casa por e-mail; se não achar perfil, grava em
// `pagamentos_pendentes` (ver migration 0026), consultada no cadastro.
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

async function aplicarNaContaOuPendente(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
  estado: { assinatura_status: string; assinatura_expira_em: string | null; mp_preapproval_id: string | null },
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
      valor: valorPagoBRL,
    });
    return;
  }

  const patch: Record<string, unknown> = { assinatura_status: estado.assinatura_status };
  if (estado.assinatura_expira_em) patch.assinatura_expira_em = estado.assinatura_expira_em;
  if (estado.mp_preapproval_id) patch.mp_preapproval_id = estado.mp_preapproval_id;
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

      const email = pagamento?.payer?.email;
      if (!email) return json({ ok: true, semEmail: true });

      if (pagamento.status === 'approved') {
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

      const email = preapproval?.payer_email;
      if (!email) return json({ ok: true, semEmail: true });

      if (preapproval.status === 'authorized') {
        const expiraEm = preapproval.next_payment_date
          ? new Date(preapproval.next_payment_date).toISOString()
          : new Date(Date.now() + CICLO_PADRAO_DIAS * 24 * 60 * 60 * 1000).toISOString();
        await aplicarNaContaOuPendente(
          supabaseAdmin,
          email,
          { assinatura_status: 'ativa', assinatura_expira_em: expiraEm, mp_preapproval_id: recursoId },
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
