// Edge Function: btg-oauth-iniciar
//
// Devolve a URL onde a conta do BTG da Dr.Sig é autorizada. Roda com JWT
// normal: quem chama é alguém logado no app.
//
// Diferente de Google e Zoom, esta conexão NÃO é por usuária — é a conta da
// empresa que recebe os Pix de todo mundo. Uma linha só em `btg_conexao`.
// Por isso a função é restrita a quem administra: qualquer usuária poder
// reconectar significaria qualquer usuária poder apontar o recebimento pra
// outra conta.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assinarEstado } from '../_shared/estadoOauth.ts';
import { urlDeAutorizacao, admin } from '../_shared/btg.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const comoUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await comoUsuario.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);

    const { data: perfil } = await admin()
      .from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle();
    if (perfil?.is_admin !== true) {
      return json({ error: 'Só a administração da Dr.Sig conecta a conta do BTG.' }, 403);
    }

    const state = await assinarEstado(userData.user.id, STATE_SECRET);
    return json({ url: urlDeAutorizacao(state) });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
