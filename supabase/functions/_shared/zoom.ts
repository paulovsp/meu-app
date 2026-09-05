// OAuth do Zoom e chamadas à API de reuniões/gravações — compartilhado
// pelas functions zoom-oauth-iniciar, zoom-oauth-callback,
// zoom-criar-reuniao e zoom-webhook.
//
// Mesmo desenho já validado no Google Meet (_shared/google.ts): o
// refresh_token fica no servidor, nunca no app (GRANT por coluna, migration
// 0055), porque o texto da sessão só existe depois que a chamada termina,
// quando o app pode estar fechado.
//
// Diferença em relação ao Meet: o Zoom avisa por webhook quando a gravação
// e a transcrição ficam prontas, então não há cron de varredura aqui.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
export { vttParaTurnos } from './vtt.ts';

export const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID') ?? '';
export const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET') ?? '';

const OAUTH_AUTH_URL = 'https://zoom.us/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://zoom.us/oauth/token';
export const ZOOM_API = 'https://api.zoom.us/v2';

// Escopos granulares (o Zoom migrou dos clássicos):
//   meeting:write:meeting                     -> criar a reunião com gravação automática
//   cloud_recording:read:list_recording_files -> achar o arquivo de transcrição
//   user:read:user                            -> nome do anfitrião (separa "A:" de "P:")
//   user:read:settings                        -> conferir se a conta gera transcrição
// Precisam bater EXATAMENTE com os escopos marcados no app do Marketplace:
// pedir um escopo não cadastrado faz o Zoom recusar a autorização inteira.
// Nenhum escopo de leitura de conteúdo além do necessário.
export const ESCOPOS_ZOOM = [
  'meeting:write:meeting',
  'cloud_recording:read:list_recording_files',
  'user:read:user',
  'user:read:settings',
].join(' ');

function basicAuth() {
  return `Basic ${btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`)}`;
}

export function urlDeConsentimento(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: ZOOM_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });
  return `${OAUTH_AUTH_URL}?${p}`;
}

export async function trocarCodigoPorTokens(code: string, redirectUri: string) {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const corpo = await resp.json();
  if (!resp.ok) throw new Error(corpo?.reason || corpo?.error || 'Falha ao trocar o código pelo token.');
  return corpo as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Acesso perdido (token revogado ou expirado) — a saída não é "deu erro",
 *  é "reconecte sua conta do Zoom". */
export class IntegracaoInvalidaError extends Error {
  constructor(msg = 'A conexão com o Zoom expirou ou foi revogada. Reconecte sua conta.') {
    super(msg);
    this.name = 'IntegracaoInvalidaError';
  }
}

/**
 * Access token válido a partir do refresh_token guardado.
 *
 * O Zoom ROTACIONA o refresh token a cada renovação e invalida o anterior —
 * o valor novo precisa ser gravado na hora, senão a conexão morre sozinha
 * na renovação seguinte. (É o mesmo tipo de falha que fazia o login por
 * digital "não segurar ligado" no app; aqui já nasce tratado.)
 */
export async function accessTokenDoUsuario(
  admin: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: integracao } = await admin
    .from('integracoes_videochamada')
    .select('refresh_token, invalidado_em')
    .eq('user_id', userId)
    .eq('provedor', 'zoom')
    .maybeSingle();

  if (!integracao?.refresh_token) {
    throw new IntegracaoInvalidaError('Nenhuma conta do Zoom conectada.');
  }

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integracao.refresh_token,
    }),
  });
  const corpo = await resp.json();

  if (!resp.ok) {
    await admin
      .from('integracoes_videochamada')
      .update({
        invalidado_em: new Date().toISOString(),
        invalidado_motivo: 'Acesso expirado ou revogado no Zoom.',
      })
      .eq('user_id', userId)
      .eq('provedor', 'zoom');
    throw new IntegracaoInvalidaError();
  }

  // Rotação: guarda o token novo IMEDIATAMENTE — o anterior já não vale.
  if (corpo.refresh_token) {
    await admin
      .from('integracoes_videochamada')
      .update({
        refresh_token: corpo.refresh_token,
        invalidado_em: null,
        invalidado_motivo: null,
      })
      .eq('user_id', userId)
      .eq('provedor', 'zoom');
  }

  return corpo.access_token as string;
}

export async function chamarZoom(accessToken: string, caminho: string, init: RequestInit = {}) {
  const resp = await fetch(`${ZOOM_API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(corpo?.message || `Erro ${resp.status} na API do Zoom.`);
  }
  return corpo;
}
