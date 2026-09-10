// Edge Function: btg-oauth-callback
//
// Recebe o código de autorização do BTG e guarda o refresh token da conta
// da empresa. Roda com --no-verify-jwt: quem chega aqui é a página
// btg-conectado.html depois do redirecionamento, sem sessão do app. Quem
// prova de quem é a conexão é o `state` assinado por HMAC.
//
// Não serve HTML de propósito — o Supabase reescreve text/html das Edge
// Functions pra text/plain, então a página estática é que fala com esta
// função. Mesmo arranjo do Google e do Zoom.
import { lerEstado } from '../_shared/estadoOauth.ts';
import {
  trocarCodigoPorTokens, descobrirCompanyId, admin, API_BASE,
} from '../_shared/btg.ts';

const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET')!;

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
    const { code, state } = await req.json().catch(() => ({}));
    if (!code || !state) return json({ error: 'Faltou o código ou o state.' }, 400);

    const userId = await lerEstado(String(state), STATE_SECRET);
    if (!userId) return json({ error: 'Autorização expirada. Comece de novo pelo app.' }, 401);

    const tokens = await trocarCodigoPorTokens(String(code));
    if (!tokens.refresh_token) {
      // Sem refresh token a conexão dura uma hora e morre calada, e a
      // primeira recarga depois disso falha sem explicação. Melhor recusar
      // agora, enquanto alguém está olhando.
      return json({
        error: 'O BTG não devolveu um token de renovação. Revogue o acesso do aplicativo na conta e autorize de novo.',
      }, 502);
    }

    const companyId = await descobrirCompanyId(tokens.access_token);
    if (!companyId) {
      return json({ error: 'Conectou, mas não consegui identificar a empresa na conta do BTG.' }, 502);
    }

    const ambiente = API_BASE.includes('sandbox') ? 'sandbox' : 'producao';
    const { error } = await admin().from('btg_conexao').upsert({
      id: 1,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expira_em: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      company_id: companyId,
      ambiente,
      conectado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    });
    if (error) throw error;

    return json({ ok: true, ambiente });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
