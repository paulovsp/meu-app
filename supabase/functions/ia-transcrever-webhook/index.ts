// Edge Function: ia-transcrever-webhook
// Recebida da AssemblyAI quando uma transcrição pedida por `ia-transcrever`
// termina (sucesso ou erro). Sem JWT de usuário — quem chama é a
// AssemblyAI, autenticada só pelo header customizado abaixo (deploy com
// --no-verify-jwt).
//
// É aqui, e só aqui, que o crédito é debitado — usando `audio_duration`,
// o valor que a própria AssemblyAI calculou a partir do áudio processado.
// `duracaoSegundos` que o app manda em `ia-transcrever` nunca é usado pra
// cobrança (é falsificável, vem do cliente).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!;
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!;

const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// US$ 0,21 por hora de áudio (Universal-3.5 Pro, jul/2026 — diarização
// inclusa, sem sobretaxa separada; ajustar aqui se o preço da AssemblyAI
// mudar).
const PRECO_POR_HORA_USD = 0.21;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Formata as utterances (diarização real da AssemblyAI) na mesma convenção
// de linha que `parseTranscriptToTurns` (src/services/database.js) já
// reconhece hoje — "A: "/"P: " no início da linha. AssemblyAI só entrega
// clusters anônimos de voz (Speaker A, B, ...), não sabe quem é analista e
// quem é analisante; mapeamos A -> "A: " e qualquer outro rótulo -> "P: "
// (sessão é sempre diálogo a dois) como ponto de partida — a pessoa ajusta
// na revisão se a AssemblyAI errou quem falou primeiro, exatamente como já
// faz hoje com o placeholder manual.
function formatarTranscricao(transcript: any): string {
  const utterances = transcript?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((u: any) => `${u.speaker === 'A' ? 'A' : 'P'}: ${String(u.text || '').trim()}`)
      .filter((linha: string) => linha.length > 3)
      .join('\n');
  }
  return `A: ${String(transcript?.text || '').trim()}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  const secretRecebido = req.headers.get('x-webhook-secret');
  if (secretRecebido !== ASSEMBLYAI_WEBHOOK_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const transcriptId = body?.transcript_id;
    const statusRecebido = body?.status;
    if (!transcriptId) return json({ error: 'transcript_id ausente.' }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: sessao, error: sessaoError } = await supabaseAdmin
      .from('sessions')
      .select('id, transcript, patients(user_id)')
      .eq('assemblyai_transcript_id', transcriptId)
      .single();
    if (sessaoError || !sessao) {
      return json({ error: 'Sessão não encontrada para este transcript_id.' }, 404);
    }
    const userId = (sessao as any).patients?.user_id;

    if (statusRecebido === 'error') {
      await supabaseAdmin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await enviarPush(userId, sessao.id, 'Não foi possível transcrever', 'Toque para tentar novamente.', supabaseAdmin);
      return json({ ok: true });
    }

    const transcriptResp = await fetch(`${ASSEMBLYAI_TRANSCRIPT_URL}/${transcriptId}`, {
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    });
    if (!transcriptResp.ok) {
      await supabaseAdmin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      return json({ error: `Erro ao buscar transcrição na AssemblyAI (${transcriptResp.status}).` }, 502);
    }
    const transcript = await transcriptResp.json();

    if (transcript.status === 'error') {
      await supabaseAdmin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await enviarPush(userId, sessao.id, 'Não foi possível transcrever', String(transcript.error || ''), supabaseAdmin);
      return json({ ok: true });
    }

    // A sessão já foi salva pelo app com `transcript` contendo só o
    // parágrafo de introdução (analisante/modalidade/data/duração), antes
    // de disparar a transcrição — preserva esse parágrafo aqui, só
    // anexando o diálogo formatado, em vez de substituir tudo.
    const introExistente = ((sessao as any).transcript || '').trim();
    const textoFormatado = formatarTranscricao(transcript);
    const transcriptFinal = introExistente ? `${introExistente}\n\n${textoFormatado}` : textoFormatado;
    await supabaseAdmin
      .from('sessions')
      .update({ transcript: transcriptFinal, transcricao_status: 'concluida' })
      .eq('id', sessao.id);

    const duracaoSegundos = Number(transcript.audio_duration) || 0;
    const custo = (duracaoSegundos / 3600) * PRECO_POR_HORA_USD;

    // Se a assinatura foi cancelada entre o disparo e a conclusão da
    // transcrição, o texto já processado ainda é salvo acima (dado clínico
    // já existe, nunca é retido) — só o débito de crédito é pulado, pra
    // não cobrar de uma conta que não deveria mais poder gastar crédito.
    const { data: assinaturaAtiva } = userId
      ? await supabaseAdmin.rpc('assinatura_ativa', { uid: userId })
      : { data: false };

    if (userId && assinaturaAtiva && custo > 0) {
      const { data: perfil } = await supabaseAdmin
        .from('profiles')
        .select('creditos_ia')
        .eq('id', userId)
        .single();
      if (perfil) {
        await supabaseAdmin
          .from('profiles')
          .update({ creditos_ia: Number(perfil.creditos_ia) - custo })
          .eq('id', userId);
      }
      await supabaseAdmin.from('uso_ia').insert({
        user_id: userId,
        tipo: 'transcricao',
        provedor: 'assemblyai',
        modelo: 'universal-3-5-pro',
        unidades: duracaoSegundos,
        custo_estimado: custo,
      });
    }

    await enviarPush(userId, sessao.id, 'Transcrição pronta', 'A transcrição da sua sessão já está disponível.', supabaseAdmin);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});

async function enviarPush(
  userId: string | undefined,
  sessionId: string,
  title: string,
  bodyMsg: string,
  supabaseAdmin: ReturnType<typeof createClient>,
) {
  if (!userId) return;
  try {
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();
    const token = perfil?.expo_push_token;
    if (!token) return;
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body: bodyMsg,
        data: { sessionId },
      }),
    });
  } catch (_) {
    // Push é reforço, não crítico — a pessoa também vê o status ao abrir a sessão.
  }
}
