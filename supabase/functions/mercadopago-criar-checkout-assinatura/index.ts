// Edge Function: mercadopago-criar-checkout-assinatura
//
// Gera a assinatura dos três planos. Os três são ASSINATURA de verdade
// (`preapproval` do Mercado Pago): renovam sozinhos até a pessoa cancelar,
// só mudando de quanto em quanto tempo a cobrança acontece — 1, 6 ou 12
// meses. Verificado contra a API: `auto_recurring.frequency` aceita 6 e 12
// com `frequency_type: 'months'` (HTTP 201 nos três).
//
// Antes, só o mensal era assinatura; semestral e anual eram pagamento
// ÚNICO via checkout/preferences. Isso vencia caladamente: o acesso caía
// no fim do período e a renovação dependia de a pessoa receber um e-mail,
// lembrar, e pagar de novo na mão. Um plano que expira sozinho não é um
// plano — é uma evasão marcada na agenda.
//
// O efeito colateral é o Pix, e não há como fugir dele no Mercado Pago:
// recorrência lá só existe em cartão. Pix não faz cobrança automática, e a
// única alternativa (Pix Automático) é do BTG, que cobra R$ 200/mês de
// plano PJ — caro demais pra base de hoje.
//
// ── Por que o cartão é cobrado na NOSSA página ─────────────────────────
//
// Mandar a pessoa pro checkout do Mercado Pago tem um efeito que não se
// desliga por parâmetro nenhum: se ela tiver o app do Mercado Pago
// instalado, o Android entrega o link ao app, e lá dentro só existe
// "entrar" ou "criar conta grátis". A opção de pagar sem conta, que a
// versão web oferece, simplesmente some. Quem não quer conta no Mercado
// Pago — que é a maioria de quem só quer assinar um app — ficava sem
// saída.
//
// Com um `card_token_id` gerado no navegador, a assinatura já nasce
// autorizada e ninguém sai da nossa página. O número do cartão não passa
// por aqui nem toca o nosso servidor: os campos são iframes do próprio
// Mercado Pago (SDK v2), e o que chega nesta função é só um token de uso
// único.
//
// `external_reference` = `assinatura:<plano>:<userId>` é o que liga o
// pagamento à conta — nunca o e-mail do pagador.
//
// Chamada por docs/escolher-plano.html (fora do app, sem Authorization
// automático do supabase-js — o token vai manual no header).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sincronizarPreapproval } from '../_shared/assinaturaMercadoPago.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
// Pública por definição — vai dentro da página, à vista de todos. Fica num
// secret só pra poder ser trocada sem mexer no HTML.
const MP_PUBLIC_KEY = Deno.env.get('MERCADOPAGO_PUBLIC_KEY') || '';

const MP_API = 'https://api.mercadopago.com';
const CONFIRMACAO_URL = 'https://app.drsig.com.br/assinatura-confirmada.html';

type Plano = 'mensal' | 'semestral' | 'anual';

// Preço e ritmo de cada plano, num lugar só. `mesesPorCobranca` é o que vai
// pro `auto_recurring.frequency`; `precoBRL` é o valor de CADA cobrança —
// não o mensal equivalente (esse é só pra exibir, e vive no webhook).
const PLANOS: Record<Plano, { precoBRL: number; mesesPorCobranca: number; nome: string }> = {
  mensal: { precoBRL: 89, mesesPorCobranca: 1, nome: 'Mensal' },
  semestral: { precoBRL: 414, mesesPorCobranca: 6, nome: 'Semestral' },
  anual: { precoBRL: 588, mesesPorCobranca: 12, nome: 'Anual' },
};

// Esta função é chamada de uma PÁGINA (docs/escolher-plano.html), não do
// app — e página é navegador, e navegador exige CORS. Sem isto, o clique
// em "Assinar" nem chega aqui: o browser manda um OPTIONS antes (porque a
// requisição leva Authorization e Content-Type), leva 405, e cancela o
// POST. O botão nunca funcionou num navegador, e o erro aparecia como
// falha genérica de rede — o servidor, por curl, respondia 200 o tempo
// todo, que foi o que escondeu isso.
//
// `*` como origem é seguro aqui porque quem autoriza é o JWT do usuário no
// header, não um cookie de sessão: um site de terceiros não tem como
// obtê-lo, e sem ele esta função devolve 401.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Traduz a recusa do Mercado Pago para algo acionável.
 *
 * O que a API devolve ("cc_rejected_bad_filled_security_code") não é texto
 * pra ninguém ler. E o genérico "não foi possível processar" faz a pessoa
 * tentar o mesmo cartão de novo, com o mesmo resultado — o que ela precisa
 * saber é se corrige um dígito, se liga pro banco, ou se troca de cartão.
 */
