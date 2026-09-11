// Edge Function: mercadopago-criar-recarga
//
// Recarga avulsa de crédito de IA, paga na NOSSA página
// (docs/recarregar-creditos.html), em cartão de crédito.
//
// ── Por que não é mais um link do Mercado Pago aberto de dentro do app ──
//
// O app mostrava "R$ 20 / R$ 50 / R$ 100" num alerta e abria o checkout
// do Mercado Pago. Crédito de IA consumido dentro do app é bem digital, e
// a política de pagamentos do Google Play exige que isso passe pelo
// faturamento do Play — a mesma regra pela qual a assinatura nunca teve
// preço nem link dentro do app. Manter a recarga como exceção era pedir
// uma rejeição na revisão, ou uma remoção depois.
//
// Agora a recarga é como o plano: o app manda um e-mail com o link, e a
// página faz o resto. E a página cobra aqui mesmo, sem redirecionar: se a
// pessoa tem o app do Mercado Pago instalado, o Android entregaria o link
// a ele, e lá dentro a opção de pagar sem conta some.
//
// Só cartão por enquanto. O Pix entra depois, pela API do BTG — e entra
// como segunda opção na mesma página, sem mexer no que está aqui.
//
// ── Os dois pedidos ────────────────────────────────────────────────────
//
//  acao: 'chave'  — chave pública do SDK, saldo atual e pacotes.
//  acao: 'cartao' — cobra o cartão com o token gerado na página (campos
//                   são iframes do Mercado Pago; o número não passa por
//                   aqui) e credita na hora se aprovar.
//
// Creditar "na hora" e o webhook creditarem o mesmo pagamento não gera
// crédito em dobro: `creditarRecarga` é idempotente pelo id do pagamento
// (migration 0100).
//
// `external_reference` = `creditos:<userId>` é o que liga o pagamento à
// conta — nunca o e-mail do pagador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MP_API,
  PACOTES_BRL,
  PREFIXO_REFERENCIA,
  TAXA_REFERENCIA_USD_BRL,
  creditarRecarga,
} from '../_shared/recargaCreditos.ts';
import { mensagemDeRecusa } from '../_shared/recusaMercadoPago.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
const MP_PUBLIC_KEY = Deno.env.get('MERCADOPAGO_PUBLIC_KEY') || '';

const DESCRICAO = 'Dr.Sig — créditos de IA';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida ou expirada.' }, 401);
    const userId = userData.user.id;
    const email = userData.user.email;
    if (!email) return json({ error: 'Conta sem e-mail associado.' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil } = await admin
      .from('profiles')
      .select('creditos_ia, conta_demonstracao')
      .eq('id', userId)
      .maybeSingle();
    if (!perfil) return json({ error: 'Conta não encontrada.' }, 404);
    if (perfil.conta_demonstracao) {
      return json({ error: 'A conta de demonstração não compra créditos. Crie a sua conta no app.' }, 403);
    }

    const saldoBrl = Number(perfil.creditos_ia ?? 0) * TAXA_REFERENCIA_USD_BRL;
    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao || '');

    if (acao === 'chave') {
      return json({ publicKey: MP_PUBLIC_KEY || null, saldoBrl, pacotes: PACOTES_BRL });
    }

    if (acao === 'cartao') {
      const valorBRL = Number(body?.valorBRL);
      if (!PACOTES_BRL.includes(valorBRL)) return json({ error: 'Valor inválido.' }, 400);
      const cardTokenId = String(body?.cardTokenId || '').trim();
      const paymentMethodId = String(body?.paymentMethodId || '').trim();
      const cpf = String(body?.cpf || '').replace(/\D/g, '');
      if (!cardTokenId || !paymentMethodId) return json({ error: 'Dados do cartão incompletos.' }, 400);
      if (cpf.length !== 11) return json({ error: 'O CPF do titular precisa ter 11 dígitos.' }, 400);

      const resp = await fetch(`${MP_API}/v1/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          // O token do cartão é de uso único: serve de chave de idempotência
          // natural — o mesmo clique repetido não cobra duas vezes.
          'X-Idempotency-Key': `${userId}:cartao:${cardTokenId}`,
        },
        body: JSON.stringify({
          transaction_amount: valorBRL,
          token: cardTokenId,
          description: DESCRICAO,
          installments: 1,
          payment_method_id: paymentMethodId,
          issuer_id: body?.issuerId ? String(body.issuerId) : undefined,
          payer: { email, identification: { type: 'CPF', number: cpf } },
          external_reference: `${PREFIXO_REFERENCIA}${userId}`,
          statement_descriptor: 'DRSIG',
        }),
      });
      const pagamento = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error('mercadopago-criar-recarga: cartão não cobrado.', { http: resp.status, corpo: pagamento });
        return json({ error: mensagemDeRecusa(pagamento) }, 400);
      }
      if (pagamento.status === 'rejected') {
        return json({ error: mensagemDeRecusa(pagamento) }, 400);
      }

      const resultado = await creditarRecarga(admin, pagamento);
      const saldoAtual = resultado.creditado && resultado.saldo != null
        ? resultado.saldo * TAXA_REFERENCIA_USD_BRL
        : saldoBrl;
      return json({
        pagamentoId: String(pagamento.id),
        status: pagamento.status,
        creditado: resultado.creditado,
        saldoBrl: saldoAtual,
        valorBRL,
      });
    }

    return json({ error: 'Pedido inválido.' }, 400);
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
