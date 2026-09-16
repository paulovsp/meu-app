// Publicação no Instagram e no Facebook pela Graph API da Meta.
//
// Os segredos ficam aqui, na função, e nunca no ambiente dos agentes: o
// Publicador só diz "publique estas imagens com este texto neste canal" pela
// op-agente. Precisa de três segredos no Supabase:
//   META_PAGE_TOKEN   token de página de longa duração (não expira quando
//                     gerado a partir de um token de usuária de longa duração)
//   META_PAGE_ID      id da Página do Facebook do Dr.Sig
//   META_IG_USER_ID   id da conta profissional do Instagram (@oseusig) ligada
//                     a essa Página
//
// Instagram: cada imagem vira um "container"; um carrossel é um container
// que aponta para os filhos; depois `media_publish`. As imagens precisam
// estar numa URL pública — as artes vivem em drsig.com.br/marketing/…
// Facebook: fotos sobem sem publicar e entram juntas num post da Página.
//
// Duas garantias que não existiam no começo (16/09/2026):
// - antes de publicar, cada imagem é buscada de verdade e a legenda é
//   medida contra os limites da rede — uma URL errada ou uma legenda longa
//   demais parava no meio e deixava metade do carrossel criada;
// - depois de publicar, o post é lido de volta (tipo e número de quadros)
//   e comparado com o pedido. Publicar sem conferir é como não publicar.

const GRAPH = 'https://graph.facebook.com/v21.0';

// Limites documentados da Meta.
const IG_LEGENDA_MAX = 2200;
const IG_HASHTAGS_MAX = 30;
const FB_TEXTO_MAX = 63206;

function segredos() {
  const token = Deno.env.get('META_PAGE_TOKEN') || '';
  const pageId = Deno.env.get('META_PAGE_ID') || '';
  const igId = Deno.env.get('META_IG_USER_ID') || '';
  if (!token || !pageId) throw new Error('META_PAGE_TOKEN/META_PAGE_ID não configurados.');
  return { token, pageId, igId };
}

async function graph(caminho: string, params: Record<string, string>, metodo: 'GET' | 'POST' = 'POST'): Promise<Record<string, unknown>> {
  const { token } = segredos();
  const corpo = new URLSearchParams({ ...params, access_token: token });
  const url = metodo === 'GET' ? `${GRAPH}/${caminho}?${corpo}` : `${GRAPH}/${caminho}`;
  const r = await fetch(url, metodo === 'GET' ? {} : { method: 'POST', body: corpo });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = (j.error || {}) as { message?: string; code?: number; error_subcode?: number };
    throw new Error(`Meta ${caminho}: ${e.message || r.status}${e.code ? ` (código ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''}`);
  }
  return j;
}

async function esperarContainer(id: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const j = await graph(id, { fields: 'status_code,status' }, 'GET');
    const s = String(j.status_code || '');
    if (s === 'FINISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`container ${id}: ${s} ${String(j.status || '')}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`container ${id}: não ficou pronto a tempo`);
}

// ── Validação antes de publicar ─────────────────────────────────────────

/** Cada imagem precisa existir e ser imagem, vista de fora (como a Meta vê). */
export async function validarImagens(imagens: string[]): Promise<void> {
  for (const url of imagens) {
    let r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!r || !r.ok) r = await fetch(url, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    if (!r || !(r.ok || r.status === 206)) throw new Error(`imagem indisponível (${r ? r.status : 'sem resposta'}): ${url}`);
    const tipo = (r.headers.get('content-type') || '').toLowerCase();
    if (!tipo.startsWith('image/')) throw new Error(`não é imagem (${tipo || 'sem content-type'}): ${url}`);
  }
}

