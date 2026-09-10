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

// Três produtos, três escopos. Faltando um, o token sai válido e a chamada
// daquele produto é recusada — e o erro só aparece na primeira cobrança.
//   pix-cash-in        cobrança Pix avulsa (recarga de créditos)
//   banking:collections Pix Automático (assinatura recorrente)
//   payment-link       link de pagamento no cartão
export const ESCOPOS = [
  'openid',
  'empresas.btgpactual.com/pix-cash-in',
  'brn:btg:empresas:banking:collections',
  'brn:btg:empresas:payment-link',
].join(' ');

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

/**
 * Chamada autenticada.
 *
 * O BTG tem DUAS formas de URL, e confundi-las rende 404 sem explicação:
 *
 *   /v1/companies/{companyId}/pix-cash-in/...   cobrança Pix avulsa
 *   /{companyId}/banking/...                    todo o resto (collections,
 *                                               payment-link, accounts)
 *
 * `familia` escolhe entre as duas. O padrão é a primeira porque foi a
 * primeira a existir aqui.
 */
export async function chamarBtg(
  caminho: string,
  init: RequestInit = {},
  tokenEmpresa?: { token: string; companyId: string },
  familia: 'pix' | 'banking' = 'pix',
) {
  const { token, companyId } = tokenEmpresa ?? await tokenValido();
  const url = familia === 'banking'
    ? `${API_BASE}/${companyId}${caminho}`
    : `${API_BASE}/v1/companies/${companyId}${caminho}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // O sandbox do BTG é um Wiremock: sem este cabeçalho ele não sabe se
      // deve devolver sucesso ou erro, e responde de um jeito que não
      // corresponde a nada. Em produção é ignorado.
      ...(API_BASE.includes('sandbox') ? { 'x-response': 'success' } : {}),
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
 * O `companyId` do BTG é o CNPJ da empresa, só dígitos — a documentação diz
 * isso no parâmetro de caminho ("CNPJ da empresa", exemplo 30306294000145).
 * Não é pedido no cadastro do aplicativo, então é descoberto uma vez no
 * callback do OAuth e fica guardado.
 *
 * `BTG_COMPANY_ID` sobrescreve tudo: é a saída quando a consulta não
 * devolve o que se espera, e evita ficar refazendo o OAuth pra corrigir um
 * número que já se sabe qual é.
 */
export async function descobrirCompanyId(token: string): Promise<string | null> {
  const daMao = Deno.env.get('BTG_COMPANY_ID');
  if (daMao) return daMao.replace(/\D/g, '');

  const resp = await fetch(`${API_BASE}/v1/companies`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const dados = await resp.json().catch(() => null);
  const lista = Array.isArray(dados) ? dados : (dados?.items ?? dados?.companies ?? []);
  const bruto = lista?.[0]?.taxId ?? lista?.[0]?.cnpj ?? lista?.[0]?.id ?? lista?.[0]?.companyId;
  return bruto ? String(bruto).replace(/\D/g, '') : null;
}

/** Conta que recebe — número e agência, exigidos pela autorização. */
export async function contaDaEmpresa(sessao?: { token: string; companyId: string }) {
  const dados = await chamarBtg('/banking/accounts', {}, sessao, 'banking');
  const lista = Array.isArray(dados) ? dados : (dados?.items ?? dados?.accounts ?? []);
  const c = lista?.[0];
  if (!c) return null;
  return {
    number: String(c.number ?? c.accountNumber ?? ''),
    branch: String(c.branch ?? c.branchCode ?? ''),
  };
}

// ─── Cartão de crédito, via link de pagamento ─────────────────────────
//
// O BTG Pay aceita Visa, Elo, Amex e Mastercard em até 12x, além de Pix e
// boleto. Diferente do Pix, cartão tem custo de adquirência — repassado ao
// cliente como acréscimo, dito na tela ANTES da escolha.
//
// O acréscimo mora aqui, num lugar só: mudá-lo em dois arquivos diferentes
// é como um dia se cobra 5% e se mostra 3%.
export const ACRESCIMO_CARTAO = 0.05;

export function comAcrescimoDeCartao(valorBRL: number): number {
  return Math.round(valorBRL * (1 + ACRESCIMO_CARTAO) * 100) / 100;
}

// ⚠️ Valor do enum não confirmado na documentação: as fichas técnicas do
// BTG só trazem exemplos com BANKSLIP, e a página de referência que lista
// os valores aceitos não abre (a documentação deles é uma SPA que
// redireciona). A página do produto confirma que cartão existe. Se o BTG
// recusar a criação do link reclamando de `paymentMethods`, é esta linha.
export const METODO_CARTAO = 'CREDIT_CARD';

/**
 * Cria um link de pagamento do BTG para pagar no cartão.
 *
 * Devolve `{ id, linkUrl }`. O pagamento chega depois pelo webhook, como
 * `payment-link.paid` — é lá que o acesso é liberado, nunca aqui: quem
 * cria o link não sabe se ele foi pago.
 */
export async function criarLinkDeCartao(opcoes: {
  nome: string;
  valorBRL: number;
  validadeHoras?: number;
  sessao?: { token: string; companyId: string };
}) {
  const agora = new Date();
  const fim = new Date(agora.getTime() + (opcoes.validadeHoras ?? 24) * 3600_000);

  const resposta = await chamarBtg('/banking/payment-link', {
    method: 'POST',
    body: JSON.stringify({
      name: opcoes.nome,
      amount: opcoes.valorBRL,
      paymentMethods: [METODO_CARTAO],
      type: 'SINGLE',
      schedule: { startAt: agora.toISOString(), endAt: fim.toISOString() },
    }),
  }, opcoes.sessao, 'banking');

  return {
    id: resposta?.id ?? null,
    linkUrl: resposta?.linkUrl ?? null,
  };
}
