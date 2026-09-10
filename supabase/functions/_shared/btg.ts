// ─── Conversa com a API do BTG Pactual Empresas ───────────────────────
//
// O que este módulo esconde de quem chama: onde ficam as URLs, como o
// token é renovado, e o fato de que toda rota carrega um `companyId` que
// só se descobre depois de autorizar.
//
// Autorização: Authorization Code. O BTG não oferece client_credentials
// pra o escopo pix-cash-in, então alguém da Dr.Sig autoriza uma vez no
// navegador e o refresh token fica em `btg_conexao` — mesmo desenho que
// Google e Zoom já usam aqui.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('BTG_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('BTG_CLIENT_SECRET')!;

// Sobrescritíveis por secret: a virada de sandbox pra produção troca as
// duas URLs e mais nada. Deixar em variável evita um deploy só pra mudar
// de ambiente — e evita alguém editar a constante errada na pressa.
export const API_BASE = Deno.env.get('BTG_API_BASE')
  ?? 'https://api.sandbox.empresas.btgpactual.com';
export const ID_BASE = Deno.env.get('BTG_ID_BASE')
  ?? 'https://id.btgpactual.com';

export const REDIRECT_URI = Deno.env.get('BTG_OAUTH_REDIRECT_URI')
  ?? 'https://app.drsig.com.br/btg-conectado.html';

export const ESCOPOS = 'openid empresas.btgpactual.com/pix-cash-in';

export function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** URL pra onde a pessoa vai autorizar o acesso à conta. */
export function urlDeAutorizacao(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: ESCOPOS,
    state,
    // Sem `prompt=consent` o BTG pode devolver um code sem refresh_token
    // quando a conta já autorizou antes — e aí a conexão dura uma hora e
    // morre calada.
    prompt: 'consent',
  });
  return `${ID_BASE}/oauth2/authorize?${p.toString()}`;
}

function basic(): string {
  return 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
}

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

async function pedirTokens(corpo: Record<string, string>): Promise<Tokens> {
  const resp = await fetch(`${ID_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basic(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(corpo).toString(),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`BTG /oauth2/token ${resp.status}: ${texto}`);
  return JSON.parse(texto);
}

export function trocarCodigoPorTokens(code: string) {
  return pedirTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
}

/**
 * Access token válido, renovando quando falta pouco.
 *
 * A margem de 60s existe porque o token pode expirar entre a checagem e a
 * chamada seguinte — sem ela, uma cobrança falharia de vez em quando, sem
 * padrão, que é o tipo de erro mais caro de investigar.
 */
export async function tokenValido(): Promise<{ token: string; companyId: string }> {
  const db = admin();
  const { data: conexao } = await db
    .from('btg_conexao').select('*').eq('id', 1).maybeSingle();
  if (!conexao) throw new Error('A conta do BTG ainda não foi conectada.');

  const folga = 60_000;
  const aindaVale = conexao.access_token
    && conexao.expira_em
    && new Date(conexao.expira_em).getTime() - Date.now() > folga;

  if (aindaVale) {
    return { token: conexao.access_token, companyId: conexao.company_id };
  }

  const t = await pedirTokens({
    grant_type: 'refresh_token',
    refresh_token: conexao.refresh_token,
  });
  await db.from('btg_conexao').update({
    access_token: t.access_token,
    // Alguns provedores rotacionam o refresh token a cada uso; se vier um
    // novo, o antigo deixa de valer. Guardar o que veio é o que impede a
    // conexão de morrer depois de algumas horas.
    refresh_token: t.refresh_token ?? conexao.refresh_token,
    expira_em: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    atualizado_em: new Date().toISOString(),
  }).eq('id', 1);

  return { token: t.access_token, companyId: conexao.company_id };
}

/** Chamada autenticada, com o companyId já no caminho. */
export async function chamarBtg(
  caminho: string,
  init: RequestInit = {},
  tokenEmpresa?: { token: string; companyId: string },
) {
  const { token, companyId } = tokenEmpresa ?? await tokenValido();
  const url = `${API_BASE}/v1/companies/${companyId}${caminho}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`BTG ${caminho} ${resp.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

/**
 * Descobre o companyId a partir do token recém-obtido.
 *
 * Não é pedido em lugar nenhum do cadastro do aplicativo: só aparece
 * consultando as contas a que o token dá acesso. Por isso roda uma vez, no
 * callback do OAuth, e fica guardado.
 */
export async function descobrirCompanyId(token: string): Promise<string | null> {
  const resp = await fetch(`${API_BASE}/v1/companies`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const dados = await resp.json().catch(() => null);
  const lista = Array.isArray(dados) ? dados : (dados?.items ?? dados?.companies ?? []);
  return lista?.[0]?.id ?? lista?.[0]?.companyId ?? null;
}
