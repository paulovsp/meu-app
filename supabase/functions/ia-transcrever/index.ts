// Edge Function: ia-transcrever
// Dispara a transcrição de áudio na AssemblyAI (assíncrona) — recebe o
// áudio, repassa pra AssemblyAI, pede a transcrição com webhook de retorno,
// e responde na hora (sem esperar o resultado). A AssemblyAI processa em
// segundo plano e chama `ia-transcrever-webhook` quando terminar.
//
// ── Como o áudio chega aqui (mudou em 03/09/2026) ────────────────────────
// ANTES: o app mandava o áudio como texto base64 dentro de um JSON. Esta
// função precisava fazer o parse do JSON gigante e decodificar o base64 —
// tudo processamento puro, contra o teto de 2 SEGUNDOS DE CPU da Supabase
// (o teto não conta espera de rede, só CPU de verdade). Medido na linha
// exata que era usada aqui: 10 min de áudio = 473ms (passa), 38 min =
// 1859ms (no limite), 50 min = 2448ms (estoura). Era por isso que gravação
// longa dava erro no envio e curta não.
//
// AGORA: o app manda o arquivo como binário puro (application/octet-stream)
// e esta função repassa o corpo direto pra AssemblyAI, sem tocar nos bytes.
// Sem parse, sem decodificação: o custo de CPU vira desprezível e qualquer
// duração passa. O áudio não é gravado em lugar nenhum — é só repasse.
//
// O caminho antigo (JSON + base64) continua aceito de propósito: a versão
// do app já instalada no celular ainda usa ele, e pararia de transcrever no
// instante em que esta função fosse publicada.
//
// Cobrança: NÃO acontece aqui. O débito real acontece no webhook, usando
// `audio_duration` — o valor que a própria AssemblyAI calculou a partir do
// áudio processado, não o que o app informou.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { registrarBloco } from '../_shared/blocosTranscricao.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!;
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!;

const ASSEMBLYAI_UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    // ── Caminho novo (binário) x caminho antigo (JSON base64) ──
    // No binário, o que não é áudio (sessão, ordem do bloco) viaja em
    // cabeçalho, já que o corpo inteiro é o arquivo.
    const contentType = req.headers.get('content-type') || '';
    const ehBinario = !contentType.includes('application/json');

    let sessionId: string | null = null;
    let indice = 0;
    // 0 = "ainda não sei quantos blocos são" (gravação em andamento). O
    // número real só chega junto do último bloco. Ver _shared/blocosTranscricao.ts.
    let total = 1;
    let corpoAudio: BodyInit | null = null;

    if (ehBinario) {
      sessionId = req.headers.get('x-session-id');
      indice = Number(req.headers.get('x-bloco-indice') ?? '0') || 0;
      total = Number(req.headers.get('x-bloco-total') ?? '1') || 0;
      if (!req.body) return json({ error: 'Áudio ausente.' }, 400);
      corpoAudio = req.body;
    } else {
      const body = await req.json();
      const { audioBase64, sessionId: sid } = body || {};
      if (!audioBase64) return json({ error: 'Áudio ausente.' }, 400);
      sessionId = sid;
      corpoAudio = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    }

    if (!sessionId) return json({ error: 'sessionId ausente.' }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('creditos_ia')
      .eq('id', userId)
      .single();
    if (perfilError || !perfil) return json({ error: 'Perfil não encontrado.' }, 404);

    const { data: assinaturaAtiva } = await supabaseAdmin.rpc('assinatura_ativa', { uid: userId });
    if (!assinaturaAtiva) {
      return json({ error: 'Assinatura inativa.', assinaturaInativa: true }, 403);
    }

    if (Number(perfil.creditos_ia) <= 0) {
      return json({ error: 'Créditos de IA insuficientes.', creditosInsuficientes: true }, 402);
    }

    // A sessão é conferida ANTES de gastar a transcrição: com supabaseUser
    // (não admin), a RLS garante que só passa sessão que pertence a quem
    // chamou. Antes essa checagem ficava no fim, depois de já ter mandado o
    // áudio pra AssemblyAI — dava pra queimar processamento numa sessão
    // que nem era da pessoa.
    const { data: sessaoDona, error: sessaoDonaError } = await supabaseUser
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessaoDonaError || !sessaoDona) {
      return json({ error: 'Sessão não encontrada ou sem permissão.' }, 404);
    }

    // Repassa o áudio adiante. No caminho binário, `corpoAudio` é o próprio
    // stream da requisição: os bytes atravessam sem passar por JS.
    const uploadResp = await fetch(ASSEMBLYAI_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream',
      },
      body: corpoAudio,
      // Exigido pelo fetch quando o corpo é um stream (envia enquanto lê).
      ...(ehBinario ? { duplex: 'half' } : {}),
    } as RequestInit);
    if (!uploadResp.ok) {
      const errBody = await uploadResp.text().catch(() => '');
      return json({ error: `Erro ao enviar áudio pra AssemblyAI (${uploadResp.status}): ${errBody}` }, 502);
    }
    const { upload_url } = await uploadResp.json();

    const webhookUrl = `${SUPABASE_URL}/functions/v1/ia-transcrever-webhook`;
    const transcriptResp = await fetch(ASSEMBLYAI_TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speech_models: ['universal-3-5-pro'],
        language_code: 'pt',
        speaker_labels: true,
        webhook_url: webhookUrl,
        webhook_auth_header_name: 'x-webhook-secret',
        webhook_auth_header_value: ASSEMBLYAI_WEBHOOK_SECRET,
      }),
    });
    if (!transcriptResp.ok) {
      const errBody = await transcriptResp.text().catch(() => '');
      return json({ error: `Erro ao pedir transcrição na AssemblyAI (${transcriptResp.status}): ${errBody}` }, 502);
    }
    const transcript = await transcriptResp.json();

    // Registra o bloco. Gravação curta é só o caso de um bloco só — um
    // caminho de código para os dois.
    await registrarBloco(supabaseAdmin, 'session_id', sessionId, indice, total, transcript.id);

    // `sessions.assemblyai_transcript_id` guarda o id do PRIMEIRO bloco —
    // mantém compatibilidade com o que já existia (e com o app antigo, que
    // não conhece blocos).
    const patch: Record<string, unknown> = { transcricao_status: 'processando' };
    if (indice === 0) patch.assemblyai_transcript_id = transcript.id;
    await supabaseAdmin.from('sessions').update(patch).eq('id', sessionId);

    return json({ status: 'processando', indice, total });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
