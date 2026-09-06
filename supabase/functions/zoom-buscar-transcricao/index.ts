// Transcrição das sessões feitas pelo Zoom.
//
// O Zoom entra aqui só como CAPTAÇÃO. A transcrição dele não serve pra sessão
// clínica em português: ele decide o idioma por reunião, sai em inglês, e não
// existe API nem configuração de conta que mude isso — testado à exaustão em
// 06/09/2026, inclusive o "idioma de fala", que vale só pra legenda ao vivo.
// O único conserto é o "Alterar idioma" manual, gravação por gravação, que
// não dá pra pedir a ninguém toda sessão.
//
// Então esta função baixa o ÁUDIO da gravação em nuvem e manda pra
// `ia-transcrever`, a mesma da gravação pelo celular, que roda em português
// com separação de falantes. Passa a consumir créditos de IA — é o preço de
// ter idioma e qualidade sob controle.
//
// O que se preserva do Zoom, e é bastante: nada gravado pelo celular, sem
// disputa de microfone, cada voz captada da fonte, e o app pode estar fechado
// durante a sessão inteira.
//
// Por que buscar em vez de esperar o webhook do Zoom: em 06/09/2026 o webhook
// simplesmente parou de ser entregue, com tudo verificado do nosso lado — app
// instalado, assinatura ativa, endpoint validando, reuniões criadas com 201 no
// log do próprio Zoom — e zero requisições chegando (a tabela de diagnóstico
// da 0063 ficou vazia depois de quatro sessões). Buscar não depende de o Zoom
// nos alcançar, só de a API dele responder, e essa está provada funcionando.
//
// A conclusão vem depois, pelo `ia-transcrever-webhook`: é ele que grava o
// texto, debita o crédito e avisa. Aqui o trabalho termina no envio.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notificarTranscricao } from '../_shared/notificarTranscricao.ts';
import {
  accessTokenDoUsuario, chamarZoom, IntegracaoInvalidaError,
} from '../_shared/zoom.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Compartilha o segredo de cron com o Meet de propósito: os dois são
// chamados pelo mesmo pg_cron, do mesmo banco, com o mesmo nível de
// confiança — criar um segundo segredo só acrescentaria um passo manual
// (criar no vault E nos secrets) sem separar risco nenhum. Definir
// ZOOM_CRON_SECRET passa a valer, se um dia quisermos separar.
const CRON_SECRET = Deno.env.get('ZOOM_CRON_SECRET')
  ?? Deno.env.get('MEET_CRON_SECRET')
  ?? '';

// Mesmo prazo do Meet: depois disso, sessão que nunca produziu gravação para
// de ser consultada e vira erro, em vez de ficar "processando" pra sempre.
const HORAS_ATE_DESISTIR = 12;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// O aviso (push + e-mail) mora em _shared/notificarTranscricao.ts: estava
// duplicado e as cópias divergiram — esta aqui não mandava e-mail.
const notificar = notificarTranscricao;

