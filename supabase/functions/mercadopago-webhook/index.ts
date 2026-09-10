// Edge Function: mercadopago-webhook
//
// Pública (verify_jwt = false em supabase/config.toml) — quem chama é o
// Mercado Pago, sem JWT de usuário. A autenticidade vem da assinatura HMAC
// no header `x-signature`, validada com MERCADOPAGO_WEBHOOK_SECRET. Um
// endpoint público que ativa assinatura sem validar origem é um endpoint
// que qualquer pessoa usa pra se dar acesso vitalício: a validação vem
// antes de tudo, e falha fecha (401), não abre.
//
// ── Como um pagamento vira acesso ──────────────────────────────────────
//
// Uma regra só, sem exceção: o pagamento só é aplicado se disser de QUEM
// é, no `external_reference` que nós mesmos gravamos ao criar o checkout
// (`assinatura:<plano>:<userId>`). Como o checkout só nasce de uma sessão
// autenticada, todo pagamento legítimo carrega esse campo.
//
// O que NÃO existe mais aqui: casar o pagamento com uma conta pelo e-mail
// do pagador. Parecia inofensivo e era a maior brecha do sistema — o
// e-mail da conta do Mercado Pago quase nunca é o do cadastro, e quando
// não batia o pagamento ficava solto; se batesse por acaso, liberava a
// conta errada. Pagamento sem referência agora vai pra
// `pagamentos_nao_identificados`, pra conferência humana. Melhor um
// pagamento parado esperando alguém olhar do que acesso dado a quem não
// pagou — ou negado a quem pagou.
//
// ── Os três eventos que importam ───────────────────────────────────────
//
//  subscription_preapproval        — a assinatura foi autorizada, pausada
//                                    ou cancelada. É a que libera acesso.
//  subscription_authorized_payment — cada cobrança da recorrência (a
//                                    renovação). Traz o id da COBRANÇA,
//                                    não o da assinatura: buscar
//                                    `/preapproval/{id}` com ele dá 404.
//                                    Era o bug que só apareceria na
//                                    primeira renovação de um cliente
//                                    real — o acesso não seria estendido,
//                                    e a conta cairia sozinha depois de a
//                                    pessoa ter pago.
//  payment                         — recarga avulsa de créditos de IA. As
//                                    cobranças da assinatura também
//                                    chegam por aqui (`recurring_payment`)
//                                    e são ignoradas de propósito: quem
//                                    manda no ciclo é a preapproval.
//
// Notificação perdida não é hipótese: se o Mercado Pago não conseguir
// entregar nenhuma destas, quem conserta é a conferência diária em
// assinatura-processar-ciclo, que lê a mesma preapproval pelo mesmo
// módulo compartilhado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MP_API,
  parseReferenciaAssinatura,
  aplicarAssinaturaPorId,
  registrarNaoIdentificado,
  sincronizarPreapproval,
} from '../_shared/assinaturaMercadoPago.ts';
import { atualizarQuemIndicou } from '../_shared/indicacoes.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;
const MP_WEBHOOK_SECRET = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')!;

const GRACA_INADIMPLENCIA_DIAS = 7;

