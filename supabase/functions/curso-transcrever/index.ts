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
//
// Como o áudio chega (mudou em 03/09/2026): binário puro, repassado direto
// pra AssemblyAI sem esta function tocar nos bytes. O caminho antigo (JSON
// com base64) estourava o teto de 2s de CPU da Supabase em gravação longa —
// e uma aula de 2-4h é exatamente o caso extremo. Ver a explicação completa
// em ia-transcrever/index.ts e na migration 0054. O caminho antigo continua
// aceito porque o app já instalado no celular ainda usa ele.
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

    // No caminho binário o corpo inteiro é o arquivo, então o que não é
    // áudio (curso, ordem do bloco) viaja em cabeçalho.
    const contentType = req.headers.get('content-type') || '';
    const ehBinario = !contentType.includes('application/json');

    let cursoId: string | null = null;
    let indice = 0;
    // 0 = "ainda não sei quantos blocos são" (gravação em andamento); o
    // número real só chega junto do último bloco.
    let total = 1;
    let corpoAudio: BodyInit | null = null;

    if (ehBinario) {
      cursoId = req.headers.get('x-curso-id');
      indice = Number(req.headers.get('x-bloco-indice') ?? '0') || 0;
      total = Number(req.headers.get('x-bloco-total') ?? '1') || 0;
      if (!req.body) return json({ error: 'Áudio ausente.' }, 400);
      corpoAudio = req.body;
    } else {
      const body = await req.json();
      const { audioBase64, cursoId: cid } = body || {};
      if (!audioBase64) return json({ error: 'Áudio ausente.' }, 400);
      cursoId = cid;
      corpoAudio = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    }
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

    const webhookUrl = `${SUPABASE_URL}/functions/v1/curso-transcrever-webhook`;
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
    await registrarBloco(supabaseAdmin, 'curso_id', cursoId, indice, total, transcript.id);

    // supabaseUser (não supabaseAdmin) — RLS de `cursos` garante que só dá
    // pra marcar como "processando" um curso que realmente é do usuário.
    // `assemblyai_transcript_id` guarda o id do PRIMEIRO bloco, mantendo
    // compatibilidade com o app antigo, que não conhece blocos.
    const patch: Record<string, unknown> = { transcricao_status: 'processando' };
    if (indice === 0) patch.assemblyai_transcript_id = transcript.id;
    const { data: cursoAtualizado, error: updateError } = await supabaseUser
      .from('cursos')
      .update(patch)
      .eq('id', cursoId)
      .select('id')
      .single();
    if (updateError || !cursoAtualizado) {
      return json({ error: 'Curso não encontrado ou sem permissão.' }, 404);
    }

    return json({ status: 'processando', indice, total });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
