// `state` do OAuth: liga a volta do Google ao usuário que começou o fluxo.
//
// O callback do Google chega SEM o JWT do app (é o navegador do Google que
// bate na function), então o único jeito de saber de quem é aquele código é
// o `state`. Ele vai assinado com HMAC por um segredo que só o servidor tem
// — se alguém forjar um state pra outro user_id, a assinatura não confere e
// a conexão é recusada.
const enc = new TextEncoder();

async function chave(segredo: string) {
  return crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function paraBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(txt: string) {
  const b64 = txt.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

/** Válido por 15 minutos — tempo de sobra pra concluir o consentimento, e
 *  curto o bastante pra um state vazado não servir depois. */
const VALIDADE_MS = 15 * 60 * 1000;

export async function assinarEstado(userId: string, segredo: string) {
  const corpo = `${userId}.${Date.now() + VALIDADE_MS}`;
  const assinatura = await crypto.subtle.sign('HMAC', await chave(segredo), enc.encode(corpo));
  return `${paraBase64Url(enc.encode(corpo))}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

/** Devolve o userId, ou null se a assinatura não conferir ou tiver expirado. */
export async function lerEstado(state: string, segredo: string): Promise<string | null> {
  try {
    const [corpoB64, assinaturaB64] = String(state).split('.');
    if (!corpoB64 || !assinaturaB64) return null;
    const corpoBytes = deBase64Url(corpoB64);
    const ok = await crypto.subtle.verify(
      'HMAC', await chave(segredo), deBase64Url(assinaturaB64), corpoBytes,
    );
    if (!ok) return null;
    const [userId, expiraEm] = new TextDecoder().decode(corpoBytes).split('.');
    if (!userId || Number(expiraEm) < Date.now()) return null;
    return userId;
  } catch (_) {
    return null;
  }
}
