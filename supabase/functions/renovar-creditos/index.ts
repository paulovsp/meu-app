// Edge Function: renovar-creditos
// Renovação mensal automática do crédito de IA, de acordo com o plano de
// assinatura da conta (mensal/semestral/anual — atribuído manualmente,
// mesmo padrão do saldo). Chamada silenciosamente pelo app (ex: ao abrir
// Meu Perfil) — não depende de nenhum cron: se a conta ficar dias/meses
// sem abrir o app, esta função "recupera o atraso" e credita todos os
// meses que ficaram pendentes de uma vez (até um limite de segurança).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

import { CREDITO_MENSAL_BRL, creditoMensalUsd } from '../_shared/creditoDoPlano.ts';

const MAX_RENOVACOES_DE_UMA_VEZ = 24;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseDateISO(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addMonthsUTC(d: Date, n: number) {
  const nd = new Date(d);
  nd.setUTCMonth(nd.getUTCMonth() + n);
  return nd;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('creditos_ia, assinatura_plano, assinatura_status, assinatura_expira_em, proxima_renovacao_credito')
      .eq('id', userId)
      .single();
    if (perfilError || !perfil) return json({ error: 'Perfil não encontrado.' }, 404);

    // Lia `plano_ia`, uma coluna que NADA no sistema preenchia — então esta
    // função desistia aqui em toda conta real, e o crédito mensal nunca
    // chegava a ninguém. Quem sabe o plano é `assinatura_plano`, escrito
    // pelo webhook do Mercado Pago quando o pagamento entra.
    const plano = perfil.assinatura_plano as string | null;
    if (!plano || !CREDITO_MENSAL_BRL[plano]) {
      return json({ renovado: false, motivo: 'sem_plano', saldoAtual: Number(perfil.creditos_ia) });
    }

    // Só quem tem acesso valendo ganha crédito novo. Sem isto, quem parasse
    // de pagar seguiria ganhando o brinde todo mês, pra sempre.
    //
    // "Acesso valendo" é a mesma regra de `assinatura_ativa`, e inclui a
    // assinatura CANCELADA dentro do período pago: quem pagou seis meses e
    // cancelou no segundo tem quatro meses de crédito prometido pela
    // frente — o que foi pago está pago, inteiro. E inclui a conta
    // gratuita por indicações, que tem o plano completo, crédito junto.
    const vencida = perfil.assinatura_expira_em
      && new Date(perfil.assinatura_expira_em as string).getTime() < Date.now();
    const status = String(perfil.assinatura_status || '');
    const gratuitaPorIndicacoes = status === 'gratuita_indicacao';
    if (!gratuitaPorIndicacoes && !['ativa', 'cortesia', 'cancelada'].includes(status)) {
      return json({ renovado: false, motivo: 'assinatura_inativa', saldoAtual: Number(perfil.creditos_ia) });
    }
    if (!gratuitaPorIndicacoes && vencida) {
      return json({ renovado: false, motivo: 'assinatura_vencida', saldoAtual: Number(perfil.creditos_ia) });
    }

    const valorMensalUsd = creditoMensalUsd(plano)!;

    const hoje = new Date();
    const hojeUTC = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
    let proxima = perfil.proxima_renovacao_credito ? parseDateISO(perfil.proxima_renovacao_credito) : hojeUTC;

    let saldo = Number(perfil.creditos_ia);
    let renovacoes = 0;

    while (proxima.getTime() <= hojeUTC.getTime() && renovacoes < MAX_RENOVACOES_DE_UMA_VEZ) {
      saldo += valorMensalUsd;
      await supabaseAdmin.from('uso_ia').insert({
        user_id: userId,
        tipo: 'renovacao',
        provedor: 'sistema',
        modelo: `plano_${plano}`,
        unidades: null,
        custo_estimado: -valorMensalUsd,
      });
      proxima = addMonthsUTC(proxima, 1);
      renovacoes++;
    }

    if (renovacoes === 0) {
      return json({ renovado: false, saldoAtual: saldo, proximaRenovacao: formatDateISO(proxima) });
    }

    const { data: atualizado } = await supabaseAdmin
      .from('profiles')
      .update({ creditos_ia: saldo, proxima_renovacao_credito: formatDateISO(proxima) })
      .eq('id', userId)
      .select('creditos_ia, proxima_renovacao_credito')
      .single();

    return json({
      renovado: true,
      renovacoes,
      saldoAtual: atualizado?.creditos_ia ?? saldo,
      proximaRenovacao: atualizado?.proxima_renovacao_credito ?? formatDateISO(proxima),
    });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
