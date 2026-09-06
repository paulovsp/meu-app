// Edge Function: zoom-webhook
// Recebe do Zoom o aviso de que a gravação/transcrição de uma reunião ficou
// pronta, baixa a legenda e salva o texto na sessão.
//
// Diferença em relação ao Meet: o Google não avisa ninguém (por isso lá tem
// cron de varredura); o Zoom avisa. Então aqui não há polling — o texto é
// escrito no momento em que o Zoom diz que existe.
//
// Roda com --no-verify-jwt: quem chama é o Zoom, não o app. A autenticação
// é a assinatura HMAC que o Zoom põe em cada requisição, conferida abaixo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
 *  Sem conferir, qualquer um poderia escrever texto no prontuário de
 *  alguém só sabendo o endereço da função. */
async function assinaturaConfere(req: Request, corpoBruto: string) {
  if (!ZOOM_WEBHOOK_SECRET) return false;
  const assinaturaRecebida = req.headers.get('x-zm-signature');
  const timestamp = req.headers.get('x-zm-request-timestamp');
  if (!assinaturaRecebida || !timestamp) return false;
  const esperada = `v0=${await hmacHex(`v0:${timestamp}:${corpoBruto}`)}`;
  return assinaturaRecebida === esperada;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const corpoBruto = await req.text();
  let corpo: any = {};
  try { corpo = JSON.parse(corpoBruto); } catch (_) { return json({ error: 'Corpo inválido.' }, 400); }

  // Validação de endereço: ao cadastrar o webhook, o Zoom manda um desafio
  // e só aceita o endereço se receber de volta o mesmo token assinado.
  if (corpo?.event === 'endpoint.url_validation') {
    // Sem o segredo configurado, o HMAC nem pode ser calculado. Isso
    // acontece exatamente quando alguém cadastra o webhook no Zoom antes de
    // gravar o ZOOM_WEBHOOK_SECRET — melhor dizer o motivo do que devolver
    // um 500 sem explicação.
    if (!ZOOM_WEBHOOK_SECRET) {
      return json({ error: 'ZOOM_WEBHOOK_SECRET não configurado no servidor.' }, 503);
    }
    const plainToken = corpo?.payload?.plainToken ?? '';
    return json({ plainToken, encryptedToken: await hmacHex(plainToken) });
  }

  // ─── Diagnóstico temporário (06/09/2026) ────────────────────────────────
  // Registra TODA requisição que chega, inclusive a que vai ser recusada por
  // assinatura — sem isso, evento recusado não deixa rastro em lugar nenhum.
  // Ver migration 0063. Remover junto com a tabela.
  const assinaturaOk = await assinaturaConfere(req, corpoBruto);
  try {
    const arquivosDbg: any[] = corpo?.payload?.object?.recording_files ?? [];
    await createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      .from('zoom_webhook_debug')
      .insert({
        evento: corpo?.event ?? null,
        meeting_id: corpo?.payload?.object?.id ? String(corpo.payload.object.id) : null,
        assinatura_ok: assinaturaOk,
        tem_legenda: arquivosDbg.some((a) => a?.file_type === 'TRANSCRIPT'),
      });
  } catch (_) {
    // Diagnóstico nunca pode derrubar o webhook.
  }

  if (!assinaturaOk) {
    return json({ error: 'Assinatura inválida.' }, 401);
  }

  // Dois eventos interessam: a gravação ficar pronta e a transcrição ficar
  // pronta. A transcrição costuma sair DEPOIS da gravação, então o primeiro
  // evento muitas vezes ainda não traz o arquivo de legenda — nesse caso
  // não é erro, é só esperar o segundo.
  const evento = corpo?.event;
  if (evento !== 'recording.completed' && evento !== 'recording.transcript_completed') {
    return json({ ok: true, ignorado: evento });
  }

  // A partir de 06/09/2026 este webhook NÃO importa mais a transcrição do
  // Zoom. Ela sai em inglês mesmo com a sessão toda em português, e não há
  // como mudar isso (ver o cabeçalho de zoom-buscar-transcricao). Quem
  // transcreve agora é a AssemblyAI, a partir do áudio da gravação.
  //
  // A função continua no ar de propósito: ela ainda registra o que chega na
  // tabela de diagnóstico acima, que é como saberemos se o Zoom voltar a
  // entregar. O que ela não faz mais é escrever na sessão — se voltasse a
  // funcionar do jeito antigo, gravaria texto em inglês por cima do que a
  // AssemblyAI produziu.
  return json({ ok: true, transcricaoDelegadaAIA: true });
});