/** Limites da rede, medidos aqui para o erro dizer o que corrigir. */
export function validarTexto(canal: 'instagram' | 'facebook', texto: string): void {
  if (canal === 'instagram') {
    if (texto.length > IG_LEGENDA_MAX) throw new Error(`legenda com ${texto.length} caracteres; o Instagram aceita ${IG_LEGENDA_MAX}.`);
    const hashtags = (texto.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
    if (hashtags > IG_HASHTAGS_MAX) throw new Error(`legenda com ${hashtags} hashtags; o Instagram aceita ${IG_HASHTAGS_MAX}.`);
  } else if (texto.length > FB_TEXTO_MAX) {
    throw new Error(`texto com ${texto.length} caracteres; o Facebook aceita ${FB_TEXTO_MAX}.`);
  }
}

// ── Publicação ──────────────────────────────────────────────────────────

export type Publicacao = {
  id: string;
  permalink: string | null;
  /** O que a rede diz que ficou publicado, lido de volta. */
  conferencia: { tipo: string; quadros: number; legenda: boolean } | null;
  /** Preenchido quando o que ficou no ar difere do pedido. */
  alerta: string | null;
};

/** Lê o post de volta e compara com o que foi pedido. */
async function conferirInstagram(id: string, quadrosPedidos: number, legendaPedida: string): Promise<Pick<Publicacao, 'conferencia' | 'alerta'>> {
  const j = await graph(id, { fields: 'media_type,caption,children{id}' }, 'GET').catch(() => null);
  if (!j) return { conferencia: null, alerta: 'não foi possível ler o post de volta para conferir.' };
  const tipo = String(j.media_type || '');
  const filhos = ((j.children as { data?: unknown[] } | undefined)?.data || []).length;
  const quadros = tipo === 'CAROUSEL_ALBUM' ? filhos : 1;
  const legenda = String(j.caption || '') === legendaPedida;
  const problemas: string[] = [];
  if (quadrosPedidos > 1 && tipo !== 'CAROUSEL_ALBUM') problemas.push(`pedido carrossel de ${quadrosPedidos}, ficou ${tipo || 'tipo desconhecido'}`);
  if (quadros !== quadrosPedidos) problemas.push(`pedidos ${quadrosPedidos} quadros, ficaram ${quadros}`);
  if (!legenda) problemas.push('a legenda publicada difere da pedida');
  return { conferencia: { tipo, quadros, legenda }, alerta: problemas.length ? problemas.join('; ') : null };
}

/** Instagram: uma imagem ou um carrossel (2 a 10 imagens). */
export async function publicarInstagram(imagens: string[], legenda: string): Promise<Publicacao> {
  const { igId } = segredos();
  if (!igId) throw new Error('META_IG_USER_ID não configurado.');
  if (imagens.length < 1 || imagens.length > 10) throw new Error('Instagram aceita de 1 a 10 imagens.');

  let creationId: string;
  if (imagens.length === 1) {
    const c = await graph(`${igId}/media`, { image_url: imagens[0], caption: legenda });
    creationId = String(c.id);
  } else {
    const filhos: string[] = [];
    for (const url of imagens) {
      const c = await graph(`${igId}/media`, { image_url: url, is_carousel_item: 'true' });
      filhos.push(String(c.id));
    }
    const c = await graph(`${igId}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
    creationId = String(c.id);
  }
  await esperarContainer(creationId);
  const pub = await graph(`${igId}/media_publish`, { creation_id: creationId });
  const id = String(pub.id);
  const info = await graph(id, { fields: 'permalink' }, 'GET').catch(() => ({} as Record<string, unknown>));
  const conferido = await conferirInstagram(id, imagens.length, legenda);
  return { id, permalink: info.permalink ? String(info.permalink) : null, ...conferido };
}

/** Facebook: post da Página com uma ou mais fotos e o texto. */
export async function publicarFacebook(imagens: string[], texto: string): Promise<Publicacao> {
  const { pageId } = segredos();
  if (imagens.length < 1) throw new Error('Facebook: nenhuma imagem.');
  const fotos: string[] = [];
  for (const url of imagens) {
    const f = await graph(`${pageId}/photos`, { url, published: 'false' });
    fotos.push(String(f.id));
  }
  const params: Record<string, string> = { message: texto };
  fotos.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const post = await graph(`${pageId}/feed`, params);
  const id = String(post.id);
  // O id "pagina_post" não vira link válido; o permalink real vem da API.
  const info = await graph(id, { fields: 'permalink_url,message,attachments{subattachments}' }, 'GET').catch(() => ({} as Record<string, unknown>));
  const anexos = (info.attachments as { data?: { subattachments?: { data?: unknown[] } }[] } | undefined)?.data?.[0];
  const quadros = anexos?.subattachments?.data?.length ?? (anexos ? 1 : 0);
  const legenda = String(info.message || '') === texto;
  const problemas: string[] = [];
  if (info.permalink_url && quadros !== imagens.length) problemas.push(`pedidas ${imagens.length} fotos, ficaram ${quadros}`);
  if (info.permalink_url && !legenda) problemas.push('o texto publicado difere do pedido');
  return {
    id,
    permalink: info.permalink_url ? String(info.permalink_url) : `https://www.facebook.com/${id.split('_')[1] || id}`,
    conferencia: info.permalink_url ? { tipo: quadros > 1 ? 'ALBUM' : 'PHOTO', quadros, legenda } : null,
    alerta: problemas.length ? problemas.join('; ') : (info.permalink_url ? null : 'não foi possível ler o post de volta para conferir.'),
  };
}

/** Apaga um post da Página (id no formato "pagina_post"). O Instagram não permite apagar pela API. */
export async function apagarFacebook(postId: string): Promise<void> {
  const { token } = segredos();
  const r = await fetch(`${GRAPH}/${postId}`, { method: 'DELETE', body: new URLSearchParams({ access_token: token }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.success === false) throw new Error(`Meta apagar ${postId}: ${(j.error && j.error.message) || r.status}`);
}

// ── Inventário ──────────────────────────────────────────────────────────

export type MidiaInstagram = { id: string; tipo: string; quadros: number; legenda: string; permalink: string; publicado_em: string };
export type PostFacebook = { id: string; fotos: number; texto: string; permalink: string; publicado_em: string };

/** O que está no ar no Instagram, do mais novo ao mais antigo. */
export async function listarInstagram(limite = 50): Promise<MidiaInstagram[]> {
  const { igId } = segredos();
  if (!igId) throw new Error('META_IG_USER_ID não configurado.');
  const j = await graph(`${igId}/media`, { fields: 'id,media_type,caption,permalink,timestamp,children{id}', limit: String(Math.min(Math.max(limite, 1), 100)) }, 'GET');
  return ((j.data as Record<string, unknown>[]) || []).map((m) => {
    const tipo = String(m.media_type || '');
    const filhos = ((m.children as { data?: unknown[] } | undefined)?.data || []).length;
    return {
      id: String(m.id),
      tipo,
      quadros: tipo === 'CAROUSEL_ALBUM' ? filhos : 1,
      legenda: String(m.caption || ''),
      permalink: String(m.permalink || ''),
      publicado_em: String(m.timestamp || ''),
    };
  });
}

/** O que está no ar na Página do Facebook, do mais novo ao mais antigo. */
export async function listarFacebook(limite = 50): Promise<PostFacebook[]> {
  const { pageId } = segredos();
  const j = await graph(`${pageId}/posts`, { fields: 'id,message,permalink_url,created_time,attachments{subattachments}', limit: String(Math.min(Math.max(limite, 1), 100)) }, 'GET');
  return ((j.data as Record<string, unknown>[]) || []).map((p) => {
    const anexo = (p.attachments as { data?: { subattachments?: { data?: unknown[] } }[] } | undefined)?.data?.[0];
    return {
      id: String(p.id),
      fotos: anexo?.subattachments?.data?.length ?? (anexo ? 1 : 0),
      texto: String(p.message || ''),
      permalink: String(p.permalink_url || ''),
      publicado_em: String(p.created_time || ''),
    };
  });
}

/** Diagnóstico: o token vale? Que Página e que conta do Instagram ele vê? */
export async function verificarMeta(): Promise<Record<string, unknown>> {
  const { pageId, igId } = segredos();
  const pagina = await graph(pageId, { fields: 'id,name,instagram_business_account' }, 'GET');
  const ig = igId ? await graph(igId, { fields: 'id,username' }, 'GET').catch((e) => ({ erro: String(e.message) })) : null;
  return { pagina, instagram: ig };
}
