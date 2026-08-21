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

async function montarDigestDoProfissional(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string
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
  if (mensais.length > 0) {
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
  if (todosIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .in('patient_id', todosIds)
      .or('transcript.is.null,transcript.eq.');
    sessoesSemRelato = count || 0;
  }

  return { atrasados, sessoesSemRelato };
}

function montarHtml(atrasados: { nome: string; diasAtraso: number }[], sessoesSemRelato: number) {
  const partes: string[] = [];
  if (atrasados.length > 0) {
    partes.push(
      `<h3>${atrasados.length} pagamento${atrasados.length === 1 ? '' : 's'} em atraso</h3><p>` +
      atrasados.map((a) => `${a.nome} — ${a.diasAtraso} dia${a.diasAtraso === 1 ? '' : 's'} de atraso`).join('<br/>') +
      `</p>`
    );
  }
  if (sessoesSemRelato > 0) {
    partes.push(
      `<h3>${sessoesSemRelato} sessão${sessoesSemRelato === 1 ? '' : 'ões'} sem relato</h3>` +
      `<p>Adicione a transcrição ou anotação pra manter o prontuário em dia.</p>`
    );
  }
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
      <h2>Seu resumo diário — Dr.Sig</h2>
      ${partes.join('')}
      <p><a href="https://drsig.com.br" style="color:#3D5A80;">Abra o app pra ver os detalhes.</a></p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const resultado = { enviados: 0, semNadaAvisar: 0, erros: [] as string[] };

  try {
    const { data: perfis, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, nome')
      .in('assinatura_status', ['ativa', 'cortesia'])
      .neq('notif_atraso_email', false);
    if (error) throw error;

    for (const perfil of perfis || []) {
      try {
        const { atrasados, sessoesSemRelato } = await montarDigestDoProfissional(supabaseAdmin, perfil.id);
        if (atrasados.length === 0 && sessoesSemRelato === 0) {
          resultado.semNadaAvisar++;
          continue;
        }

        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Dr.Sig <naoresponda@drsig.com.br>',
            to: [perfil.email],
            subject: 'Seu resumo diário',
            html: montarHtml(atrasados, sessoesSemRelato),
          }),
        });
        if (!resp.ok) {
          resultado.erros.push(`${perfil.id}: ${await resp.text()}`);
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
});
