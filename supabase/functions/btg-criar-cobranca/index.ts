// Edge Function: btg-criar-cobranca
//
// Gera a cobrança Pix de uma recarga de créditos e devolve o copia-e-cola
// e o QR code. JWT normal: quem chama está logada no app.
//
// São duas chamadas ao BTG, nesta ordem: cria o QR code (location) e depois
// a cobrança vinculada a ele. O `txId` que volta é gerado por eles — é o
// que o webhook vai repetir quando o Pix cair, e por isso a linha em
// `recargas_credito` só faz sentido depois de existir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { chamarBtg, tokenValido, admin } from '../_shared/btg.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PIX_KEY = Deno.env.get('BTG_PIX_KEY')!;

// Espelha PACOTES_CREDITO_AVULSO de src/services/creditosIA.js. A validação
// que vale é esta: o valor e o crédito NUNCA vêm do cliente, senão bastava
// alterar a requisição pra pedir R$ 1 e receber R$ 150.
const PACOTES: Record<string, number> = {
  '20': 25,
  '50': 70,
  '100': 150,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const comoUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await comoUsuario.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const corpo = await req.json().catch(() => ({}));
    const valorBRL = Number(corpo?.valorBRL);
    const creditoBRL = PACOTES[String(valorBRL)];
    if (!creditoBRL) return json({ error: 'Valor de recarga inválido.' }, 400);

    // Um token só pras duas chamadas — renovar duas vezes seguidas seria
    // uma ida ao BTG à toa em cada recarga.
    const sessao = await tokenValido();

    const location = await chamarBtg('/pix-cash-in/locations', {
      method: 'POST',
      body: JSON.stringify({
        type: 'cob',
        description: `Creditos de IA Dr.Sig - R$ ${valorBRL}`,
      }),
    }, sessao);

    const cobranca = await chamarBtg('/pix-cash-in/instant-collections', {
      method: 'POST',
      body: JSON.stringify({
        pixKey: PIX_KEY,
        locationId: location?.id,
        amount: {
          original: valorBRL,
          // Valor fixo: se a pessoa pudesse mudar, pagaria R$ 1 e o webhook
          // creditaria o pacote inteiro. O confronto de valores no webhook
          // é a segunda barreira; esta é a primeira.
          allowCustomerChangeValue: false,
        },
      }),
    }, sessao);

    const txId = cobranca?.txId ?? cobranca?.txid ?? null;
    if (!txId) {
      return json({ error: 'O BTG criou a cobrança sem devolver o identificador.' }, 502);
    }

    const emv = cobranca?.emv ?? cobranca?.location?.integrationUrl ?? null;
    const qrCodeUrl = cobranca?.location?.url ?? location?.url ?? null;

    const { error } = await admin().from('recargas_credito').insert({
      user_id: userId,
      tx_id: txId,
      location_id: location?.id ?? null,
      valor_brl: valorBRL,
      credito_brl: creditoBRL,
      emv,
      qr_code_url: qrCodeUrl,
    });
    if (error) throw error;

    return json({ txId, emv, qrCodeUrl, valorBRL, creditoBRL });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
