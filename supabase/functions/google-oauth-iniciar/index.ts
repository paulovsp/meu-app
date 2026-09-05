// Edge Function: google-oauth-iniciar
// Devolve pro app a URL da tela de consentimento do Google. O app abre essa
// URL no navegador; quem recebe a volta é `google-oauth-callback`.
//
// Existe separada (em vez de o app montar a URL) por dois motivos: o
// client_id não precisa sair do servidor, e o `state` é assinado aqui, com
// um segredo que só o servidor tem.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { urlDeConsentimento, GOOGLE_CLIENT_ID } from '../_shared/google.ts';
import { assinarEstado } from '../_shared/estadoOauth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    if (!GOOGLE_CLIENT_ID) {
      return json({ error: 'A integração com o Google ainda não foi configurada.' }, 503);
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
    const state = await assinarEstado(userData.user.id, STATE_SECRET);
    return json({ url: urlDeConsentimento(redirectUri, state) });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
