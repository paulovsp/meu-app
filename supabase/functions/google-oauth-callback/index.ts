// Edge Function: google-oauth-callback
// Recebe o código de autorização do Google e guarda o refresh_token da conta.
//
// Não serve HTML de propósito: o Supabase reescreve text/html pra text/plain
// e aplica CSP sandbox no domínio dele (mesma razão explicada em
// confirmar-autorizacao). Quem o Google redireciona é a página estática
// docs/google-conectado.html (GitHub Pages), que lê ?code=&state= e chama
// esta função via fetch.
//
// Roda sem JWT (--no-verify-jwt): quem chega aqui é um navegador voltando do
// Google, que não tem a sessão do app. Quem prova de quem é a conexão é o
// `state` assinado por HMAC (ver _shared/estadoOauth.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  trocarCodigoPorTokens, emailDaConta, chamarMeet,
} from '../_shared/google.ts';
import { lerEstado } from '../_shared/estadoOauth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET')!;
const REDIRECT_URI = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
  ?? 'https://app.drsig.com.br/google-conectado.html';

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

/**
 * Descobre se a conta consegue gerar transcrição automática, criando uma
 * sala de teste com a opção ligada e lendo de volta o que o Google aceitou.
 *
 * O usuário pediu explicitamente que a falta de plano seja detectada ANTES
 * de a pessoa tentar usar — descobrir depois da sessão significa a sessão
 * perdida. Só o Business Plus, Enterprise Standard/Plus, Education Plus e
 * Enterprise Essentials geram transcrição automática.
 *
 * A sala de teste é descartável: o Google expira salas que nunca receberam
 * chamada, e nada é agendado nem enviado pra ninguém.
 */
async function testarTranscricaoAutomatica(accessToken: string): Promise<boolean> {
  try {
    const sala = await chamarMeet(accessToken, 'spaces', {
      method: 'POST',
      body: JSON.stringify({
        config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } } },
      }),
    });
    // Se o plano não suporta, o Google não devolve ON aqui.
    const modo = sala?.config?.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration;
    return modo === 'ON';
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const { code, state } = await req.json().catch(() => ({}));
    if (!code || !state) return json({ error: 'Código ou state ausente.' }, 400);

    const userId = await lerEstado(state, STATE_SECRET);
    if (!userId) {
      return json({ error: 'Este link de conexão expirou. Tente conectar de novo pelo app.' }, 400);
    }

    const tokens = await trocarCodigoPorTokens(code, REDIRECT_URI);
    if (!tokens.refresh_token) {
      // Acontece quando a conta já tinha autorizado antes e o Google não
      // reemite o refresh_token. `prompt=consent` na URL evita isso; se
      // ainda assim vier vazio, revogar o acesso e reconectar resolve.
      return json({
        error: 'O Google não devolveu a permissão de acesso contínuo. '
          + 'Remova o Dr.Sig em myaccount.google.com/permissions e conecte de novo.',
      }, 400);
    }

    const email = await emailDaConta(tokens.access_token);
    const temTranscricao = await testarTranscricaoAutomatica(tokens.access_token);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin.from('integracoes_videochamada').upsert({
      user_id: userId,
      provedor: 'google_meet',
      conta_email: email,
      refresh_token: tokens.refresh_token,
      transcricao_automatica_disponivel: temTranscricao,
      capacidade_verificada_em: new Date().toISOString(),
      conectado_em: new Date().toISOString(),
      invalidado_em: null,
      invalidado_motivo: null,
    }, { onConflict: 'user_id,provedor' });
    if (error) return json({ error: `Erro ao salvar a conexão: ${error.message}` }, 500);

    return json({ ok: true, contaEmail: email, transcricaoAutomaticaDisponivel: temTranscricao });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
