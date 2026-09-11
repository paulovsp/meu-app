// Edge Function: enviar-digest-diario
// Chamada 1x por dia pelo pg_cron (ver migration 0044), num horário fixo —
// NÃO pelo app. Verificada por segredo compartilhado (x-cron-secret), como
// assinatura-processar-ciclo, por isso deploy com --no-verify-jwt.
//
// Por quê isso existe: antes, o único e-mail de "pagamentos em atraso"
// disparava toda vez que a Início ganhava foco no app (ver
// src/services/alertaAtraso.js) — o horário do envio dependia de quando a
// profissional abria o app naquele dia, então parecia aleatório. Este cron
// substitui isso por UM e-mail agregado por dia, sempre no mesmo horário,
// juntando pagamentos em atraso + sessões sem relato — não mais um e-mail
// por evento. enviar-alerta-atraso continua existindo só pro push (mais
// imediato, não é "caixa de entrada" — menos incômodo que e-mail repetido).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { envelope, enviarEmail, escaparHtml, h2, p } from '../_shared/emailDrSig.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const CRON_SECRET = Deno.env.get('DIGEST_CRON_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function diasNoMes(ano: number, mesIndex: number) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

type Preferencias = {
  atraso: boolean;
  registro: boolean;
  sessao: boolean;
};

async function montarDigestDoProfissional(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  prefs: Preferencias,
) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mesIndex = hoje.getMonth();
  const diaHoje = hoje.getDate();

  const { data: pacientes } = await supabaseAdmin
    .from('patients')
    .select('id, nome, dia_pagamento, tipo_cobranca, data_paralizacao')
    .eq('user_id', userId);
  const todosIds = (pacientes || []).map((p) => p.id);

  // Pagamentos em atraso — cobrança mensal (não por_sessao), sem
  // paralisação ativa, dia de pagamento já passado este mês e ainda não
  // marcado como recebido. Não recalcula valor em R$ aqui (envolveria
  // conversão de moeda) — é só um alerta, o valor exato fica no app.
  const mensais = (pacientes || []).filter(
    (p) => p.tipo_cobranca !== 'por_sessao' && p.dia_pagamento && !p.data_paralizacao
  );
  let atrasados: { nome: string; diasAtraso: number }[] = [];
  if (prefs.atraso && mensais.length > 0) {
    const { data: pagamentosDoMes } = await supabaseAdmin
      .from('pagamentos')
      .select('patient_id, recebido')
      .eq('ano', ano)
      .eq('mes', mesIndex)
      .is('appointment_id', null)
      .in('patient_id', mensais.map((p) => p.id));
    const recebidoPorId = new Set((pagamentosDoMes || []).filter((p) => p.recebido).map((p) => p.patient_id));
    atrasados = mensais
      .filter((p) => !recebidoPorId.has(p.id))
      .map((p) => {
        const vencimento = Math.min(p.dia_pagamento, diasNoMes(ano, mesIndex));
        return { nome: p.nome, diasAtraso: diaHoje - vencimento };
      })
      .filter((p) => p.diasAtraso >= 1);
  }

  // Sessões sem relato (transcrição vazia/nula) — mesma definição de
  // getContagemSessoesSemRelato() no app, só que escopada manualmente por
  // paciente aqui (service_role não passa pela RLS que faz isso sozinha
  // pro cliente autenticado).
  let sessoesSemRelato = 0;
  if (prefs.registro && todosIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .in('patient_id', todosIds)
      .or('transcript.is.null,transcript.eq.');
    sessoesSemRelato = count || 0;
  }

  // Sessões passadas que ninguém confirmou se aconteceram — os mesmos
  // compromissos que o popup de check-in da Início pergunta um a um
  // (listarCompromissosAguardandoCheckin): status ainda 'agendado', data
  // entre 90 dias atrás e hoje. Enquanto não forem respondidos, cobrança
  // por sessão, financeiro e fiscal ficam sem base.
  let aguardandoConfirmacao = 0;
  if (prefs.sessao && todosIds.length > 0) {
    const desde = new Date();
    desde.setDate(desde.getDate() - 90);
    const { count } = await supabaseAdmin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .in('patient_id', todosIds)
      .eq('status', 'agendado')
      .gte('date', desde.toISOString().slice(0, 10))
      // `lt` e não `lte`: o resumo sai de manhã, e sessão marcada pra hoje
      // ainda nem aconteceu — cobrar confirmação dela seria erro.
      .lt('date', new Date().toISOString().slice(0, 10));
    aguardandoConfirmacao = count || 0;
  }

  return { atrasados, sessoesSemRelato, aguardandoConfirmacao };
}

/** "1 sessão" / "2 sessões". O código antigo fazia
 *  `sessão${n === 1 ? '' : 'ões'}`, que produzia "sessãoões" no plural —
 *  texto que ia assim mesmo pra caixa de entrada. */
