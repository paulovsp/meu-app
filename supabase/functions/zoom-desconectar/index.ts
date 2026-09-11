// Edge Function: zoom-desconectar
//
// Desconectar o Zoom pela tela só apagava a linha de `integracoes_videochamada`.
// Do lado do Zoom a autorização continuava valendo — e a prova disso é que
// "Conectar" logo em seguida voltava direto pra mesma conta, sem perguntar
// qual. Quem quisesse trocar de conta não tinha por onde.
//
// A revogação precisa do refresh_token, e o app não tem permissão de ler
// essa coluna (GRANT por coluna, migration 0055) — de propósito: o token
// nunca deve trafegar até o aparelho. Por isso isto é servidor.
//
// Roda com JWT normal: quem desconecta é a própria dona da conexão.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { revogarAcesso } from '../_shared/zoom.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

Deno.serve(servir('zoom-desconectar', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseUser.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Sessão inválida.' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: integracao } = await admin
      .from('integracoes_videochamada')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provedor', 'zoom')
      .maybeSingle();

    // Já não havia conexão: o resultado desejado já é o estado atual.
    if (!integracao) return json({ ok: true, jaDesconectado: true });

    const revogado = await revogarAcesso(integracao.refresh_token);

    // A linha some mesmo se a revogação falhar: o token guardado aqui é o
    // que dá acesso às gravações, e deixá-lo no banco por causa de um erro
    // de rede seria o pior dos dois mundos.
    const { error } = await admin
      .from('integracoes_videochamada')
      .delete()
      .eq('user_id', userId)
      .eq('provedor', 'zoom');
    if (error) return json({ error: `Erro ao desconectar: ${error.message}` }, 500);

    return json({ ok: true, revogadoNoZoom: revogado });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}));
