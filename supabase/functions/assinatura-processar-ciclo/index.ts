// Edge Function: assinatura-processar-ciclo
// Chamada 1x por dia pelo pg_cron (ver migration 0035) — NÃO pelo app, nem
// pelo Mercado Pago. Verificada por segredo compartilhado (x-cron-secret),
// por isso deploy com --no-verify-jwt (quem chama não tem JWT de usuário
// nem assinatura HMAC do Mercado Pago, é só o próprio Postgres).
//
// Por quê isso existe: os planos Semestral e Anual são pagos por Pix,
// como cobrança ÚNICA (não são preapproval — ver nota no topo do
// mercadopago-webhook: a API de assinatura recorrente do Mercado Pago só
// documenta cartão, não Pix). Cobram uma vez e pronto, sem outro evento do
// Mercado Pago no fim do período pago. Ninguém avisa o backend quando o
// ciclo termina; é preciso checar isso ativamente, todo dia, pra quem está
// terminando o ciclo:
//   1) tenta reaproveitar um cartão salvo de uma preapproval anterior pra
//      criar uma NOVA preapproval mensal recorrente, no valor com desconto
//      (R$69 quem veio do semestral, R$49 quem veio do anual) — nunca o
//      R$89 cheio. Na prática, isso SÓ existe se a conta tiver um
//      `mp_preapproval_id` salvo — o que não é o caso de quem pagou o
//      semestral/anual por Pix (Pix não guarda cartão nenhum). Ou seja,
//      pra praticamente toda conta que passa por aqui, este passo é
//      pulado de propósito, não é uma falha;
//   2) por isso o caminho normal — não um fallback de exceção — é avisar a
//      profissional por e-mail + push com um link pra confirmar a nova
//      assinatura mensal (aí sim informando um cartão), mantendo o acesso
//      ativo por 5 dias de carência antes de marcar inadimplente.
//
// O passo 1 só teria efeito num cenário hipotético em que o Semestral/Anual
// passasse a ser vendido via cartão/preapproval no futuro — mantido aqui
// como best-effort, sem custo, caso isso mude.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const CRON_SECRET = Deno.env.get('ASSINATURA_CRON_SECRET')!;

const MP_API = 'https://api.mercadopago.com';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CARENCIA_DIAS = 5;
const CHECKOUT_URL = 'https://drsig.com.br/#acesso';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatarMoedaBRL(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// deno-lint-ignore no-explicit-any
async function tentarReaproveitarPagamento(preapprovalAnteriorId: string, novoValor: number): Promise<string | null> {
  try {
    const respAnterior = await fetch(`${MP_API}/preapproval/${preapprovalAnteriorId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!respAnterior.ok) return null;
    const anterior = await respAnterior.json();

    // Campos que, segundo a documentação de Cartões salvos, permitem gerar
    // um novo token sem repetir CVV — só existem se a preapproval original
    // foi criada com um customer/card vinculado (ver nota de incerteza no
    // topo do arquivo). Se não existir, não há o que reaproveitar.
    const cardId = anterior?.card_id || anterior?.payment_method_id_card;
    const customerId = anterior?.payer?.id || anterior?.payer_id;
    if (!cardId || !customerId) return null;

    const respToken = await fetch(`${MP_API}/v1/card_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, customer_id: customerId }),
    });
    if (!respToken.ok) return null;
    const tokenData = await respToken.json();
    if (!tokenData?.id) return null;

    const respNova = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Dr.Sig — assinatura mensal',
        payer_email: anterior.payer_email,
        card_token_id: tokenData.id,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: novoValor,
          currency_id: 'BRL',
        },
        back_url: CHECKOUT_URL,
        status: 'authorized',
      }),
    });
    if (!respNova.ok) return null;
    const nova = await respNova.json();
    return nova?.id || null;
  } catch (_err) {
    return null;
  }
}

