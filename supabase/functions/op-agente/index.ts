// Edge Function: op-agente
//
// A porta única pela qual os agentes de operação leem e escrevem o estado
// do app. Existe porque os agentes rodam fora daqui — numa rotina na
// nuvem, ou numa sessão no computador do dono — e não têm o CLI do
// Supabase linkado nem a service role. O que eles têm é um segredo de
// operação (`x-op-secret`, OP_SECRET), o mesmo espírito do x-cron-secret.
//
// Leituras devolvem RESUMOS, não dumps: o agente raciocina sobre o que já
// foi contado e agrupado, o que mantém o custo de IA baixo e a resposta
// auditável.
//
//   acao: 'resumo'               { horas?: 24 }         → o estado das últimas N horas
//   acao: 'eventos'              { horas?, origem? }    → os eventos em si (limitados)
//   acao: 'abrir_incidente'      { titulo, severidade, origem?, resumo?, evento_ids?, aberto_por }
//   acao: 'atualizar_incidente'  { id, status?, resumo?, pr_url? }
//   acao: 'adicionar_backlog'    { titulo, descricao?, origem, autora_email? }
//   acao: 'classificar_feedback' { id, classificacao, resposta_rascunho?, incidente_id?, backlog_id? }
//   acao: 'registrar_feedback'   { canal, de_email?, de_nome?, assunto?, corpo }   (o dono cola um feedback)
//   acao: 'marcar_eventos'       { ids: number[] }      → tratados
//   acao: 'rodada'               { agente, resultado?, relatorio_path?, resumo?, id? } → abre/fecha uma rodada
//   acao: 'funil_hoje'           { }                    → conta cadastros e assinaturas do dia, por origem, e grava em op_funil
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { servir } from '../_shared/registrarEvento.ts';
import { envelope, enviarEmail, escaparHtml } from '../_shared/emailDrSig.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OP_SECRET = Deno.env.get('OP_SECRET')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const EMAIL_DO_DONO = 'paulovsp@gmail.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Admin = ReturnType<typeof createClient>;

async function resumo(admin: Admin, horas: number) {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();

  const { data: eventos } = await admin
    .from('op_eventos')
    .select('id, origem, severidade, mensagem, criado_em, tratado_em')
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(500);

  // Agrupa por origem+mensagem: cem repetições do mesmo erro são um item.
  const grupos = new Map<string, { origem: string; severidade: string; mensagem: string; vezes: number; ultimo: string; ids: number[] }>();
  for (const e of eventos || []) {
    const chave = `${e.origem}|${e.severidade}|${String(e.mensagem).slice(0, 120)}`;
    const g = grupos.get(chave) || { origem: e.origem, severidade: e.severidade, mensagem: String(e.mensagem).slice(0, 200), vezes: 0, ultimo: e.criado_em, ids: [] };
    g.vezes++;
    if (g.ids.length < 50) g.ids.push(e.id);
    grupos.set(chave, g);
  }

  const { data: cron } = await admin.rpc('op_cron_falhas', { desde });

  const [
    { count: naoIdentificados },
    { data: incidentes },
    { count: feedbacksPendentes },
    { data: saldosNegativos },
    { data: transcricoesTravadas },
    { count: inadimplentes },
    { count: cadastros },
    { count: assinaturasNovas },
  ] = await Promise.all([
    admin.from('pagamentos_nao_identificados').select('*', { count: 'exact', head: true }).gte('criado_em', desde),
    admin.from('op_incidentes').select('id, titulo, severidade, status, origem, criado_em, atualizado_em').neq('status', 'fechado').order('criado_em', { ascending: false }),
    admin.from('op_feedbacks').select('*', { count: 'exact', head: true }).is('tratado_em', null),
    admin.from('profiles').select('id, creditos_ia, assinatura_status').lt('creditos_ia', 0).limit(50),
    admin.from('sessions').select('id, user_id, transcricao_status, updated_at').eq('transcricao_status', 'processando').lt('updated_at', new Date(Date.now() - 2 * 3600_000).toISOString()).limit(50),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('assinatura_status', 'inadimplente'),
    admin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', desde),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('assinatura_status', 'ativa').gte('assinatura_ciclo_inicio', desde),
  ]);

  return {
    janela: { horas, desde, ate: new Date().toISOString() },
    eventos: {
      total: (eventos || []).length,
      grupos: Array.from(grupos.values()).sort((a, b) => b.vezes - a.vezes),
    },
    cron: cron || [],
    dinheiro: { pagamentosNaoIdentificados: naoIdentificados || 0, inadimplentes: inadimplentes || 0 },
    ia: { saldosNegativos: saldosNegativos || [], transcricoesTravadas: transcricoesTravadas || [] },
    usuarias: { feedbacksPendentes: feedbacksPendentes || 0 },
    funil: { cadastros: cadastros || 0, assinaturasNovas: assinaturasNovas || 0 },
    incidentesAbertos: incidentes || [],
  };
}

async function funilHoje(admin: Admin) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: linhas, error } = await admin.rpc('op_funil_do_dia', { dia: hoje });
  if (error) return { error: error.message };
  for (const l of linhas || []) {
    await admin.from('op_funil').upsert({
      dia: hoje,
      origem: l.origem || 'desconhecida',
      cadastros: l.cadastros,
      assinaturas: l.assinaturas,
      cancelamentos: l.cancelamentos,
    }, { onConflict: 'dia,origem' });
  }
  return { dia: hoje, linhas: linhas || [] };
}

