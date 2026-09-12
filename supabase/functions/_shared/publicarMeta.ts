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

const GRAPH = 'https://graph.facebook.com/v21.0';

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

export type Publicacao = { id: string; permalink: string | null };

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
  return { id, permalink: info.permalink ? String(info.permalink) : null };
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
  const info = await graph(id, { fields: 'permalink_url' }, 'GET').catch(() => ({} as Record<string, unknown>));
  return { id, permalink: info.permalink_url ? String(info.permalink_url) : `https://www.facebook.com/${id.split('_')[1] || id}` };
}

/** Diagnóstico: o token vale? Que Página e que conta do Instagram ele vê? */
export async function verificarMeta(): Promise<Record<string, unknown>> {
  const { pageId, igId } = segredos();
  const pagina = await graph(pageId, { fields: 'id,name,instagram_business_account' }, 'GET');
  const ig = igId ? await graph(igId, { fields: 'id,username' }, 'GET').catch((e) => ({ erro: String(e.message) })) : null;
  return { pagina, instagram: ig };
}
