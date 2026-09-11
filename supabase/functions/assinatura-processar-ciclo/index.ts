// Edge Function: assinatura-processar-ciclo
//
// Chamada 1x por dia pelo pg_cron (ver migration 0035) — NÃO pelo app, nem
// pelo Mercado Pago. Verificada por segredo compartilhado (x-cron-secret),
// por isso verify_jwt = false: quem chama não tem JWT de usuário nem
// assinatura HMAC do Mercado Pago, é só o próprio Postgres.
//
// "1x por dia" é a frequência com que a função ACORDA, não a frequência
// com que ela mexe em alguém. O que ela faz é olhar quem está no
// vencimento hoje: quem tem plano mensal cai aqui uma vez por mês, quem
// tem anual uma vez por ano. Acordar todo dia é o que garante que nenhum
// vencimento passe sem ser visto — não é varrer a base inteira todo dia.
//
// ── O que esta função faz hoje: conferir ───────────────────────────────
//
// O estado da assinatura chega por webhook. Webhook é entrega de melhor
// esforço: cai a rede, o Mercado Pago desiste depois de algumas tentativas,
// a função estava fora do ar por trinta segundos — e o evento se perde. Se
// o evento perdido for o da renovação, uma pessoa que PAGOU perde o acesso
// sozinha no dia seguinte, e não há nada no sistema que perceba.
//
// Então todo dia esta função pega quem tem assinatura no Mercado Pago e o
// acesso vencendo (ou já vencido), pergunta ao Mercado Pago como aquela
// assinatura está de verdade, e grava a resposta. Se o webhook funcionou,
// não muda nada — é para não mudar nada mesmo. É uma rede de segurança,
// não um mecanismo de negócio.
//
// A leitura e a gravação usam o MESMO módulo do webhook
// (_shared/assinaturaMercadoPago.ts). Dois lugares implementando "o que
// significa esta preapproval" é como eles divergem em silêncio.
//
// ── O que ela fazia antes, e por que foi removido ──────────────────────
//
// Semestral e anual já foram pagamento ÚNICO (Pix), não assinatura: cobrava
// uma vez, vencia, e ninguém avisava o backend. Esta função existia pra
// suprir isso — no vencimento, tentava reaproveitar um cartão pra criar uma
// preapproval MENSAL, e senão mandava e-mail pedindo renovação manual.
//
// Agora os três planos são preapproval de verdade (1, 6 ou 12 meses), e o
// Mercado Pago renova sozinho. Aquele código deixou de ser inútil e passou
// a ser perigoso: ele veria a assinatura semestral chegando ao fim do ciclo
// — que agora se renova sozinha —, rebaixaria a conta pra 'mensal' e
// criaria uma SEGUNDA cobrança recorrente enquanto a primeira seguia viva.
// Cobrar duas vezes a mesma pessoa não é um bug que se conserta depois.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sincronizarPreapproval } from '../_shared/assinaturaMercadoPago.ts';
import { aplicarDescontoDeIndicacoes } from '../_shared/indicacoes.ts';
import { avisarFimDeAcesso } from '../_shared/avisoFimDeAcesso.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
const CRON_SECRET = Deno.env.get('ASSINATURA_CRON_SECRET')!;

// Confere um pouco ANTES de vencer, não só depois: assim, quando a
// renovação acontece no Mercado Pago e o aviso se perde, o acesso é
// estendido antes que alguém encoste na porta fechada.
const DIAS_DE_ANTECEDENCIA = 3;