async function enviarAvisoRenovacao(email: string, nome: string, plano: string, valorMensal: number) {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Dr.Sig <naoresponda@drsig.com.br>',
      to: [email],
      subject: 'Sua assinatura do Dr.Sig precisa ser confirmada',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
          <h2>Seu ciclo ${plano} terminou</h2>
          <p>Olá, ${nome || ''}.</p>
          <p>O período do seu plano ${plano} do Dr.Sig chegou ao fim. Não conseguimos renovar automaticamente
          — confirme sua assinatura mensal, mantendo o valor com desconto de <strong>${formatarMoedaBRL(valorMensal)}/mês</strong>
          (em vez do valor cheio):</p>
          <p><a href="${CHECKOUT_URL}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar assinatura</a></p>
          <p style="color:#888;font-size:12px;">Seu acesso continua ativo por ${CARENCIA_DIAS} dias. Depois disso, sem confirmação, a conta fica sem assinatura ativa — seus dados continuam guardados e você pode retomar quando quiser.</p>
        </div>
      `,
    }),
  }).catch(() => {});
}

async function enviarPush(supabaseAdmin: ReturnType<typeof createClient>, userId: string, title: string, bodyMsg: string) {
  try {
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();
    const token = perfil?.expo_push_token;
    if (!token) return;
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title, body: bodyMsg }),
    });
  } catch (_err) {
    // Notificação é reforço, não é a via principal (e-mail é) — falha aqui não deve derrubar o processamento.
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const agora = new Date();
  const resultado = { renovadosAutomaticamente: 0, avisados: 0, suspensosPorCarenciaEsgotada: 0, erros: [] as string[] };

  try {
    // 1) Ciclos semestral/anual que acabaram de vencer e ainda não foram
    // avisados — primeira passagem: tenta renovar sozinho, senão avisa.
    const { data: venceram, error: erroVenceram } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, assinatura_plano, assinatura_valor_mensal_equivalente, mp_preapproval_id, assinatura_expira_em')
      .in('assinatura_plano', ['semestral', 'anual'])
      .eq('assinatura_status', 'ativa')
      .is('assinatura_renovacao_notificada_em', null)
      .lte('assinatura_expira_em', agora.toISOString());
    if (erroVenceram) throw erroVenceram;

    for (const perfil of venceram || []) {
      const valorMensal = Number(perfil.assinatura_valor_mensal_equivalente) || 89;
      const novaPreapprovalId = perfil.mp_preapproval_id
        ? await tentarReaproveitarPagamento(perfil.mp_preapproval_id, valorMensal)
        : null;

      if (novaPreapprovalId) {
        await supabaseAdmin
          .from('profiles')
          .update({
            assinatura_plano: 'mensal',
            mp_preapproval_id: novaPreapprovalId,
            assinatura_ciclo_inicio: agora.toISOString(),
            assinatura_expira_em: new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            assinatura_renovacao_notificada_em: null,
          })
          .eq('id', perfil.id);
        resultado.renovadosAutomaticamente++;
      } else {
        await enviarAvisoRenovacao(perfil.email, perfil.nome, perfil.assinatura_plano, valorMensal);
        await enviarPush(
          supabaseAdmin,
          perfil.id,
          'Confirme sua assinatura',
          `Seu ciclo ${perfil.assinatura_plano} terminou. Confirme a renovação mensal com desconto.`,
        );
        // Carência conta a partir do fim do ciclo já pago, não de agora —
        // mesma lógica de "carência não é sequestro de dado" da migration
        // 0025, só que aplicada ao fim do semestre/ano em vez de ao mês.
        const fimCarencia = new Date(new Date(perfil.assinatura_expira_em).getTime() + CARENCIA_DIAS * 24 * 60 * 60 * 1000);
        await supabaseAdmin
          .from('profiles')
          .update({
            assinatura_renovacao_notificada_em: agora.toISOString(),
            assinatura_expira_em: fimCarencia.toISOString(),
          })
          .eq('id', perfil.id);
        resultado.avisados++;
      }
    }

    // 2) Quem já foi avisado e a carência de 5 dias esgotou sem confirmar
    // (o webhook do Mercado Pago já teria zerado assinatura_renovacao_notificada_em
    // se a pessoa tivesse confirmado a tempo) — aí sim vira inadimplente.
    const { data: carenciaEsgotada, error: erroCarencia } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .not('assinatura_renovacao_notificada_em', 'is', null)
      .eq('assinatura_status', 'ativa')
      .lte('assinatura_expira_em', agora.toISOString());
    if (erroCarencia) throw erroCarencia;

    if ((carenciaEsgotada || []).length > 0) {
      await supabaseAdmin
        .from('profiles')
        .update({ assinatura_status: 'inadimplente' })
        .in('id', carenciaEsgotada!.map((p) => p.id));
      resultado.suspensosPorCarenciaEsgotada = carenciaEsgotada!.length;
    }

    return json({ ok: true, ...resultado });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err), ...resultado }, 500);
  }
});
