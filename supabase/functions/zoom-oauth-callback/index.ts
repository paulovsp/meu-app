// Edge Function: zoom-oauth-callback
// Recebe o código de autorização do Zoom e guarda o refresh_token da conta.
//
// Não serve HTML (o Supabase reescreve text/html pra text/plain no domínio
// dele): quem o Zoom redireciona é a página estática
// docs/zoom-conectado.html, que lê ?code=&state= e chama esta função.
// Roda com --no-verify-jwt; quem prova de quem é a conexão é o `state`
// assinado por HMAC.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { trocarCodigoPorTokens, chamarZoom } from '../_shared/zoom.ts';
import { lerEstado } from '../_shared/estadoOauth.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET')!;
const REDIRECT_URI = Deno.env.get('ZOOM_OAUTH_REDIRECT_URI')
  ?? 'https://app.drsig.com.br/zoom-conectado.html';

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
 * Confere se a conta consegue gerar transcrição, ANTES de a pessoa tentar
 * usar — descobrir depois da sessão significa a sessão perdida.
 *
 * Duas condições, ambas exigidas pelo Zoom: gravação em nuvem ligada
 * (planos Pro, Business, Education ou Enterprise) e transcrição de áudio
 * ligada nas configurações da conta.
 *
 * Se a consulta em si falhar, devolve `null` = "não deu pra confirmar", que
 * a tela mostra como aviso — bem diferente de afirmar que não funciona.
 */
async function testarTranscricao(accessToken: string): Promise<boolean | null> {
  try {
    const cfg = await chamarZoom(accessToken, '/users/me/settings?option=recording');
    // A resposta pode vir com as chaves na RAIZ ou aninhadas em `recording`.
    // O parâmetro `option` da Zoom só reconhece alguns valores (autenticação,
    // segurança da reunião); com `recording` ele é ignorado e a API devolve o
    // objeto completo de configurações, onde gravação fica em `recording`.
    // Aqui se lia só a forma achatada: as duas chaves vinham `undefined`, a
    // função devolvia "não deu pra confirmar", e a tela tratava isso como
    // "o plano não faz transcrição" — mesmo com tudo ligado na conta.
    // Aceitar as duas formas tira a dependência desse detalhe.
    const rec = (cfg && typeof cfg.recording === 'object' && cfg.recording !== null)
      ? cfg.recording
      : cfg;
    const nuvem = rec?.cloud_recording;
    const transcricao = rec?.recording_audio_transcript;
    if (typeof nuvem !== 'boolean' && typeof transcricao !== 'boolean') return null;
    return nuvem === true && transcricao === true;
  } catch (_) {
    return null;
  }
}

async function emailEnomeDaConta(accessToken: string) {
  try {
    const u = await chamarZoom(accessToken, '/users/me');
    const nome = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
    return { email: u?.email ?? null, nome: nome || u?.display_name || null };
  } catch (_) {
    return { email: null, nome: null };
  }
}

Deno.serve(servir('zoom-oauth-callback', async (req) => {
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
      return json({ error: 'O Zoom não devolveu a permissão de acesso contínuo. Tente conectar de novo.' }, 400);
    }

    const { email, nome } = await emailEnomeDaConta(tokens.access_token);
    const temTranscricao = await testarTranscricao(tokens.access_token);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin.from('integracoes_videochamada').upsert({
      user_id: userId,
      provedor: 'zoom',
      conta_email: email,
      // O nome do anfitrião é o que separa "A:" de "P:" na transcrição: o
      // VTT do Zoom traz o nome de quem falou em cada fala.
      conta_nome: nome,
      refresh_token: tokens.refresh_token,
      transcricao_automatica_disponivel: temTranscricao,
      capacidade_verificada_em: new Date().toISOString(),
      conectado_em: new Date().toISOString(),
      invalidado_em: null,
      invalidado_motivo: null,
    }, { onConflict: 'user_id,provedor' });
    if (error) return json({ error: `Erro ao salvar a conexão: ${error.message}` }, 500);

    return json({
      ok: true,
      contaEmail: email,
      transcricaoAutomaticaDisponivel: temTranscricao === true,
      naoDeuPraConfirmar: temTranscricao === null,
    });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}));