// Quanto tempo depois do vencimento ainda vale a pena perguntar. Passado
// isso, quem não voltou não vai voltar por si — e continuar perguntando
// todo dia, pra sempre, sobre toda conta que já existiu só gasta chamada.
const DIAS_DE_RABO = 45;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(servir('assinatura-processar-ciclo', async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const agora = new Date();
  const limiteFuturo = new Date(agora.getTime() + DIAS_DE_ANTECEDENCIA * 86400000);
  const limitePassado = new Date(agora.getTime() - DIAS_DE_RABO * 86400000);

  const resultado = {
    conferidos: 0,
    corrigidos: 0,
    inalterados: 0,
    descontosCorrigidos: 0,
    avisosEnviados: 0,
    erros: [] as string[],
  };

  try {
    // Cortesia fica de fora de propósito: não tem preapproval nenhuma no
    // Mercado Pago e não deve ser tocada por nada disto.
    const { data: contas, error } = await supabaseAdmin
      .from('profiles')
      .select('id, assinatura_status, assinatura_plano, assinatura_expira_em, mp_preapproval_id')
      .not('mp_preapproval_id', 'is', null)
      .in('assinatura_status', ['ativa', 'inadimplente', 'cancelada'])
      .lte('assinatura_expira_em', limiteFuturo.toISOString())
      .gte('assinatura_expira_em', limitePassado.toISOString());
    if (error) throw error;

    for (const conta of contas || []) {
      resultado.conferidos++;
      try {
        const antes = `${conta.assinatura_status}|${conta.assinatura_expira_em}`;
        const sincronia = await sincronizarPreapproval(
          supabaseAdmin,
          MP_ACCESS_TOKEN,
          String(conta.mp_preapproval_id),
          'conferencia-diaria',
        );
        if (!sincronia.ok) {
          resultado.erros.push(`${conta.id}: ${sincronia.erro}`);
          continue;
        }

        const { data: depoisDados } = await supabaseAdmin
          .from('profiles')
          .select('assinatura_status, assinatura_expira_em')
          .eq('id', conta.id)
          .maybeSingle();
        const depois = `${depoisDados?.assinatura_status}|${depoisDados?.assinatura_expira_em}`;

        if (antes === depois) {
          resultado.inalterados++;
        } else {
          resultado.corrigidos++;
          // Vale um registro: cada linha destas é um aviso que o Mercado
          // Pago não entregou. Se aparecerem muitas, o problema não é aqui.
          console.log('assinatura-processar-ciclo: estado corrigido.', {
            conta: conta.id,
            antes,
            depois,
          });
        }
      } catch (err) {
        resultado.erros.push(`${conta.id}: ${String((err as Error)?.message || err)}`);
      }
    }

    // ── Descontos por indicação ──────────────────────────────────────
    //
    // O desconto é recalculado na hora, sempre que a assinatura de um
    // indicado muda de estado (webhook, cancelamento pelo app). Isto aqui
    // é a garantia de que, NA HORA DA COBRANÇA, o valor está certo — mesmo
    // que um webhook tenha se perdido pelo caminho.
    //
    // E é por isso que a varredura não é "todo mundo, todo dia": ela segue
    // o ciclo de cada conta. O desconto só produz efeito no momento em que
    // o Mercado Pago cobra, e esse momento é o vencimento — de mês em mês,
    // de seis em seis, ou de ano em ano, conforme o plano. Ajustar o valor
    // no meio do ciclo não muda nada: a cobrança daquele período já
    // aconteceu.
    //
    // Então entram na conta só duas situações:
    //
    //   a) quem está prestes a ser cobrado. A janela de dois dias é maior
    //      que o intervalo entre execuções de propósito: nenhum vencimento
    //      pode passar sem ser visto uma vez;
    //   b) quem está com acesso gratuito pelas dez indicações. Essas contas
    //      não têm vencimento nenhum — não há cobrança que sirva de âncora
    //      —, e alguém pode ter deixado de ser indicado ativo a qualquer
    //      momento. Aqui a verificação frequente protege a pessoa: é ela
    //      que dispara os 15 dias de aviso, e quanto antes disparar, mais
    //      tempo ela tem pra decidir.
    const janelaCobranca = new Date(agora.getTime() + 2 * 86400000);

    const { data: perto } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('elegivel_indicacao', true)
      .eq('assinatura_status', 'ativa')
      .lte('assinatura_expira_em', janelaCobranca.toISOString());

    const { data: gratuitas } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('elegivel_indicacao', true)
      .eq('assinatura_status', 'gratuita_indicacao');

    const paraRecalcular = [
      ...new Set([...(perto || []), ...(gratuitas || [])].map((c) => String(c.id))),
    ].map((id) => ({ id }));

    for (const conta of paraRecalcular) {
      try {
        // `conferirValorNoMercadoPago`: aqui e a hora da cobranca, entao
        // o valor e lido de la e comparado, em vez de confiar na nossa
        // coluna. Se os dois se separaram, este e o momento de descobrir —
        // nao depois, na fatura de alguem.
        const r = await aplicarDescontoDeIndicacoes(
          supabaseAdmin, MP_ACCESS_TOKEN, String(conta.id),
          { conferirValorNoMercadoPago: true },
        );
        if (r.mudou) {
          resultado.descontosCorrigidos++;
          console.log('assinatura-processar-ciclo: desconto de indicação ajustado.', {
            conta: conta.id, desconto: r.desconto, acao: r.acao, detalhe: r.detalhe,
          });
        }
      } catch (err) {
        resultado.erros.push(`desconto ${conta.id}: ${String((err as Error)?.message || err)}`);
      }
    }

    // ── Aviso de fim de acesso ───────────────────────────────────────
    //
    // Para quem NAO tem cobranca recorrente, a data nao renova: ela fecha.
    // Ate agora isso so estava escrito no cartao dentro do app — quem nao
    // abrisse descobria tentando usar, com a porta fechada, depois de ter
    // organizado a semana contando com ele.
    const avisos = await avisarFimDeAcesso(supabaseAdmin);
    resultado.avisosEnviados = avisos.enviados;
    resultado.erros.push(...avisos.erros);

    return json({ ok: true, ...resultado });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err), ...resultado }, 500);
  }
}));