function plural(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function montarHtml(
  atrasados: { nome: string; diasAtraso: number }[],
  sessoesSemRelato: number,
  aguardandoConfirmacao: number,
) {
  const partes: string[] = [];
  if (aguardandoConfirmacao > 0) {
    partes.push(
      h2(`${plural(aguardandoConfirmacao, 'sessão', 'sessões')} aguardando confirmação`) +
      p(`Abra o app e responda se ${aguardandoConfirmacao === 1 ? 'ela aconteceu' : 'elas aconteceram'} — ` +
        'é isso que atualiza cobrança, financeiro e fiscal.')
    );
  }
  if (atrasados.length > 0) {
    partes.push(
      h2(plural(atrasados.length, 'pagamento em atraso', 'pagamentos em atraso')) +
      p(atrasados.map((a) => `${escaparHtml(a.nome)} — ${a.diasAtraso} dia${a.diasAtraso === 1 ? '' : 's'} de atraso`).join('<br/>'))
    );
  }
  if (sessoesSemRelato > 0) {
    partes.push(
      h2(`${plural(sessoesSemRelato, 'sessão', 'sessões')} sem relato`) +
      p('Adicione a transcrição ou a anotação para manter o prontuário em dia.')
    );
  }
  return envelope({
    titulo: 'Seu resumo de hoje',
    previa: partes.length === 1 ? 'Uma pendência no consultório.' : `${partes.length} pendências no consultório.`,
    corpo: partes.join('') + p('Abra o app Dr.Sig para resolver cada item.', { pequeno: true }),
    rodape: 'Você recebe este resumo porque ligou o aviso por e-mail em Meu Perfil › Notificações. Dá para desligar lá, item a item.',
  });
}

Deno.serve(servir('enviar-digest-diario', async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const resultado = {
    enviados: 0,
    semNadaAvisar: 0,
    erros: [] as string[],
    ensaio: [] as { para: string; secoes: string[]; html: string }[],
  };

  // Modo de ensaio: monta tudo exatamente como no envio real e devolve o
  // que SERIA enviado, sem mandar e-mail nenhum. Existe pra dar como
  // verificar o resumo (inclusive seções que dependem de preferência
  // desligada por padrão) sem escrever na caixa de entrada de ninguém.
  const ensaio = await req.json().then((c) => c?.dryRun === true).catch(() => false);

  try {
    // Cada seção do resumo tem seu próprio interruptor (migration 0057).
    // Antes o e-mail inteiro dependia só de `notif_atraso_email`, então
    // quem desligava aviso de atraso perdia junto o de sessões sem relato,
    // que é outro assunto.
    const { data: perfis, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, nome, expo_push_token, notif_atraso_email, '
        + 'notif_registro_email, notif_sessao_email, notif_sessao_push')
      .in('assinatura_status', ['ativa', 'cortesia']);
    if (error) throw error;

    for (const perfil of perfis || []) {
      try {
        // O push de "sessão aguardando confirmação" sai daqui porque o
        // número já é calculado pro e-mail — mandar de outro lugar seria
        // varrer a agenda duas vezes por dia pelo mesmo dado.
        const sessaoPush = perfil.notif_sessao_push === true && !!perfil.expo_push_token;
        const sessaoEmail = perfil.notif_sessao_email === true;
        const prefs = {
          atraso: perfil.notif_atraso_email !== false,
          registro: perfil.notif_registro_email !== false,
          // Precisa ser calculado se QUALQUER um dos dois canais quer o
          // número — senão ligar só o push não traria nada pra notificar.
          sessao: sessaoEmail || sessaoPush,
        };
        if (!prefs.atraso && !prefs.registro && !prefs.sessao) {
          resultado.semNadaAvisar++;
          continue;
        }

        const { atrasados, sessoesSemRelato, aguardandoConfirmacao } =
          await montarDigestDoProfissional(supabaseAdmin, perfil.id, prefs);
        if (atrasados.length === 0 && sessoesSemRelato === 0 && aguardandoConfirmacao === 0) {
          resultado.semNadaAvisar++;
          continue;
        }

        if (sessaoPush && aguardandoConfirmacao > 0 && !ensaio) {
          try {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: perfil.expo_push_token,
                channelId: 'sessao',
                title: aguardandoConfirmacao === 1
                  ? 'Uma sessão esperando confirmação'
                  : `${aguardandoConfirmacao} sessões esperando confirmação`,
                body: 'Abra o Dr.Sig para confirmar se aconteceram.',
              }),
            });
          } catch (_) { /* push é o canal descartável: o e-mail ainda vai */ }
        }

        // O e-mail tem interruptor próprio: ligar só o push não deve
        // passar a mandar e-mail junto.
        if (!prefs.atraso && !prefs.registro && !sessaoEmail) {
          resultado.semNadaAvisar++;
          continue;
        }

        if (ensaio) {
          const secoes: string[] = [];
          if (aguardandoConfirmacao > 0) secoes.push(`aguardando confirmação: ${aguardandoConfirmacao}`);
          if (atrasados.length > 0) secoes.push(`atrasados: ${atrasados.length}`);
          if (sessoesSemRelato > 0) secoes.push(`sem relato: ${sessoesSemRelato}`);
          resultado.ensaio.push({
            para: perfil.email,
            secoes,
            html: montarHtml(atrasados, sessoesSemRelato, sessaoEmail ? aguardandoConfirmacao : 0),
          });
          continue;
        }

        try {
          await enviarEmail(
            RESEND_API_KEY,
            perfil.email,
            'Seu resumo de hoje — Dr.Sig',
            montarHtml(atrasados, sessoesSemRelato, sessaoEmail ? aguardandoConfirmacao : 0),
          );
        } catch (erro) {
          resultado.erros.push(`${perfil.id}: ${String((erro as Error).message || erro)}`);
          continue;
        }
        resultado.enviados++;
      } catch (e) {
        resultado.erros.push(`${perfil.id}: ${(e as Error)?.message || e}`);
      }
    }

    return json({ ok: true, ...resultado });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err), ...resultado }, 500);
  }
}));
