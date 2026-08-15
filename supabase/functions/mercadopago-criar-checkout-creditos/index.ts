// Edge Function: mercadopago-criar-checkout-creditos
// Gera um link de checkout do Mercado Pago pra recarga avulsa de créditos de
// IA — chamada pelo próprio app, com o usuário já logado (JWT normal, não
// --no-verify-jwt). Diferente da assinatura (vendida no site, sem conta
// ainda — por isso o mercadopago-webhook precisa casar por e-mail ou gravar
// em `pagamentos_pendentes`), aqui dá pra gerar um checkout dinâmico de
// verdade com `external_reference` = id do usuário, então o webhook credita
// direto por id, sem ambiguidade nenhuma.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;

const MP_API = 'https://api.mercadopago.com';

// Pacotes fixos — mantém a superfície de ataque pequena (não aceita
// qualquer valor arbitrário vindo do cliente).
const VALORES_PERMITIDOS_BRL = [20, 50, 100];

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
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const valorBRL = Number(body?.valorBRL);
    if (!VALORES_PERMITIDOS_BRL.includes(valorBRL)) {
      return json({ error: 'Valor inválido.' }, 400);
    }

    const resp = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          title: 'Créditos de IA - Dr.Sig',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: valorBRL,
        }],
        external_reference: `creditos:${userId}`,
        back_urls: {
          success: 'https://drsig.com.br',
          failure: 'https://drsig.com.br',
          pending: 'https://drsig.com.br',
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
