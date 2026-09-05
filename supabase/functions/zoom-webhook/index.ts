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
import { vttParaTurnos } from '../_shared/zoom.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ZOOM_WEBHOOK_SECRET = Deno.env.get('ZOOM_WEBHOOK_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

async function notificar(admin: any, userId: string, sessionId: string, title: string, body: string) {
  try {
    const { data: perfil } = await admin
      .from('profiles').select('expo_push_token, notif_transcricao_push').eq('id', userId).single();
    if (!perfil?.expo_push_token || perfil.notif_transcricao_push === false) return;
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: perfil.expo_push_token, title, body, data: { sessionId } }),
    });
  } catch (_) {
    // Push é reforço; o status também aparece ao abrir a sessão.
  }
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

  if (!(await assinaturaConfere(req, corpoBruto))) {
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

  try {
    const objeto = corpo?.payload?.object ?? {};
    const meetingId = String(objeto?.id ?? '');
    const downloadToken = corpo?.download_token ?? corpo?.payload?.download_token ?? '';
    if (!meetingId) return json({ error: 'Reunião não identificada.' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: sessao } = await admin
      .from('sessions')
      .select('id, transcript, transcricao_status, patients(user_id)')
      .eq('zoom_meeting_id', meetingId)
      .maybeSingle();
    // Reunião que não é de nenhuma sessão do app (a pessoa usa o Zoom pra
    // outras coisas) — ignorar em silêncio é o certo.
    if (!sessao) return json({ ok: true, semSessao: true });
    if (sessao.transcricao_status === 'concluida') return json({ ok: true, jaConcluida: true });

    const userId = (sessao as any)?.patients?.user_id;

    const arquivos: any[] = objeto?.recording_files ?? [];
    const legenda = arquivos.find((a) => a?.file_type === 'TRANSCRIPT');
    if (!legenda?.download_url) {
      // Sem legenda ainda: se veio do evento de gravação, o de transcrição
      // ainda está por vir. Só vira erro no evento de transcrição, que é o
      // que promete o arquivo.
      if (evento === 'recording.transcript_completed') {
        await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
        await notificar(admin, userId, sessao.id, 'Transcrição não recebida',
          'O Zoom não gerou a legenda desta reunião. Verifique se a transcrição de áudio está ativada na conta.');
      }
      return json({ ok: true, aguardandoLegenda: true });
    }

    // O download_url exige o token que veio no próprio evento (vale 24h).
    const respVtt = await fetch(legenda.download_url, {
      headers: downloadToken ? { Authorization: `Bearer ${downloadToken}` } : {},
    });
    if (!respVtt.ok) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Transcrição não recebida',
        `Não foi possível baixar a legenda do Zoom (erro ${respVtt.status}).`);
      return json({ error: `Falha ao baixar a legenda (${respVtt.status}).` }, 502);
    }
    const vtt = await respVtt.text();

    const { data: integracao } = await admin
      .from('integracoes_videochamada')
      .select('conta_nome')
      .eq('user_id', userId)
      .eq('provedor', 'zoom')
      .maybeSingle();

    const dialogo = vttParaTurnos(vtt, integracao?.conta_nome ?? null);
    if (!dialogo) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Transcrição vazia',
        'A legenda do Zoom veio sem falas. Você pode transcrever manualmente.');
      return json({ ok: true, legendaVazia: true });
    }

    // Preserva o parágrafo de introdução gravado pelo app; extrair só ele
    // deixa a montagem idempotente se o Zoom reenviar o evento.
    const introducao = String(sessao.transcript || '').split('\n\n')[0].trim();
    await admin.from('sessions').update({
      transcript: introducao ? `${introducao}\n\n${dialogo}` : dialogo,
      transcricao_status: 'concluida',
      transcricao_origem: 'zoom',
    }).eq('id', sessao.id);

    // Sem débito de crédito de propósito: quem transcreveu foi o Zoom, não
    // a AssemblyAI — não há custo pra Dr.Sig repassar.
    await notificar(admin, userId, sessao.id, 'Transcrição pronta',
      'A transcrição da sua sessão pelo Zoom já está disponível.');

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
