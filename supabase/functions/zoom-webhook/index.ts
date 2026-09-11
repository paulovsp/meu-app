// Edge Function: zoom-webhook
//
// O endpoint que o Zoom chama quando a gravação de uma reunião fica pronta.
// Ele não faz mais nada com esse aviso, e isso é deliberado.
//
// Duas descobertas de 06/09/2026 levaram até aqui. A primeira: a transcrição
// do próprio Zoom sai em inglês mesmo com a sessão inteira em português, e
// não existe configuração de conta nem parâmetro de API que mude isso — só o
// "Alterar idioma" manual, gravação por gravação, que não dá pra pedir a
// ninguém toda sessão. A segunda: o webhook simplesmente parou de ser
// entregue, com tudo verificado do nosso lado (app instalado, assinatura
// ativa, endpoint validando, reuniões criadas com 201 no log do próprio
// Zoom) e zero requisições chegando.
//
// As duas juntas moveram a transcrição pra busca ativa: `zoom-buscar-
// transcricao` (cron de 2 min) baixa o áudio da gravação em nuvem e manda
// pra AssemblyAI, em português e com separação de falantes. Esse caminho não
// depende de o Zoom nos alcançar, só de a API dele responder.
//
// Então por que a função continua no ar? Porque o Zoom exige um endereço que
// responda à validação, e um app do Marketplace com webhook quebrado é
// desativado por eles. É só isso que este arquivo faz.
//
// Roda com --no-verify-jwt: quem chama é o Zoom, não o app.
import { servir } from '../_shared/registrarEvento.ts';
const ZOOM_WEBHOOK_SECRET = Deno.env.get('ZOOM_WEBHOOK_SECRET') ?? '';

const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function hmacHex(mensagem: string) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(ZOOM_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, enc.encode(mensagem));
  return Array.from(new Uint8Array(assinatura)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** O Zoom assina cada envio: v0=HMAC_SHA256("v0:<timestamp>:<corpo>").
 *  Conferida mesmo sem gravar nada: é o que garante que, se um dia esta
 *  função voltar a escrever no prontuário, ela não nasça sem a trava. */
async function assinaturaConfere(req: Request, corpoBruto: string) {
  if (!ZOOM_WEBHOOK_SECRET) return false;
  const assinaturaRecebida = req.headers.get('x-zm-signature');
  const timestamp = req.headers.get('x-zm-request-timestamp');
  if (!assinaturaRecebida || !timestamp) return false;
  const esperada = `v0=${await hmacHex(`v0:${timestamp}:${corpoBruto}`)}`;
  return assinaturaRecebida === esperada;
}

Deno.serve(servir('zoom-webhook', async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const corpoBruto = await req.text();
  let corpo: any = {};
  try { corpo = JSON.parse(corpoBruto); } catch (_) { return json({ error: 'Corpo inválido.' }, 400); }

  // A razão de a função existir: ao cadastrar (ou revalidar) o webhook, o
  // Zoom manda um desafio e só aceita o endereço se receber de volta o mesmo
  // token assinado.
  if (corpo?.event === 'endpoint.url_validation') {
    // Sem o segredo configurado o HMAC nem pode ser calculado — acontece
    // quando alguém cadastra o webhook no Zoom antes de gravar o
    // ZOOM_WEBHOOK_SECRET. Melhor dizer o motivo do que devolver 500 mudo.
    if (!ZOOM_WEBHOOK_SECRET) {
      return json({ error: 'ZOOM_WEBHOOK_SECRET não configurado no servidor.' }, 503);
    }
    const plainToken = corpo?.payload?.plainToken ?? '';
    return json({ plainToken, encryptedToken: await hmacHex(plainToken) });
  }

  if (!await assinaturaConfere(req, corpoBruto)) {
    return json({ error: 'Assinatura inválida.' }, 401);
  }

  // Qualquer outro evento é reconhecido e descartado. Escrever a transcrição
  // do Zoom aqui seria pior do que não fazer nada: gravaria texto em inglês
  // por cima do que a AssemblyAI produziu em português.
  return json({ ok: true, transcricaoDelegadaAIA: true });
}));