// deno-lint-ignore no-explicit-any
function mensagemDeRecusa(corpo: any): string {
  const causa = String(
    corpo?.cause?.[0]?.code ?? corpo?.status_detail ?? corpo?.error ?? '',
  );
  const mapa: Record<string, string> = {
    cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
    cc_rejected_bad_filled_date: 'Confira a validade do cartão.',
    cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV).',
    cc_rejected_bad_filled_other: 'Algum dado do cartão não confere. Confira e tente de novo.',
    cc_rejected_insufficient_amount: 'O cartão não tem limite disponível para este valor.',
    cc_rejected_high_risk: 'O banco não autorizou esta cobrança. Tente outro cartão, ou fale com o banco.',
    cc_rejected_call_for_authorize: 'O banco pediu que você autorize esta cobrança. Ligue para o banco e tente de novo.',
    cc_rejected_card_disabled: 'O cartão está desativado. Fale com o banco ou use outro.',
    cc_rejected_duplicated_payment: 'Esta cobrança já foi feita. Confira antes de tentar de novo.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Espere um pouco ou use outro.',
    cc_rejected_other_reason: 'O banco não autorizou. Tente outro cartão.',
    cc_rejected_card_type_not_allowed: 'Este tipo de cartão não é aceito. Use um cartão de crédito.',
  };
  if (mapa[causa]) return mapa[causa];
  if (causa.includes('card_token')) {
    return 'Os dados do cartão expiraram nesta página. Preencha de novo.';
  }
  return 'Não foi possível autorizar o cartão. Confira os dados ou tente outro cartão.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Sessão inválida ou expirada.' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));

    // A página pergunta primeiro se dá pra cobrar o cartão ali mesmo. Sem a
    // chave configurada, a resposta é `null` e ela cai no caminho antigo,
    // de mandar pro Mercado Pago — em vez de mostrar um formulário morto.
    if (body?.acao === 'chave') {
      return json({ publicKey: MP_PUBLIC_KEY || null });
    }

    const plano = String(body?.plano || '') as Plano;
    const config = PLANOS[plano];
    if (!config) return json({ error: 'Plano inválido.' }, 400);

    // `payer_email` é obrigatório numa assinatura do Mercado Pago (sem ele:
    // 400, "payer_email is required"). Usamos sempre o e-mail do cadastro,
    // e isso deixou de ser problema quando o cartão passou a ser cobrado
    // aqui: como ninguém entra numa conta do Mercado Pago, não existe
    // e-mail que precise "coincidir" — o erro que derrubou o teste real.
    const payerEmail = userData.user.email;
    if (!payerEmail) return json({ error: 'Conta sem e-mail associado.' }, 400);

    const externalReference = `assinatura:${plano}:${userId}`;
    const autoRecurring = {
      frequency: config.mesesPorCobranca,
      frequency_type: 'months',
      transaction_amount: config.precoBRL,
      currency_id: 'BRL',
    };

    const cardTokenId = String(body?.cardTokenId || '').trim();

    // ─── Caminho principal: cartão digitado na nossa página ─────────────
    if (cardTokenId) {
      const resp = await fetch(`${MP_API}/preapproval`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: `Dr.Sig — Plano ${config.nome}`,
          auto_recurring: autoRecurring,
          payer_email: payerEmail,
          card_token_id: cardTokenId,
          external_reference: externalReference,
          back_url: CONFIRMACAO_URL,
          status: 'authorized',
        }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error('mercadopago-criar-checkout-assinatura: recusa do cartão.', {
          http: resp.status,
          corpo,
        });
        return json({ error: mensagemDeRecusa(corpo) }, 400);
      }
      // Libera o acesso agora, sem esperar o webhook.
      //
      // O webhook continua sendo o dono da regra — é ele que trata
      // renovação, recusa e cancelamento — e vai passar por aqui de novo
      // daqui a alguns segundos. Mas "alguns segundos" é otimismo: webhook
      // é entrega de melhor esforço, e a pessoa que ACABOU de pagar está
      // olhando pra tela. Deixar ela abrir o app e encontrar tudo
      // bloqueado, logo depois de passar o cartão, é o pior momento
      // possível pra uma incerteza de rede.
      //
      // Rodar duas vezes é inofensivo: a escrita é a mesma função
      // compartilhada, e o brinde de crédito tem guarda contra repetição.
      if (corpo?.status === 'authorized' && corpo?.id) {
        try {
          const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          await sincronizarPreapproval(admin, MP_ACCESS_TOKEN, String(corpo.id), 'checkout-imediato');
        } catch (err) {
          // Não desfaz nada nem assusta quem pagou: o cartão foi
          // autorizado de verdade, e o webhook (ou a conferência diária)
          // libera em seguida.
          console.error('mercadopago-criar-checkout-assinatura: liberação imediata falhou.', err);
        }
      }
      return json({ assinaturaId: corpo?.id ?? null, status: corpo?.status ?? null, plano });
    }

    // ─── Caminho antigo: manda pro checkout do Mercado Pago ─────────────
    //
    // Só roda enquanto MERCADOPAGO_PUBLIC_KEY não estiver configurada. Sem
    // `preapproval_plan_id` de propósito: com ele o Mercado Pago exige
    // `card_token_id`, que só nasce no navegador. `status: 'pending'` deixa
    // explícito que nada é cobrado até a pessoa autorizar lá.
    const resp = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: `Dr.Sig — Plano ${config.nome}`,
        auto_recurring: autoRecurring,
        payer_email: payerEmail,
        external_reference: externalReference,
        back_url: CONFIRMACAO_URL,
        status: 'pending',
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return json({ error: `Erro ao criar assinatura no Mercado Pago (${resp.status}): ${errBody}` }, 502);
    }
    const preapproval = await resp.json();
    return json({ initPoint: preapproval.init_point });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
