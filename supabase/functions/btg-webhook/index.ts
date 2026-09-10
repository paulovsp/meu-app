// Edge Function: btg-webhook
//
// Recebe `instant-collection.paid` do BTG e credita a recarga. É o que
// fecha o ciclo: sem isto, a pessoa paga e o saldo não muda.
//
// Roda com --no-verify-jwt (quem chama é o BTG, sem sessão do app). Quem
// prova a identidade do pagamento é o `txId`: ele foi gerado pelo BTG na
// criação da cobrança e guardado em `recargas_credito` naquele momento. Um
// txId que não esteja lá não credita nada.
import { admin } from '../_shared/btg.ts';

// Mesma taxa de creditosIA.js e renovar-creditos: o saldo interno é em
// dólar, a recarga é em real.
const TAXA_REFERENCIA_USD_BRL = 5.08;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // O BTG valida o endpoint antes de ativar o webhook; um GET tem que
  // responder 200 ou o cadastro é recusado.
  if (req.method === 'GET') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  // Sempre 200 pro BTG não reenviar em laço: falha de processamento vira
  // log, não erro de entrega. Mesmo espírito do whatsapp-webhook.
  try {
    const evento = await req.json().catch(() => null);
    const tipo = evento?.type ?? evento?.event ?? '';
    const dados = evento?.data ?? evento;

    if (!String(tipo).includes('instant-collection.paid')) {
      return json({ ignorado: tipo || 'sem tipo' });
    }

    const txId = dados?.txId ?? dados?.txid;
    if (!txId) return json({ erro: 'evento sem txId' });

    const db = admin();
    const { data: recarga } = await db
      .from('recargas_credito')
      .select('id, user_id, valor_brl, credito_brl, status')
      .eq('tx_id', txId)
      .maybeSingle();

    if (!recarga) {
      console.error('[btg-webhook] txId desconhecido:', txId);
      return json({ erro: 'recarga não encontrada' });
    }
    // O BTG reenvia o evento quando não recebe 200 a tempo. Sem esta
    // guarda, um reenvio creditaria de novo o mesmo pagamento.
    if (recarga.status === 'paga') return json({ ok: true, jaCreditada: true });

    // Pagou menos do que a cobrança pedia? Credita proporcional, não o
    // pacote inteiro. `allowCustomerChangeValue: false` deveria impedir,
    // mas confiar numa flag do outro lado pra decidir quanto dinheiro
    // entregar é confiar demais.
    const pago = Number(dados?.paidAmount ?? dados?.amount?.value ?? recarga.valor_brl);
    const proporcao = Math.min(1, pago / Number(recarga.valor_brl));
    const creditoBRL = Number(recarga.credito_brl) * proporcao;
    const creditoUsd = creditoBRL / TAXA_REFERENCIA_USD_BRL;

    const { data: perfil } = await db
      .from('profiles').select('creditos_ia').eq('id', recarga.user_id).single();

    await db.from('profiles')
      .update({ creditos_ia: Number(perfil?.creditos_ia ?? 0) + creditoUsd })
      .eq('id', recarga.user_id);

    await db.from('recargas_credito').update({
      status: 'paga',
      pago_em: dados?.paidAt ?? new Date().toISOString(),
      valor_pago_brl: pago,
    }).eq('id', recarga.id);

    // Entrada negativa: o extrato de uso soma consumo, e a recarga é o
    // contrário disso. Falhar aqui não pode desfazer o crédito já aplicado
    // — o dinheiro entrou, o registro contábil é secundário.
    await db.from('uso_ia').insert({
      user_id: recarga.user_id,
      tipo: 'recarga_avulsa',
      provedor: 'btg',
      modelo: 'pix_cobranca',
      unidades: 1,
      custo_estimado: -creditoUsd,
    }).then(() => {}, () => {});

    return json({ ok: true, creditadoBRL: creditoBRL });
  } catch (err) {
    console.error('[btg-webhook] falha:', (err as Error)?.message || err);
    return json({ erro: 'falha ao processar' });
  }
});
