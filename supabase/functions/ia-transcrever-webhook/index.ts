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
import { calcularCobrancaIA } from '../_shared/precificacaoIA.ts';
import { acharBloco, marcarBlocoComErro, salvarBlocoEMontarTexto } from '../_shared/blocosTranscricao.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!;
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

    // Caminho atual: o texto que chega pertence a um BLOCO da gravação
    // (gravações acima de 1h são gravadas em blocos — ver migration 0054).
    // Gravação curta é só o caso de um bloco só, mesmo caminho.
    const bloco = await acharBloco(supabaseAdmin, transcriptId);

    // Caminho antigo (app anterior a 03/09/2026, que não conhece blocos):
    // a própria sessão guarda o transcript_id. Mantido pra não perder uma
    // transcrição que já estava em andamento quando isto foi publicado.
    let sessionId: string | null = bloco?.session_id ?? null;
    if (!sessionId) {
      const { data: sessaoAntiga } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('assemblyai_transcript_id', transcriptId)
        .maybeSingle();
      sessionId = sessaoAntiga?.id ?? null;
    }
    if (!sessionId) {
      return json({ error: 'Sessão não encontrada para este transcript_id.' }, 404);
    }

    const { data: sessao } = await supabaseAdmin
      .from('sessions')
      .select('id, transcript, patients(user_id)')
      .eq('id', sessionId)
      .single();
    const userId = (sessao as any)?.patients?.user_id;

    // A introdução (analisante/modalidade/data/duração) é o primeiro
    // parágrafo, gravado pelo app antes da transcrição começar. Extrair só
    // ela — em vez de concatenar no que já estiver lá — deixa a montagem
    // idempotente: um webhook reentregue pela AssemblyAI, ou um bloco
    // reenviado, remonta o texto do zero em vez de duplicar o diálogo.
    const introducao = String((sessao as any)?.transcript || '').split('\n\n')[0].trim();

    async function marcarErro(mensagem: string) {
      if (bloco) await marcarBlocoComErro(supabaseAdmin, bloco);
      await supabaseAdmin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessionId);
      await enviarNotificacaoTranscricao(userId, sessionId!, 'Não foi possível transcrever', mensagem, supabaseAdmin);
    }

    // Cobra por BLOCO, pela duração que a própria AssemblyAI mediu: a soma
    // dos blocos dá exatamente a duração total, sem cobrar a mais nem a
    // menos numa gravação longa.
    async function cobrar(duracaoSegundos: number) {
      const custo = calcularCobrancaIA(duracaoSegundos);
      if (!userId || custo <= 0) return;
      // Se a assinatura foi cancelada entre o disparo e a conclusão, o
      // texto ainda é salvo (dado clínico nunca é retido) — só o débito é
      // pulado, pra não cobrar de conta que não deveria mais gastar.
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
    const duracaoSegundos = Number(transcript.audio_duration) || 0;

    await cobrar(duracaoSegundos);

    // Caminho antigo (sem blocos): o texto que chegou já é a gravação toda.
    let corpo: string | null = textoFormatado;
    if (bloco) {
      corpo = await salvarBlocoEMontarTexto(supabaseAdmin, bloco, textoFormatado);
      // Ainda falta bloco: a sessão continua "processando" e ninguém é
      // notificado — o aviso só faz sentido com o texto inteiro pronto.
      if (corpo === null) return json({ ok: true, aguardandoOutrosBlocos: true });
    }

    const transcriptFinal = introducao ? `${introducao}\n\n${corpo}` : corpo;
    await supabaseAdmin
      .from('sessions')
      .update({ transcript: transcriptFinal, transcricao_status: 'concluida' })
      .eq('id', sessionId);

    await enviarNotificacaoTranscricao(userId, sessionId, 'Transcrição pronta', 'A transcrição da sua sessão já está disponível.', supabaseAdmin);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});

// Manda pelos canais que a pessoa escolheu (item D.10: app e e-mail
// independentes) — nenhum dos dois é crítico, o status também aparece ao
// abrir a sessão, então falha de envio nunca interrompe o fluxo.
async function enviarNotificacaoTranscricao(
  userId: string | undefined,
  sessionId: string,
  title: string,
  bodyMsg: string,
  supabaseAdmin: ReturnType<typeof createClient>,
) {
  if (!userId) return;
  const { data: perfil } = await supabaseAdmin
    .from('profiles')
    .select('email, expo_push_token, notif_transcricao_push, notif_transcricao_email')
    .eq('id', userId)
    .single();
  if (!perfil) return;

  if (perfil.notif_transcricao_push !== false && perfil.expo_push_token) {
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: perfil.expo_push_token,
          title,
          body: bodyMsg,
          data: { sessionId },
        }),
      });
    } catch (_) {
      // Push é reforço — falha aqui não deve derrubar o resto do fluxo.
    }
  }

  if (perfil.notif_transcricao_email === true && perfil.email) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Dr.Sig <naoresponda@drsig.com.br>',
          to: [perfil.email],
          subject: title,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
              <h2>${title}</h2>
              <p>${bodyMsg}</p>
              <p>Abra o app Dr.Sig para conferir.</p>
            </div>
          `,
        }),
      });
    } catch (_) {
      // E-mail também é reforço, mesmo critério do push.
    }
  }
}
