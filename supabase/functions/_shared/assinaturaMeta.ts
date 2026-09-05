// Conferência da assinatura que a Meta põe em cada webhook do WhatsApp.
//
// Sem nada de Deno de propósito: assim a mesma função roda nos testes
// (src/services/__tests__/assinaturaMeta.test.js). É a peça que separa uma
// mensagem real de um comprovante forjado — e comprovante confirmado vira
// pagamento marcado como recebido, então errar aqui é errar em dinheiro.
const enc = new TextEncoder();

/**
 * A Meta envia `X-Hub-Signature-256: sha256=<hex>`, onde <hex> é o
 * HMAC-SHA256 do CORPO BRUTO da requisição usando o App Secret do app da
 * profissional. O corpo precisa ser o texto original: reserializar o JSON
 * muda um espaço que seja e a assinatura deixa de bater.
 */
export async function assinaturaMetaConfere(
  assinaturaRecebida: string | null | undefined,
  corpoBruto: string,
  appSecret: string | null | undefined,
): Promise<boolean> {
  if (!assinaturaRecebida || !appSecret) return false;
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, enc.encode(corpoBruto));
  const hex = Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return assinaturaRecebida === `sha256=${hex}`;
}