// Só converte o valor pago (BRL) no saldo interno (US$) da recarga avulsa
// de créditos. O brinde da assinatura NÃO usa isto — ele tem valor
// próprio, em _shared/creditoDoPlano.ts.
const TAXA_REFERENCIA_USD_BRL = 5.08;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Algoritmo oficial do Mercado Pago: manifest
// "id:{data.id};request-id:{x-request-id};ts:{ts};", HMAC-SHA256 com o
// secret, comparado (hex) com o v1 do header x-signature.
async function validarAssinatura(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  const dataId = (url.searchParams.get('data.id') || url.searchParams.get('id') || '').toLowerCase();
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  if (!xSignature || !xRequestId || !dataId) return false;

  const partes: Record<string, string> = {};
  for (const parte of xSignature.split(',')) {
    const [chave, valor] = parte.split('=');
    if (chave && valor) partes[chave.trim()] = valor.trim();
  }
  const ts = partes.ts;
  const v1Recebido = partes.v1;
  if (!ts || !v1Recebido) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinaturaCalculada = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const v1Calculado = hexEncode(new Uint8Array(assinaturaCalculada));

  return v1Calculado === v1Recebido;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const assinaturaValida = await validarAssinatura(req).catch(() => false);
  if (!assinaturaValida) {
    console.error('mercadopago-webhook: assinatura inválida ou ausente.', {
      url: req.url,
      temXSignature: !!req.headers.get('x-signature'),
    });
    return json({ error: 'Assinatura inválida.' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const notificacaoId = String(body?.id ?? '');
    // Formatos antigos (IPN) mandam `topic`/`id` só na query string, sem
    // corpo JSON — cobre os dois.
    const tipo = String(
      body?.type ?? body?.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '',
    );
    const recursoId = body?.data?.id
      ? String(body.data.id)
      : (url.searchParams.get('data.id') || url.searchParams.get('id') || null);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Idempotência — o Mercado Pago reenvia a mesma notificação quando não
    // recebe 200 rápido o bastante, ou por retry de rede.
    if (notificacaoId) {
      const { data: jaProcessado } = await supabaseAdmin
        .from('mercadopago_eventos_processados')
        .select('id')
        .eq('id', notificacaoId)
        .maybeSingle();
      if (jaProcessado) return json({ ok: true, duplicado: true });
    }

    if (!recursoId) {
      // Evento sem recurso associado (ex: teste do painel) — só confirma.
      return json({ ok: true });
    }

    const marcarProcessado = async () => {
      if (notificacaoId) {
        await supabaseAdmin.from('mercadopago_eventos_processados').insert({ id: notificacaoId, tipo });
      }
    };

    // ── 1. Cobrança da recorrência (a renovação) ────────────────────────
    // Precisa vir ANTES dos outros dois: o nome do evento contém tanto
    // "payment" quanto "subscription", e o id que ele traz não é nem de um
    // pagamento comum nem de uma preapproval — é de um authorized_payment,
    // que carrega o `preapproval_id` de que precisamos.
    if (tipo.includes('authorized_payment')) {
      const resp = await fetch(`${MP_API}/authorized_payments/${recursoId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      if (!resp.ok) return json({ error: `Erro ao buscar cobrança da assinatura (${resp.status}).` }, 502);
      const cobranca = await resp.json();
      const preapprovalId = String(cobranca?.preapproval_id || '');
      if (!preapprovalId) return json({ ok: true, semPreapproval: true });

      const statusCobranca = String(cobranca?.status || '');
      if (['rejected', 'cancelled'].includes(statusCobranca)) {
        // Cartão recusado numa renovação. Carência antes de cortar: uma
        // recusa boba não derruba o atendimento de ninguém no meio da
        // semana. A preapproval segue viva no Mercado Pago, que tenta de
        // novo — e a próxima tentativa bem-sucedida devolve pra 'ativa'.
        const resposta = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
          headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        });
        const preapproval = resposta.ok ? await resposta.json() : null;
        const referencia = parseReferenciaAssinatura(String(preapproval?.external_reference || ''));
        if (referencia) {
          const { data: perfil } = await supabaseAdmin
            .from('profiles')
            .select('assinatura_expira_em')
            .eq('id', referencia.userId)
            .maybeSingle();
          const base = perfil?.assinatura_expira_em ? new Date(perfil.assinatura_expira_em) : new Date();
          const comCarencia = new Date(base.getTime() + GRACA_INADIMPLENCIA_DIAS * 86400000);
          await aplicarAssinaturaPorId(supabaseAdmin, referencia.userId, {
            assinatura_status: 'inadimplente',
            assinatura_expira_em: comCarencia.toISOString(),
            mp_preapproval_id: preapprovalId,
          });
        }
        await marcarProcessado();
        return json({ ok: true, cobranca: 'recusada' });
      }

      const resultado = await sincronizarPreapproval(supabaseAdmin, MP_ACCESS_TOKEN, preapprovalId, tipo);
      if (!resultado.ok) return json({ error: resultado.erro }, 502);
      // Esta conta acabou de mudar de estado: quem a indicou pode ter
      // ganhado ou perdido 10%.
      if (resultado.userId) await atualizarQuemIndicou(supabaseAdmin, MP_ACCESS_TOKEN, resultado.userId);
      await marcarProcessado();
      return json({ ok: true, ...resultado });
    }

    // ── 2. A assinatura em si (autorizada, pausada, cancelada) ──────────
    if (tipo.includes('preapproval') || tipo.includes('subscription')) {
      const resultado = await sincronizarPreapproval(supabaseAdmin, MP_ACCESS_TOKEN, recursoId, tipo);
      if (!resultado.ok) return json({ error: resultado.erro }, 502);
      if (resultado.userId) await atualizarQuemIndicou(supabaseAdmin, MP_ACCESS_TOKEN, resultado.userId);
      await marcarProcessado();
      return json({ ok: true, ...resultado });
    }

    // ── 3. Pagamento avulso — recarga de créditos de IA ─────────────────
    if (tipo.includes('payment')) {
      const resp = await fetch(`${MP_API}/v1/payments/${recursoId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      if (!resp.ok) return json({ error: `Erro ao buscar pagamento (${resp.status}).` }, 502);
      const pagamento = await resp.json();
      const referencia = String(pagamento?.external_reference || '');

      // Cobrança gerada por uma assinatura: quem manda no ciclo é a
      // preapproval (casos 1 e 2). Aplicar aqui de novo sobrescreveria a
      // validade com um ciclo errado.
      if (pagamento.operation_type === 'recurring_payment' || referencia.startsWith('assinatura:')) {
        await marcarProcessado();
        return json({ ok: true, ignoradoPorSerDaAssinatura: true });
      }

      if (referencia.startsWith('creditos:')) {
        const userIdCreditos = referencia.slice('creditos:'.length);
        if (pagamento.status === 'approved' && userIdCreditos) {
          const { data: perfil } = await supabaseAdmin
            .from('profiles')
            .select('creditos_ia')
            .eq('id', userIdCreditos)
            .maybeSingle();
          if (perfil) {
            const creditoUsd = (Number(pagamento.transaction_amount) || 0) / TAXA_REFERENCIA_USD_BRL;
            await supabaseAdmin
              .from('profiles')
              .update({ creditos_ia: Number(perfil.creditos_ia) + creditoUsd })
              .eq('id', userIdCreditos);
            await supabaseAdmin.from('uso_ia').insert({
              user_id: userIdCreditos,
              tipo: 'recarga_avulsa',
              provedor: 'sistema',
              modelo: 'creditos_mercadopago',
              unidades: null,
              custo_estimado: -creditoUsd,
            });
          } else {
            await registrarNaoIdentificado(supabaseAdmin, {
              mp_id: recursoId,
              tipo,
              valor: Number(pagamento.transaction_amount) || null,
              status: pagamento.status ?? null,
              email_pagador: pagamento?.payer?.email ?? null,
              motivo: `recarga de créditos para uma conta que não existe (${userIdCreditos})`,
            });
          }
        }
        await marcarProcessado();
        return json({ ok: true, recargaCreditos: true });
      }

      // Dinheiro que chegou sem dizer de quem é. Não se adivinha: registra,
      // e alguém confere.
      if (pagamento.status === 'approved') {
        await registrarNaoIdentificado(supabaseAdmin, {
          mp_id: recursoId,
          tipo,
          valor: Number(pagamento.transaction_amount) || null,
          status: pagamento.status ?? null,
          email_pagador: pagamento?.payer?.email ?? null,
          motivo: 'pagamento aprovado sem external_reference reconhecido',
        });
      }
      await marcarProcessado();
      return json({ ok: true, semReferencia: true });
    }

    // merchant_order, chargebacks e o resto — não dizem respeito à
    // assinatura, só confirma o recebimento.
    await marcarProcessado();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
