// Edge Function: mercadopago-criar-checkout-assinatura
//
// Gera o checkout dos três planos. Os três são ASSINATURA de verdade
// (`preapproval` do Mercado Pago): renovam sozinhos até a pessoa cancelar,
// só mudando de quanto em quanto tempo a cobrança acontece — 1, 6 ou 12
// meses. Verificado contra a API: `auto_recurring.frequency` aceita 6 e 12
// com `frequency_type: 'months'` (HTTP 201 nos três).
//
// Antes, só o mensal era assinatura; semestral e anual eram pagamento
// ÚNICO via checkout/preferences. Isso vencia caladamente: o acesso caía
// no fim do período e a renovação dependia de a pessoa receber um e-mail,
// lembrar, e pagar de novo na mão. Um plano que expira sozinho não é um
// plano — é uma evasão marcada na agenda.
//
// O efeito colateral é o Pix, e não há como fugir dele no Mercado Pago:
// recorrência lá só existe em cartão. Pix não faz cobrança automática, e a
// única alternativa (Pix Automático) é do BTG, que cobra R$ 200/mês de
// plano PJ — caro demais pra base de hoje. Então: os três planos são
// cartão, e a página de escolha diz isso antes do clique, não depois.
//
// `external_reference` = `assinatura:<plano>:<userId>` é o que liga o
// pagamento à conta. Não depende do e-mail que a pessoa usa no Mercado
// Pago, que frequentemente é outro — e adivinhar por e-mail foi
// exatamente a origem do pagamento que ficou solto no teste.
//
// Chamada por docs/escolher-plano.html (fora do app, sem Authorization
// automático do supabase-js — o token vai manual no header).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;

const MP_API = 'https://api.mercadopago.com';
const CONFIRMACAO_URL = 'https://app.drsig.com.br/assinatura-confirmada.html';

type Plano = 'mensal' | 'semestral' | 'anual';

// Preço e ritmo de cada plano, num lugar só. `mesesPorCobranca` é o que vai
// pro `auto_recurring.frequency`; `precoBRL` é o valor de CADA cobrança —
// não o mensal equivalente (esse é só pra exibir, e vive no webhook).
const PLANOS: Record<Plano, { precoBRL: number; mesesPorCobranca: number; nome: string }> = {
  mensal: { precoBRL: 89, mesesPorCobranca: 1, nome: 'Mensal' },
  semestral: { precoBRL: 414, mesesPorCobranca: 6, nome: 'Semestral' },
  anual: { precoBRL: 588, mesesPorCobranca: 12, nome: 'Anual' },
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
    const config = PLANOS[plano];
    if (!config) return json({ error: 'Plano inválido.' }, 400);

    // Sem `preapproval_plan_id`: com ele o Mercado Pago exige um
    // `card_token_id`, que só nasce no navegador com o cartão em mãos — o
    // servidor não tem como produzir, e a chamada voltava 400. Descrevendo
    // a recorrência aqui, o Mercado Pago devolve um `init_point`: a página
    // deles onde a pessoa informa o cartão e autoriza. `status: 'pending'`
    // deixa explícito que nada é cobrado até essa autorização.
    const resp = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: `Dr.Sig — Plano ${config.nome}`,
        auto_recurring: {
          frequency: config.mesesPorCobranca,
          frequency_type: 'months',
          transaction_amount: config.precoBRL,
          currency_id: 'BRL',
        },
        payer_email: email,
        external_reference: `assinatura:${plano}:${userId}`,
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
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
