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
//   acao: 'instalacoes'          { }                    → lê as instalações do Google Play (mês corrente e anterior) e grava em op_funil, origem 'loja'
//   acao: 'funil'                { dias?: 28 }          → coleta as instalações e devolve a série de op_funil, contas por status e origens
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { servir } from '../_shared/registrarEvento.ts';
import { envelope, enviarEmail, escaparHtml } from '../_shared/emailDrSig.ts';
import { lerInstalacoes, mesesRecentes } from '../_shared/playInstalacoes.ts';

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

// As instalações não têm origem (a loja não diz de onde veio quem instalou):
// ficam na linha origem 'loja' de cada dia, com os contadores de conta a zero.
// Erro aqui não derruba o funil — volta como texto para o agente dizer ao dono.
async function coletarInstalacoes(admin: Admin): Promise<{ dias: number; erro: string | null }> {
  try {
    const dias = await lerInstalacoes(mesesRecentes());
    for (const d of dias) {
      const { error } = await admin.from('op_funil').upsert(
        { dia: d.dia, origem: 'loja', instalacoes: d.instalacoes },
        { onConflict: 'dia,origem' },
      );
      if (error) throw new Error(error.message);
    }
    return { dias: dias.length, erro: null };
  } catch (e) {
    return { dias: 0, erro: e instanceof Error ? e.message : String(e) };
  }
}

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') || '';

/** Receita e custo de um mês ('AAAA-MM'; vazio = mês corrente). */
async function financeiro(admin: Admin, mes: string) {
  const agora = new Date();
  const [ano, m] = /^\d{4}-\d{2}$/.test(mes)
    ? mes.split('-').map(Number)
    : [agora.getUTCFullYear(), agora.getUTCMonth() + 1];
  const inicio = new Date(Date.UTC(ano, m - 1, 1));
  const fim = new Date(Date.UTC(ano, m, 1));
  const iso = (d: Date) => d.toISOString();

  // Mercado Pago: pagamentos aprovados no mês. A busca é paginada; um mês
  // do Dr.Sig cabe em poucas páginas.
  const receita = { assinaturas: 0, recargas: 0, outros: 0, pagamentos: 0, erro: null as string | null };
  if (MP_ACCESS_TOKEN) {
    let offset = 0;
    for (let pagina = 0; pagina < 20; pagina++) {
      const url = `https://api.mercadopago.com/v1/payments/search?sort=date_approved&criteria=desc&range=date_approved&begin_date=${iso(inicio)}&end_date=${iso(fim)}&status=approved&limit=50&offset=${offset}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
      if (!resp.ok) { receita.erro = `Mercado Pago respondeu ${resp.status}`; break; }
      const corpo = await resp.json();
      const resultados: Array<{ transaction_amount?: number; external_reference?: string }> = corpo?.results || [];
      for (const p of resultados) {
        const valor = Number(p.transaction_amount) || 0;
        const ref = String(p.external_reference || '');
        if (ref.startsWith('assinatura:')) receita.assinaturas += valor;
        else if (ref.startsWith('creditos:')) receita.recargas += valor;
        else receita.outros += valor;
        receita.pagamentos++;
      }
      if (resultados.length < 50) break;
      offset += 50;
    }
  } else {
    receita.erro = 'MERCADOPAGO_ACCESS_TOKEN ausente';
  }

  const { data: uso } = await admin
    .from('uso_ia')
    .select('tipo, provedor, custo_estimado')
    .gte('criado_em', iso(inicio))
    .lt('criado_em', iso(fim));
  const porProvedor: Record<string, { cobradoUsd: number; linhas: number }> = {};
  let creditosConcedidosUsd = 0;
  for (const u of uso || []) {
    const custo = Number(u.custo_estimado) || 0;
    if (custo < 0) { creditosConcedidosUsd += -custo; continue; }
    const chave = String(u.provedor || 'desconhecido');
    porProvedor[chave] = porProvedor[chave] || { cobradoUsd: 0, linhas: 0 };
    porProvedor[chave].cobradoUsd += custo;
    porProvedor[chave].linhas++;
  }

  const { data: statusRows } = await admin.rpc('op_status_assinaturas');

  // Câmbio real (PTAX de venda, BCB) para confrontar com a taxa de
  // referência fixa do código.
  let ptax: number | null = null;
  try {
    const d = new Date(Date.now() - 86400000 * 3);
    const dataIni = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
    const hoje = `${String(agora.getUTCMonth() + 1).padStart(2, '0')}-${String(agora.getUTCDate()).padStart(2, '0')}-${agora.getUTCFullYear()}`;
    const r = await fetch(`https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${dataIni}'&@dataFinalCotacao='${hoje}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`);
    const j = await r.json();
    ptax = Number(j?.value?.[0]?.cotacaoVenda) || null;
  } catch (_) { /* sem câmbio, o Tesoureiro diz isso */ }

  return {
    mes: `${ano}-${String(m).padStart(2, '0')}`,
    receitaBrl: receita,
    ia: { cobradoPorProvedorUsd: porProvedor, creditosConcedidosUsd },
    assinaturas: statusRows || [],
    cambio: { ptaxVenda: ptax, taxaReferenciaDoCodigo: 5.08 },
  };
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

    case 'instalacoes':
      return json(await coletarInstalacoes(admin));

    // ── Auditor ──────────────────────────────────────────────────────
    case 'politicas': {
      const { data, error } = await admin.rpc('op_politicas');
      return error ? json({ error: error.message }, 500) : json({ politicas: data });
    }

    case 'auditoria': {
      const { data, error } = await admin.rpc('op_auditoria');
      return error ? json({ error: error.message }, 500) : json({ auditoria: data });
    }

    // ── Analista de funil ────────────────────────────────────────────
    // A série diária de op_funil por origem (instalações na linha 'loja'),
    // mais a foto atual das contas. Coleta as instalações antes de ler.
    case 'funil': {
      const dias = Math.min(Math.max(Number(body?.dias) || 28, 1), 365);
      const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
      const instalacoes = await coletarInstalacoes(admin);
      const [{ data: serie, error }, { data: status }, { data: origens }] = await Promise.all([
        admin.from('op_funil').select('*').gte('dia', desde).order('dia', { ascending: true }),
        admin.rpc('op_status_assinaturas'),
        admin.rpc('op_origens_de_cadastro'),
      ]);
      return error
        ? json({ error: error.message }, 500)
        : json({ desde, serie: serie || [], status: status || [], origens: origens || [], instalacoes });
    }

    // ── Tesoureiro ───────────────────────────────────────────────────
    // O mês em números: o que entrou (Mercado Pago), o que a IA custou
    // (uso_ia) e o câmbio de verdade contra a taxa de referência do código.
    case 'financeiro':
      return json(await financeiro(admin, String(body?.mes || '')));

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