Deno.serve(servir('op-agente', async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!OP_SECRET || req.headers.get('x-op-secret') !== OP_SECRET) return json({ error: 'Não autorizado.' }, 401);

  const body = await req.json().catch(() => ({}));
  const acao = String(body?.acao || '');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const agora = new Date().toISOString();

  switch (acao) {
    case 'resumo':
      return json(await resumo(admin, Math.min(Math.max(Number(body?.horas) || 24, 1), 24 * 14)));

    case 'eventos': {
      const horas = Math.min(Math.max(Number(body?.horas) || 24, 1), 24 * 14);
      let q = admin.from('op_eventos').select('*').gte('criado_em', new Date(Date.now() - horas * 3600_000).toISOString()).order('criado_em', { ascending: false }).limit(200);
      if (body?.origem) q = q.eq('origem', String(body.origem));
      const { data, error } = await q;
      return error ? json({ error: error.message }, 500) : json({ eventos: data });
    }

    case 'abrir_incidente': {
      const { data, error } = await admin.from('op_incidentes').insert({
        titulo: String(body?.titulo || '').slice(0, 200),
        severidade: body?.severidade,
        origem: body?.origem ?? null,
        resumo: body?.resumo ?? null,
        evento_ids: Array.isArray(body?.evento_ids) ? body.evento_ids : [],
        aberto_por: String(body?.aberto_por || 'agente'),
      }).select('id').single();
      if (error) return json({ error: error.message }, 400);
      if (Array.isArray(body?.evento_ids) && body.evento_ids.length) {
        await admin.from('op_eventos').update({ tratado_em: agora }).in('id', body.evento_ids);
      }
      return json({ ok: true, id: data.id });
    }

    case 'atualizar_incidente': {
      const patch: Record<string, unknown> = { atualizado_em: agora };
      if (body?.status) patch.status = body.status;
      if (body?.resumo != null) patch.resumo = body.resumo;
      if (body?.pr_url != null) patch.pr_url = body.pr_url;
      if (body?.status === 'fechado') patch.fechado_em = agora;
      const { error } = await admin.from('op_incidentes').update(patch).eq('id', Number(body?.id));
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    case 'adicionar_backlog': {
      const { data, error } = await admin.from('op_backlog').insert({
        titulo: String(body?.titulo || '').slice(0, 200),
        descricao: body?.descricao ?? null,
        origem: String(body?.origem || 'agente'),
        autora_email: body?.autora_email ?? null,
      }).select('id').single();
      return error ? json({ error: error.message }, 400) : json({ ok: true, id: data.id });
    }

    case 'registrar_feedback': {
      const { data, error } = await admin.from('op_feedbacks').insert({
        canal: body?.canal || 'manual',
        de_email: body?.de_email ?? null,
        de_nome: body?.de_nome ?? null,
        assunto: body?.assunto ?? null,
        corpo: String(body?.corpo || ''),
      }).select('id').single();
      return error ? json({ error: error.message }, 400) : json({ ok: true, id: data.id });
    }

    case 'feedbacks_pendentes': {
      const { data, error } = await admin.from('op_feedbacks').select('*').is('tratado_em', null).order('recebido_em', { ascending: true }).limit(100);
      return error ? json({ error: error.message }, 500) : json({ feedbacks: data });
    }

    case 'classificar_feedback': {
      const { error } = await admin.from('op_feedbacks').update({
        classificacao: body?.classificacao,
        resposta_rascunho: body?.resposta_rascunho ?? null,
        incidente_id: body?.incidente_id ?? null,
        backlog_id: body?.backlog_id ?? null,
        tratado_em: agora,
      }).eq('id', Number(body?.id));
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    case 'marcar_eventos': {
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      const { error } = await admin.from('op_eventos').update({ tratado_em: agora }).in('id', ids);
      return error ? json({ error: error.message }, 400) : json({ ok: true, marcados: ids.length });
    }

    case 'rodada': {
      if (body?.id) {
        const { error } = await admin.from('op_rodadas').update({
          concluida_em: agora,
          resultado: body?.resultado ?? null,
          relatorio_path: body?.relatorio_path ?? null,
          resumo: body?.resumo ?? null,
        }).eq('id', Number(body.id));
        return error ? json({ error: error.message }, 400) : json({ ok: true });
      }
      const { data, error } = await admin.from('op_rodadas').insert({ agente: String(body?.agente || 'agente') }).select('id').single();
      return error ? json({ error: error.message }, 400) : json({ ok: true, id: data.id });
    }

    case 'funil_hoje':
      return json(await funilHoje(admin));

    // O único jeito de um agente falar com o dono: um e-mail, no envelope
    // da marca, só quando há amarelo ou vermelho.
    case 'avisar_dono': {
      const assunto = String(body?.assunto || 'Operação Dr.Sig');
      const corpoHtml = String(body?.corpo_html || '');
      if (!corpoHtml) return json({ error: 'corpo_html vazio.' }, 400);
      try {
        await enviarEmail(RESEND_API_KEY, EMAIL_DO_DONO, assunto, envelope({
          titulo: escaparHtml(assunto),
          corpo: corpoHtml,
          rodape: `Enviado pelo agente ${escaparHtml(String(body?.agente || 'de operação'))}. Detalhes no relatório em operacao/ no repositório.`,
        }));
        return json({ ok: true });
      } catch (err) {
        return json({ error: String((err as Error).message || err) }, 502);
      }
    }

    default:
      return json({ error: 'Ação desconhecida.' }, 400);
  }
}));
