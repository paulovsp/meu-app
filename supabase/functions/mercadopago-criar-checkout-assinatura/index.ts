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
import { aplicarDescontoDeIndicacoes, precoComDesconto } from '../_shared/indicacoes.ts';
import { mensagemDeRecusa } from '../_shared/recusaMercadoPago.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

Deno.serve(servir('mercadopago-criar-checkout-assinatura', async (req) => {
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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // O estado atual da conta decide duas coisas: o que a página mostra
    // ao abrir, e se esta função aceita criar OUTRA assinatura.
    //
    // Sem esta leitura, quem já assinava e abria a página de novo (o link
    // do e-mail vale para qualquer conta, e a sessão fica guardada por
    // uma hora) criava uma segunda recorrência. O webhook gravava o id da
    // nova por cima do da antiga — que sumia do perfil e continuava
    // cobrando o cartão todo mês, sem botão para cancelar.
    const { data: perfil } = await admin
      .from('profiles')
      .select('assinatura_status, assinatura_plano, assinatura_expira_em, mp_preapproval_id, conta_demonstracao')
      .eq('id', userId)
      .maybeSingle();
    const renovaSozinha = perfil?.assinatura_status === 'ativa' && !!perfil?.mp_preapproval_id;
    const gratuitaPorIndicacoes = perfil?.assinatura_status === 'gratuita_indicacao';

    // A página pergunta primeiro se dá pra cobrar o cartão ali mesmo. Sem a
    // chave configurada, a resposta é `null` e ela cai no caminho antigo,
    // de mandar pro Mercado Pago — em vez de mostrar um formulário morto.
    if (body?.acao === 'chave') {
      return json({
        publicKey: MP_PUBLIC_KEY || null,
        situacao: {
          status: perfil?.assinatura_status || 'sem_assinatura',
          plano: perfil?.assinatura_plano || null,
          expiraEm: perfil?.assinatura_expira_em || null,
          renovaSozinha,
          gratuitaPorIndicacoes,
        },
      });
    }

    const plano = String(body?.plano || '') as Plano;
    const config = PLANOS[plano];
    if (!config) return json({ error: 'Plano inválido.' }, 400);

    if (perfil?.conta_demonstracao) {
      return json({ error: 'A conta de demonstração não assina planos. Crie a sua conta no app.' }, 403);
    }
    if (renovaSozinha) {
      const atual = PLANOS[perfil!.assinatura_plano as Plano]?.nome || perfil!.assinatura_plano;
      return json({
        error: `Esta conta já tem o plano ${atual} ativo, renovando sozinho. Para trocar de plano, cancele o atual no app (Meu Perfil › Seu plano) e assine de novo — o acesso continua até o fim do período já pago.`,
        jaAssina: true,
      }, 409);
    }
    if (gratuitaPorIndicacoes) {
      return json({
        error: 'Seu acesso é gratuito pelas suas indicações — não há o que assinar. Se o número de indicações ativas cair, o app avisa com antecedência.',
        jaAssina: true,
      }, 409);
    }

    // `payer_email` é obrigatório numa assinatura do Mercado Pago (sem ele:
    // 400, "payer_email is required"). Usamos sempre o e-mail do cadastro,
    // e isso deixou de ser problema quando o cartão passou a ser cobrado
    // aqui: como ninguém entra numa conta do Mercado Pago, não existe
    // e-mail que precise "coincidir" — o erro que derrubou o teste real.
    const payerEmail = userData.user.email;
    if (!payerEmail) return json({ error: 'Conta sem e-mail associado.' }, 400);

    const externalReference = `assinatura:${plano}:${userId}`;

    // O desconto por indicacoes entra JA na primeira cobranca. Sem isto,
    // quem indicou dez pessoas antes de assinar pagaria o preco cheio no
    // primeiro ciclo e so veria o desconto no segundo — punido por ter
    // feito as coisas na ordem "errada".
    const { data: descontoBruto } = await admin.rpc('desconto_por_indicacoes', { uid: userId });
    // Teto de 90% aqui: 100% nao e uma assinatura barata, e assinatura
    // nenhuma (o Mercado Pago recusa qualquer valor abaixo de R$ 0,50).
    // Quem tem direito a 100% e liberado logo depois, por
    // aplicarDescontoDeIndicacoes, que cancela a assinatura recem-criada e
    // poe a conta em `gratuita_indicacao`.
    const desconto = Math.min(Number(descontoBruto) || 0, 90);

    const autoRecurring = {
      frequency: config.mesesPorCobranca,
      frequency_type: 'months',
      transaction_amount: precoComDesconto(plano, desconto),
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
          await sincronizarPreapproval(admin, MP_ACCESS_TOKEN, String(corpo.id), 'checkout-imediato');
          // Fecha o caso dos 100%: a assinatura acabou de nascer com 90%
          // de desconto e aqui ela e cancelada, virando acesso gratuito.
          await aplicarDescontoDeIndicacoes(admin, MP_ACCESS_TOKEN, userId);
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
}));
