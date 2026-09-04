// Edge Function: curso-transcrever-webhook
// Recebida da AssemblyAI quando a transcrição de uma aula (curso-transcrever)
// termina. Sem JWT de usuário, só o header customizado (deploy com
// --no-verify-jwt) — mesmo padrão do ia-transcrever-webhook, mirando
// `cursos` em vez de `sessions`.
//
// Diferença de formatação: uma aula não é diálogo a dois (analista/
// analisante) — pode ter 1 locutor (aula expositiva) ou vários (professor +
// perguntas de colegas). Em vez de forçar "A:"/"P:", cada trecho vira
// "Locutor X: texto", preservando os rótulos que a AssemblyAI já dá.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calcularCobrancaIA } from '../_shared/precificacaoIA.ts';
import { acharBloco, marcarBlocoComErro, salvarBlocoEMontarTexto } from '../_shared/blocosTranscricao.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!;
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!;

const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatarTranscricao(transcript: any): string {
  const utterances = transcript?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((u: any) => `Locutor ${u.speaker || '?'}: ${String(u.text || '').trim()}`)
      .filter((linha: string) => linha.length > 12)
      .join('\n');
  }
  return String(transcript?.text || '').trim();
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

    // Caminho atual: o texto que chega pertence a um BLOCO da gravação
    // (aula acima de 1h é gravada em blocos — ver migration 0054). Aula
    // curta é só o caso de um bloco só, mesmo caminho.
    const bloco = await acharBloco(supabaseAdmin, transcriptId);

    // Caminho antigo (app anterior a 03/09/2026, que não conhece blocos):
    // o próprio curso guarda o transcript_id. Mantido pra não perder uma
    // transcrição que já estava em andamento quando isto foi publicado.
    let cursoId: string | null = bloco?.curso_id ?? null;
    if (!cursoId) {
      const { data: cursoAntigo } = await supabaseAdmin
        .from('cursos')
        .select('id')
        .eq('assemblyai_transcript_id', transcriptId)
        .maybeSingle();
      cursoId = cursoAntigo?.id ?? null;
    }
    if (!cursoId) {
      return json({ error: 'Curso não encontrado para este transcript_id.' }, 404);
    }

    const { data: curso } = await supabaseAdmin
      .from('cursos')
      .select('id, user_id')
      .eq('id', cursoId)
      .single();
    const userId = curso?.user_id as string;

    async function marcarErro(mensagem: string) {
      if (bloco) await marcarBlocoComErro(supabaseAdmin, bloco);
      await supabaseAdmin.from('cursos').update({ transcricao_status: 'erro' }).eq('id', cursoId);
      await enviarPush(userId, cursoId!, 'Não foi possível transcrever a aula', mensagem, supabaseAdmin);
    }

    // Cobra por BLOCO, pela duração que a própria AssemblyAI mediu: a soma
    // dos blocos dá exatamente a duração total da aula.
    async function cobrar(duracaoSegundos: number) {
      const custo = calcularCobrancaIA(duracaoSegundos);
      if (!userId || custo <= 0) return;
      const { data: assinaturaAtiva } = await supabaseAdmin.rpc('assinatura_ativa', { uid: userId });
      if (!assinaturaAtiva) return;
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

    if (statusRecebido === 'error') {
      await marcarErro('Toque para tentar novamente.');
      return json({ ok: true });
    }

    const transcriptResp = await fetch(`${ASSEMBLYAI_TRANSCRIPT_URL}/${transcriptId}`, {
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    });
    if (!transcriptResp.ok) {
      await marcarErro(`Não foi possível buscar o texto (${transcriptResp.status}).`);
      return json({ error: `Erro ao buscar transcrição na AssemblyAI (${transcriptResp.status}).` }, 502);
    }
    const transcript = await transcriptResp.json();

    if (transcript.status === 'error') {
      await marcarErro(String(transcript.error || ''));
      return json({ ok: true });
    }

    const textoFormatado = formatarTranscricao(transcript);
    await cobrar(Number(transcript.audio_duration) || 0);

    // Caminho antigo (sem blocos): o texto que chegou já é a aula inteira.
    let textoCompleto: string | null = textoFormatado;
    if (bloco) {
      textoCompleto = await salvarBlocoEMontarTexto(supabaseAdmin, bloco, textoFormatado);
      // Ainda falta bloco: a aula continua "processando" e ninguém é
      // notificado — o aviso só faz sentido com o texto inteiro pronto.
      if (textoCompleto === null) return json({ ok: true, aguardandoOutrosBlocos: true });
    }

    await supabaseAdmin
      .from('cursos')
      .update({ transcript: textoCompleto, transcricao_status: 'concluida' })
      .eq('id', cursoId);

    await enviarPush(userId, cursoId, 'Transcrição pronta', 'A transcrição da aula já está disponível.', supabaseAdmin);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});

async function enviarPush(
  userId: string | undefined,
  cursoId: string,
  title: string,
  bodyMsg: string,
  supabaseAdmin: ReturnType<typeof createClient>,
) {
  if (!userId) return;
  try {
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('expo_push_token, notif_transcricao_push')
      .eq('id', userId)
      .single();
    if (perfil?.notif_transcricao_push === false) return;
    const token = perfil?.expo_push_token;
    if (!token) return;
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body: bodyMsg,
        data: { cursoId },
      }),
    });
  } catch (_) {
    // Push é reforço, não crítico.
  }
}
