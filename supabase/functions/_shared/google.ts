// OAuth do Google e chamadas à Meet REST API — compartilhado pelas functions
// google-oauth-iniciar, google-oauth-callback, meet-criar-sala e
// meet-buscar-transcricao.
//
// Por que o token fica no servidor: a transcrição da chamada só existe
// alguns minutos DEPOIS que a sessão acaba, quando o app pode estar fechado.
// Quem busca é um cron, então o refresh_token precisa estar acessível ao
// servidor — e nunca ao app (ver o GRANT por coluna na migration 0055).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
export const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const MEET_API = 'https://meet.googleapis.com/v2';

// meetings.space.created: criar a sala E ler os artefatos dela depois. Só dá
// acesso a salas criadas por ESTE app — é por isso que a sessão online passa
// a nascer no Dr.Sig em vez de num link do Calendar.
// meetings.space.settings: ligar a transcrição automática na sala.
// Nenhum escopo de Drive: o texto vem pela própria Meet API, e Drive seria
// escopo RESTRITO (auditoria de segurança anual e paga).
export const ESCOPOS_GOOGLE = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.settings',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function urlDeConsentimento(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS_GOOGLE,
    // offline + consent é o que garante que venha refresh_token — sem ele
    // só dá pra usar enquanto a pessoa está com o app aberto, e a busca da
    // transcrição acontece depois.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH_URL}?${p}`;
}

export async function trocarCodigoPorTokens(code: string, redirectUri: string) {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const corpo = await resp.json();
  if (!resp.ok) throw new Error(corpo?.error_description || corpo?.error || 'Falha ao trocar o código pelo token.');
  return corpo as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function emailDaConta(accessToken: string): Promise<string | null> {
  const resp = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return null;
  const corpo = await resp.json();
  return corpo?.email ?? null;
}

/** Erro de acesso perdido (token revogado ou expirado). Tratado à parte
 *  porque a saída não é "deu erro", é "reconecte sua conta Google". */
export class IntegracaoInvalidaError extends Error {
  constructor(msg = 'A conexão com o Google expirou ou foi revogada. Reconecte sua conta.') {
    super(msg);
    this.name = 'IntegracaoInvalidaError';
  }
}

/**
 * Access token válido pra este usuário, a partir do refresh_token guardado.
 *
 * Enquanto o app OAuth estiver em "Testing" no Google, o refresh_token
 * expira em 7 dias — então `invalid_grant` é esperado e vira um pedido de
 * reconexão, com a integração marcada como inválida pra tela avisar antes
 * de a pessoa tentar usar.
 */
export async function accessTokenDoUsuario(
  admin: SupabaseClient,
  userId: string,
  provedor = 'google_meet',
): Promise<string> {
  const { data: integracao } = await admin
    .from('integracoes_videochamada')
    .select('refresh_token, invalidado_em')
    .eq('user_id', userId)
    .eq('provedor', provedor)
    .maybeSingle();

  if (!integracao?.refresh_token) {
    throw new IntegracaoInvalidaError('Nenhuma conta do Google conectada.');
  }

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: integracao.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const corpo = await resp.json();

  if (!resp.ok) {
    if (corpo?.error === 'invalid_grant') {
      await admin
        .from('integracoes_videochamada')
        .update({
          invalidado_em: new Date().toISOString(),
          invalidado_motivo: 'Acesso expirado ou revogado no Google.',
        })
        .eq('user_id', userId)
        .eq('provedor', provedor);
      throw new IntegracaoInvalidaError();
    }
    throw new Error(corpo?.error_description || corpo?.error || 'Falha ao renovar o acesso ao Google.');
  }

  // Voltou a funcionar depois de ter sido marcada como inválida.
  if (integracao.invalidado_em) {
    await admin
      .from('integracoes_videochamada')
      .update({ invalidado_em: null, invalidado_motivo: null })
      .eq('user_id', userId)
      .eq('provedor', provedor);
  }

  return corpo.access_token as string;
}

export async function chamarMeet(accessToken: string, caminho: string, init: RequestInit = {}) {
  const resp = await fetch(`${MEET_API}/${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = corpo?.error?.message || `Erro ${resp.status} na API do Google Meet.`;
    throw new Error(msg);
  }
  return corpo;
}
