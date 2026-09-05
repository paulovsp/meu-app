// Edge Function: meet-criar-sala
// Cria a sala do Google Meet de uma sessão online e liga a transcrição
// automática. Devolve o link pra profissional enviar ao analisante.
//
// A sala precisa ser criada aqui (e não no Meet ou no Calendar) porque o
// escopo meetings.space.created só dá acesso aos artefatos de salas criadas
// por ESTE app — é o que permite buscar a transcrição depois sem tocar no
// Drive, que seria escopo restrito.
//
// ── O dispositivo de autorização ──────────────────────────────────────────
// Transcrever uma sessão exige autorização do analisante, registrada no app.
// O aviso do próprio Meet ("esta chamada está sendo transcrita") NÃO
// substitui isso: é consentimento pra plataforma, não pro tratamento
// clínico do material. A checagem está aqui, no servidor, não só na tela.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { accessTokenDoUsuario, chamarMeet, IntegracaoInvalidaError } from '../_shared/google.ts';

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
    // profissional. Sem isso dava pra criar sala numa sessão de outra conta.
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
      .eq('provedor', 'google_meet')
      .maybeSingle();
    if (!integracao || integracao.invalidado_em) {
      return json({
        error: 'Conecte (ou reconecte) sua conta do Google para usar as sessões pelo Meet.',
        precisaConectar: true,
      }, 409);
    }
    if (!integracao.transcricao_automatica_disponivel) {
      return json({
        error: 'A conta do Google conectada não gera transcrição automática — isso exige um plano '
          + 'Google Workspace Business Plus, Enterprise Standard/Plus, Education Plus ou Enterprise Essentials.',
        semTranscricaoAutomatica: true,
      }, 409);
    }

    const accessToken = await accessTokenDoUsuario(admin, userId);

    // accessType TRUSTED: quem não está numa conta conhecida bate na porta e
    // a profissional admite. Numa sessão clínica isso é desejável — quem
    // controla a entrada é ela, não o link.
    const sala = await chamarMeet(accessToken, 'spaces', {
      method: 'POST',
      body: JSON.stringify({
        config: {
          accessType: 'TRUSTED',
          artifactConfig: {
            transcriptionConfig: { autoTranscriptionGeneration: 'ON' },
          },
        },
      }),
    });

    const modo = sala?.config?.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration;
    if (modo !== 'ON') {
      // A capacidade é testada na conexão, mas o plano pode ter mudado desde
      // então — melhor recusar agora do que a pessoa fazer a sessão inteira
      // e descobrir no fim que não há texto nenhum.
      await admin
        .from('integracoes_videochamada')
        .update({ transcricao_automatica_disponivel: false, capacidade_verificada_em: new Date().toISOString() })
        .eq('user_id', userId).eq('provedor', 'google_meet');
      return json({
        error: 'O Google não ativou a transcrição automática nesta sala. Verifique o plano da sua conta Workspace.',
        semTranscricaoAutomatica: true,
      }, 409);
    }

    await admin.from('sessions').update({
      meet_space_name: sala.name,
      meet_meeting_uri: sala.meetingUri,
      transcricao_origem: 'meet',
      transcricao_status: 'processando',
    }).eq('id', sessionId);

    return json({ meetingUri: sala.meetingUri, meetingCode: sala.meetingCode, spaceName: sala.name });
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError) {
      return json({ error: err.message, precisaConectar: true }, 409);
    }
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