async function processarSessao(admin: any, sessao: any): Promise<string> {
  const userId = sessao?.patients?.user_id;
  if (!userId) return 'sem_usuario';

  const idadeHoras = (Date.now() - new Date(sessao.created_at).getTime()) / 3600000;

  let accessToken: string;
  try {
    accessToken = await accessTokenDoUsuario(admin, userId);
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError && idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Transcrição não recebida',
        'A conexão com o Zoom expirou antes de buscar o texto. Reconecte e transcreva manualmente.');
      return 'integracao_invalida';
    }
    return 'aguardando_reconexao';
  }

  // Enquanto a reunião não termina e a gravação não é processada, o Zoom
  // responde 404 aqui — que é espera, não erro.
  let gravacao: any;
  try {
    gravacao = await chamarZoom(accessToken, `/meetings/${sessao.zoom_meeting_id}/recordings`);
  } catch (_) {
    if (idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Nenhuma gravação nesta reunião',
        'O Zoom não gerou gravação para esta sessão. Você pode transcrever manualmente.');
      return 'sem_gravacao';
    }
    return 'aguardando_gravacao';
  }

  const arquivos: any[] = gravacao?.recording_files ?? [];
  // O áudio, não a legenda. A transcrição do próprio Zoom sai em inglês e não
  // há como mudar isso (ver migration 0065): o Zoom serve aqui como captação,
  // e quem transcreve é a AssemblyAI, em português e com separação de falantes.
  const audio = arquivos.find((a) => a?.file_type === 'M4A')
    ?? arquivos.find((a) => a?.recording_type === 'audio_only');
  if (!audio?.download_url) {
    if (idadeHoras > HORAS_ATE_DESISTIR) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Áudio não encontrado',
        'A reunião foi gravada, mas o Zoom não disponibilizou o arquivo de áudio. Você pode transcrever manualmente.');
      return 'sem_audio';
    }
    return 'aguardando_audio';
  }

  // Streaming de ponta a ponta: o áudio vem do Zoom e vai direto pra
  // `ia-transcrever`, sem passar por base64 nem carregar na memória. É a
  // mesma técnica que resolveu o teto de CPU no caminho da gravação pelo
  // celular (ver o cabeçalho de src/services/gravacaoEmBlocos.js).
  const respAudio = await fetch(audio.download_url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!respAudio.ok || !respAudio.body) return 'falha_download';

  // Marca ANTES de enviar: se a resposta se perder no caminho, é melhor uma
  // sessão que espera o webhook do que crédito cobrado duas vezes pelo mesmo
  // áudio na rodada seguinte do cron.
  await admin.from('sessions')
    .update({ zoom_audio_enviado_em: new Date().toISOString() })
    .eq('id', sessao.id);

  const envio = await fetch(`${SUPABASE_URL}/functions/v1/ia-transcrever`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'audio/m4a',
      'x-session-id': sessao.id,
      'x-user-id': userId,
      'x-bloco-indice': '0',
      'x-bloco-total': '1',
    },
    body: respAudio.body,
    duplex: 'half',
  } as RequestInit);

  if (!envio.ok) {
    // Devolve a marca: o envio não aconteceu, então a próxima rodada deve
    // tentar de novo em vez de deixar a sessão esperando pra sempre.
    await admin.from('sessions')
      .update({ zoom_audio_enviado_em: null })
      .eq('id', sessao.id);
    const detalhe = await envio.text().catch(() => '');
    if (/cr[eé]dito/i.test(detalhe)) {
      await admin.from('sessions').update({ transcricao_status: 'erro' }).eq('id', sessao.id);
      await notificar(admin, userId, sessao.id, 'Créditos insuficientes',
        'Não há créditos de IA para transcrever esta sessão. Recarregue e transcreva manualmente.');
      return 'sem_credito';
    }
    // Devolve status e um pedaço do corpo: sem isso "falha_envio" não diz
    // nada e o diagnóstico vira adivinhação.
    return `falha_envio_${envio.status}_${detalhe.slice(0, 60).replace(/[^a-zA-Z0-9 ]/g, '')}`;
  }

  // A conclusão vem depois, pelo `ia-transcrever-webhook`, igual ao caminho
  // da gravação pelo celular: é ele que grava o texto, debita o crédito e
  // avisa. Aqui o trabalho acabou.
  return 'enviado_para_ia';
}

const COLUNAS = 'id, transcript, zoom_meeting_id, created_at, zoom_audio_enviado_em, patients(user_id)';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const ehCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;

    if (ehCron) {
      const { data: sessoes } = await admin
        .from('sessions')
        .select(COLUNAS)
        .not('zoom_meeting_id', 'is', null)
        .eq('transcricao_status', 'processando')
        // Já mandado pra AssemblyAI: quem conclui é o webhook dela, não daqui.
        .is('zoom_audio_enviado_em', null)
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

    // Chamada pelo app ("Buscar transcrição agora"): uma sessão só, e
    // precisa ser dela. Mesmo caminho que o Meet já tinha — sem isto, a
    // única forma de destravar uma sessão era esperar o cron.
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
    if (!sessao?.zoom_meeting_id) return json({ error: 'Esta sessão não foi feita pelo Zoom.' }, 400);
    // Já enviado: reenviar cobraria o crédito duas vezes pelo mesmo áudio.
    if (sessao.zoom_audio_enviado_em) {
      return json({ ok: true, resultado: 'ja_enviado' });
    }

    const resultado = await processarSessao(admin, sessao);
    return json({ ok: true, resultado });
  } catch (err) {
    if (err instanceof IntegracaoInvalidaError) {
      return json({ error: err.message, precisaConectar: true }, 409);
    }
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
