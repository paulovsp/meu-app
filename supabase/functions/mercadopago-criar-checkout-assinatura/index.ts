// Edge Function: mercadopago-criar-checkout-assinatura
// Gera o checkout de assinatura (mensal/semestral/anual) pra quem acabou de
// confirmar o cadastro pelo e-mail de boas-vindas. Diferente do link
// estático do site (drsig.com.br, vendido ANTES de existir conta — por isso
// o mercadopago-webhook precisa casar por e-mail ou gravar em
// `pagamentos_pendentes`), aqui a conta já existe e o usuário já está
// autenticado (o link de confirmação do Supabase devolve um access_token),
// então dá pra gerar um checkout dinâmico de verdade com `external_reference`
// = `assinatura:<plano>:<userId>` — o webhook aplica direto por id, sem
// ambiguidade nenhuma. Mesmo princípio já usado em
// mercadopago-criar-checkout-creditos.
//
// Chamada a partir de docs/escolher-plano.html (fora do app, então sem
// Authorization automático do supabase-js — o token vai manual no header,
// extraído do fragmento #access_token que o Supabase devolve depois de
// verificar o e-mail).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;

const MP_API = 'https://api.mercadopago.com';
const CONFIRMACAO_URL = 'https://app.drsig.com.br/assinatura-confirmada.html';

type Plano = 'mensal' | 'semestral' | 'anual';
const PLANOS_VALIDOS: Plano[] = ['mensal', 'semestral', 'anual'];

// Mesmos valores documentados em mercadopago-webhook (VALOR_PAGAMENTO_UNICO_PARA_PLANO
// e VALOR_MENSAL_EQUIVALENTE) — se o Paulo mudar o preço, atualizar nos dois lugares.
const PRECO_MENSAL_BRL = 89;
const PRECO_SEMESTRAL_ANUAL_BRL: Record<'semestral' | 'anual', number> = {
  semestral: 414,
  anual: 588,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
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

    const body = await req.json().catch(() => ({}));
    const plano = String(body?.plano || '') as Plano;
    if (!PLANOS_VALIDOS.includes(plano)) {
      return json({ error: 'Plano inválido.' }, 400);
    }

    const externalReference = `assinatura:${plano}:${userId}`;

    if (plano === 'mensal') {
      // Assinatura recorrente SEM `preapproval_plan_id`.
      //
      // Com o plan_id, o Mercado Pago exige `card_token_id` — um token que
      // só nasce no navegador, com os dados do cartão em mãos. O servidor
      // não tem como produzi-lo, e a chamada voltava
      // "card_token_id is required" (400). Ou seja: a assinatura mensal
      // pelo app nunca funcionou, e o erro chegava à pessoa como 502.
      //
      // Descrevendo a recorrência aqui (`auto_recurring`), o Mercado Pago
      // devolve um `init_point`: uma página deles onde a pessoa informa o
      // cartão e autoriza. `status: pending` deixa claro que nada é
      // cobrado até essa autorização.
      const resp = await fetch(`${MP_API}/preapproval`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Dr.Sig — Plano Mensal',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: PRECO_MENSAL_BRL,
            currency_id: 'BRL',
          },
          payer_email: email,
          // O que liga o pagamento à conta, sem depender do e-mail que a
          // pessoa usa no Mercado Pago — que pode ser outro.
          external_reference: externalReference,
          back_url: CONFIRMACAO_URL,
          status: 'pending',
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        return json({ error: `Erro ao criar assinatura no Mercado Pago (${resp.status}): ${errBody}` }, 502);
      }
      const preapproval = await resp.json();
      return json({ initPoint: preapproval.init_point });
    }

    // Semestral/anual: pagamento único (Pix ou cartão), não recorrente —
    // mesmo mecanismo de checkout/preferences já usado pra créditos de IA.
    const valorBRL = PRECO_SEMESTRAL_ANUAL_BRL[plano as 'semestral' | 'anual'];
    const resp = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          title: `Assinatura Dr.Sig — Plano ${plano === 'semestral' ? 'Semestral' : 'Anual'}`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: valorBRL,
        }],
        payer: { email },
        external_reference: externalReference,
        back_urls: {
          success: CONFIRMACAO_URL,
          failure: CONFIRMACAO_URL,
          pending: CONFIRMACAO_URL,
        },
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return json({ error: `Erro ao criar checkout no Mercado Pago (${resp.status}): ${errBody}` }, 502);
    }
    const preferencia = await resp.json();
    return json({ initPoint: preferencia.init_point });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
