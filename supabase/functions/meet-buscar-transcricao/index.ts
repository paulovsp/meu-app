// Edge Function: meet-buscar-transcricao
// Busca no Google a transcrição das sessões feitas pelo Meet e salva no app.
//
// É um cron (não um webhook) porque o Google Meet não avisa ninguém quando a
// transcrição fica pronta — ela aparece alguns minutos depois da chamada
// terminar, quando o app pode estar fechado. Ver o agendamento na migration
// 0056, no mesmo padrão do enviar-digest-diario (migration 0044).
//
// Aceita dois chamadores:
//   - o cron, com o header x-cron-secret: varre todas as sessões pendentes;
//   - o app, com o JWT da profissional: força a busca de UMA sessão, pra
//     quando ela não quer esperar o próximo ciclo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { accessTokenDoUsuario, chamarMeet, IntegracaoInvalidaError } from '../_shared/google.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('MEET_CRON_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Depois disso, uma sessão que nunca teve chamada nenhuma na sala para de
// ser consultada e vira erro — senão ficaria "processando" pra sempre, que
// é exatamente o sintoma que originou todo este trabalho.
const HORAS_ATE_DESISTIR = 12;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Monta o texto no formato de turnos que o app já usa ("A:" analista,
 * "P:" analisante).
 *
 * O Google identifica os participantes, mas não sabe quem é analista e quem
 * é analisante. Quem abriu a sala é a profissional, então o participante que
 * entrou primeiro vira "A:" e os demais "P:" — mesmo critério de chute usado
 * com a AssemblyAI, e corrigível na tela da sessão.
 */
function montarTurnos(entradas: any[], participanteAnalista: string | null) {
  return entradas
    .map((e: any) => {
      const texto = String(e?.text || '').trim();
      if (!texto) return '';
      const ehAnalista = participanteAnalista && e?.participant === participanteAnalista;
      return `${ehAnalista ? 'A' : 'P'}: ${texto}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function listarTudo(accessToken: string, caminho: string, chave: string) {
  const itens: any[] = [];
  let pageToken = '';
  do {
    const sep = caminho.includes('?') ? '&' : '?';
    const sufixo = pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : '';
    const corpo = await chamarMeet(accessToken, `${caminho}${sufixo}`);
    itens.push(...(corpo?.[chave] ?? []));
    pageToken = corpo?.nextPageToken ?? '';
  } while (pageToken);
  return itens;
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

/** Processa UMA sessão. Devolve o que aconteceu, pro cron poder registrar. */
async function processarSessao(admin: any, sessao: any): Promise<string> {
  const userId = sessao.patients?.user_id;
  if (!userId) return 'sem_dono';

  const idadeHoras = (Date.now() - new Date(sessao.created_at).getTime()) / 3600000;

  let accessToken: string;
  try {
    accessToken = await accessTokenDoUsuario(admin, userId);
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError && idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Transcrição não recebida',
        'A conexão com o Google expirou antes de buscar o texto. Reconecte e transcreva manualmente.');
      return 'integracao_invalida';
    }
    return 'aguardando_reconexao';
  }

  const filtro = encodeURIComponent(`space.name = "${sessao.meet_space_name}"`);
  const registros = await listarTudo(accessToken, `conferenceRecords?filter=${filtro}`, 'conferenceRecords');
  // Só interessa chamada já encerrada: enquanto endTime é nulo, a sessão
  // ainda está acontecendo e a transcrição não existe.
  const encerrada = registros.find((r: any) => r?.endTime);
  if (!encerrada) {
    if (idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Nenhuma chamada nesta sala',
        'Não houve chamada no link gerado para esta sessão. Você pode transcrever manualmente.');
      return 'sem_chamada';
    }
    return 'aguardando_chamada';
  }

  const transcricoes = await listarTudo(accessToken, `${encerrada.name}/transcripts`, 'transcripts');
  const pronta = transcricoes.find((t: any) => t?.state === 'ENDED') ?? transcricoes[0];
  if (!pronta) {
    if (idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({
        transcricao_status: 'erro',
        meet_conference_record: encerrada.name,
      }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Transcrição não gerada',
        'A chamada aconteceu, mas o Google não gerou transcrição. Verifique o plano da conta.');
      return 'sem_transcricao';
    }
    return 'aguardando_transcricao';
  }

  const entradas = await listarTudo(accessToken, `${pronta.name}/entries`, 'transcriptEntries');
  if (entradas.length === 0) return 'aguardando_entradas';

  // Quem entrou primeiro na chamada é quem abriu a sala: a profissional.
  let participanteAnalista: string | null = null;
  try {
    const participantes = await listarTudo(accessToken, `${encerrada.name}/participants`, 'participants');
    const ordenados = participantes
      .filter((p: any) => p?.earliestStartTime)
      .sort((a: any, b: any) => String(a.earliestStartTime).localeCompare(String(b.earliestStartTime)));
    participanteAnalista = ordenados[0]?.name ?? null;
  } catch (_) {
    // Sem essa informação todas as falas viram "P:" e a profissional ajusta
    // na tela — melhor isso do que perder a transcrição inteira.
  }

  const corpo = montarTurnos(entradas, participanteAnalista);
  // Preserva o parágrafo de introdução gravado pelo app, igual ao caminho da
  // AssemblyAI; extrair só ele deixa a montagem idempotente.
  const introducao = String(sessao.transcript || '').split('\n\n')[0].trim();

  await admin.from('sessions').update({
    transcript: introducao ? `${introducao}\n\n${corpo}` : corpo,
    transcricao_status: 'concluida',
    meet_conference_record: encerrada.name,
    transcricao_origem: 'meet',
  }).eq('id', sessao.id);

  // Sem débito de crédito de propósito: quem transcreveu foi o Google, não a
  // AssemblyAI — não há custo pra Dr.Sig repassar.
  await notificar(admin, userId, sessao.id, 'Transcrição pronta',
    'A transcrição da sua sessão pelo Meet já está disponível.');
  return 'concluida';
}

const COLUNAS = 'id, transcript, meet_space_name, created_at, patients(user_id)';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const ehCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;

    if (ehCron) {
      const { data: sessoes } = await admin
        .from('sessions')
        .select(COLUNAS)
        .not('meet_space_name', 'is', null)
        .eq('transcricao_status', 'processando')
        .limit(50);

      const resultados: Record<string, number> = {};
      for (const sessao of sessoes ?? []) {
        try {
          const r = await processarSessao(admin, sessao);
          resultados[r] = (resultados[r] ?? 0) + 1;
        } catch (_) {
          resultados.erro = (resultados.erro ?? 0) + 1;
        }
      }
      return json({ ok: true, processadas: (sessoes ?? []).length, resultados });
    }

    // Chamada pelo app: uma sessão só, e precisa ser dela.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseUser.auth.getUser();
    if (!userData?.user) return json({ error: 'Sessão inválida.' }, 401);

    const { sessionId } = await req.json().catch(() => ({}));
    if (!sessionId) return json({ error: 'sessionId ausente.' }, 400);

    const { data: permitida } = await supabaseUser
      .from('sessions').select('id').eq('id', sessionId).maybeSingle();
    if (!permitida) return json({ error: 'Sessão não encontrada ou sem permissão.' }, 404);

    const { data: sessao } = await admin.from('sessions').select(COLUNAS).eq('id', sessionId).single();
    if (!sessao?.meet_space_name) return json({ error: 'Esta sessão não foi feita pelo Meet.' }, 400);

    const resultado = await processarSessao(admin, sessao);
    return json({ ok: true, resultado });
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError) {
      return json({ error: err.message, precisaConectar: true }, 409);
    }
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
