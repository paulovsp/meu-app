// Edge Function: zoom-criar-reuniao
// Cria a reunião do Zoom de uma sessão online, já com gravação em nuvem
// automática (que é o que produz a transcrição). Devolve o link pra
// profissional enviar ao analisante.
//
// ── O dispositivo de autorização ──────────────────────────────────────────
// Transcrever uma sessão exige autorização do analisante registrada no app.
// O aviso do próprio Zoom ("esta reunião está sendo gravada") NÃO substitui
// isso: é consentimento pra plataforma, não pro tratamento clínico do
// material. A checagem está aqui, no servidor, não só na tela — igual ao
// meet-criar-sala e ao ia-transcrever.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { accessTokenDoUsuario, chamarZoom, IntegracaoInvalidaError } from '../_shared/zoom.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const { sessionId } = await req.json().catch(() => ({}));
    if (!sessionId) return json({ error: 'sessionId ausente.' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: assinaturaAtiva } = await admin.rpc('assinatura_ativa', { uid: userId });
    if (!assinaturaAtiva) return json({ error: 'Assinatura inativa.', assinaturaInativa: true }, 403);

    // supabaseUser (não admin): a RLS garante que a sessão é mesmo desta
    // profissional.
    const { data: sessao, error: sessaoError } = await supabaseUser
      .from('sessions')
      .select('id, patient_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessaoError || !sessao) return json({ error: 'Sessão não encontrada ou sem permissão.' }, 404);

    // ── A trava que não pode faltar ──
    const { data: autorizada } = await admin.rpc('gravacao_autorizada', { p_patient_id: sessao.patient_id });
    if (!autorizada) {
      return json({
        error: 'Este analisante ainda não autorizou a gravação e transcrição das sessões.',
        semAutorizacao: true,
      }, 403);
    }

    const { data: integracao } = await admin
      .from('integracoes_videochamada')
      .select('transcricao_automatica_disponivel, invalidado_em')
      .eq('user_id', userId)
      .eq('provedor', 'zoom')
      .maybeSingle();
    if (!integracao || integracao.invalidado_em) {
      return json({
        error: 'Conecte (ou reconecte) sua conta do Zoom para usar as sessões por ele.',
        precisaConectar: true,
      }, 409);
    }
    if (integracao.transcricao_automatica_disponivel === false) {
      return json({
        error: 'A conta do Zoom conectada não gera transcrição — é preciso um plano Pro, Business, '
          + 'Education ou Enterprise, com gravação em nuvem e transcrição de áudio ativadas.',
        semTranscricaoAutomatica: true,
      }, 409);
    }

    const accessToken = await accessTokenDoUsuario(admin, userId);

    // `auto_recording: 'cloud'` é o que dispara tudo: sem gravação em
    // nuvem o Zoom não gera transcrição nenhuma, e a sessão passaria em
    // branco. `type: 1` = reunião instantânea (começa agora).
    // `waiting_room` ligado: numa sessão clínica quem controla a entrada é
    // a profissional, não o link.
    const reuniao = await chamarZoom(accessToken, '/users/me/meetings', {
      method: 'POST',
      body: JSON.stringify({
        type: 1,
        topic: 'Sessão',
        settings: {
          auto_recording: 'cloud',
          waiting_room: true,
          join_before_host: false,
        },
      }),
    });

    await admin.from('sessions').update({
      zoom_meeting_id: String(reuniao.id),
      zoom_join_url: reuniao.join_url,
      transcricao_origem: 'zoom',
      transcricao_status: 'processando',
    }).eq('id', sessionId);

    return json({ joinUrl: reuniao.join_url, meetingId: String(reuniao.id) });
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError) {
      return json({ error: err.message, precisaConectar: true }, 409);
    }
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
