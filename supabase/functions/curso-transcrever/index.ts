// Edge Function: curso-transcrever
// Mesmo pipeline assíncrono do ia-transcrever (sobe o áudio pra AssemblyAI,
// pede transcrição com webhook de retorno, responde na hora), só que
// mirando a tabela `cursos` em vez de `sessions` — sem diarização
// analista/analisante, sem verificação de identidade de terceiro. A
// gravação da aula só é permitida depois que `cursos.consentimento_professor`
// está marcado (checado aqui, não só na UI, pra não confiar só no cliente).
//
// Cobrança: NÃO acontece aqui, mesmo motivo do ia-transcrever —
// `duracaoSegundos` do corpo é só gate de saldo, o débito real usa
// `audio_duration` da AssemblyAI, feito no curso-transcrever-webhook.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const body = await req.json();
    const { audioBase64, cursoId } = body || {};
    if (!audioBase64) return json({ error: 'Áudio ausente.' }, 400);
    if (!cursoId) return json({ error: 'cursoId ausente.' }, 400);

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

    // Confere o consentimento no banco, não só no que o app mandou — o
    // client já bloqueia gravar sem isso, mas essa checagem aqui é o que
    // garante de verdade, mesmo se alguém chamar a função direto.
    const { data: curso, error: cursoError } = await supabaseUser
      .from('cursos')
      .select('id, consentimento_professor')
      .eq('id', cursoId)
      .single();
    if (cursoError || !curso) return json({ error: 'Curso não encontrado ou sem permissão.' }, 404);
    if (!curso.consentimento_professor) {
      return json({ error: 'Consentimento do professor não confirmado pra este curso.' }, 403);
    }

    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));

    const uploadResp = await fetch(ASSEMBLYAI_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    if (!uploadResp.ok) {
      const errBody = await uploadResp.text().catch(() => '');
      return json({ error: `Erro ao enviar áudio pra AssemblyAI (${uploadResp.status}): ${errBody}` }, 502);
    }
    const { upload_url } = await uploadResp.json();

    const webhookUrl = `${SUPABASE_URL}/functions/v1/curso-transcrever-webhook`;
    const transcriptResp = await fetch(ASSEMBLYAI_TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speech_models: ['universal-3-5-pro', 'universal-2'],
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

    // supabaseUser (não supabaseAdmin) — RLS de `cursos` garante que só dá
    // pra marcar como "processando" um curso que realmente é do usuário.
    const { data: cursoAtualizado, error: updateError } = await supabaseUser
      .from('cursos')
      .update({ assemblyai_transcript_id: transcript.id, transcricao_status: 'processando' })
      .eq('id', cursoId)
      .select('id')
      .single();
    if (updateError || !cursoAtualizado) {
      return json({ error: 'Curso não encontrado ou sem permissão.' }, 404);
    }

    return json({ status: 'processando' });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
