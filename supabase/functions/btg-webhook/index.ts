// Edge Function: btg-webhook
//
// Ponto único de chegada dos eventos do BTG. Atende duas coisas:
//
//   • recarga de créditos de IA — `instant-collections.paid`
//   • assinatura por Pix Automático — `automatic-pix.*`
//
// É o que fecha os dois ciclos: sem isto, a pessoa paga e nada muda.
//
// A jornada 3 do Pix Automático complica um detalhe que vale dizer alto: o
// PRIMEIRO pagamento não chega como evento de recorrência, e sim como
// `instant-collections.paid`, igual a uma cobrança Pix comum. Por isso o
// ramo de pagamento imediato procura em DUAS tabelas antes de desistir.
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

    if (String(tipo).startsWith('automatic-pix.')) {
      return await tratarPixAutomatico(String(tipo), dados);
    }

    // O console do BTG lista o evento como `instant-collections.paid`, no
    // plural; a ficha técnica escreve `instant-collection.paid`, no
    // singular. Aceitar as duas grafias custa nada e evita o pior tipo de
    // falha aqui: o Pix cai, o webhook chega, e o crédito não entra porque
    // uma letra não bateu.
    const ehPagamento = /instant-collections?\.paid/.test(String(tipo));
    if (!ehPagamento) {
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
      // Pode ser o primeiro pagamento de uma assinatura (jornada 3), que
      // chega com este mesmo tipo de evento.
      const ativada = await ativarPelaPrimeiraParcela(db, txId, dados);
      if (ativada) return json({ ok: true, assinaturaAtivada: true });
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

type Db = ReturnType<typeof admin>;

/** Fim do ciclo pago, a partir do plano. */
function fimDoCiclo(plano: string): string {
  const meses = plano === 'anual' ? 12 : plano === 'semestral' ? 6 : 1;
  const d = new Date();
  const dia = d.getDate();
  d.setMonth(d.getMonth() + meses);
  if (d.getDate() < dia) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/** Libera o acesso e registra o pagamento do ciclo. */
async function darAcesso(
  db: Db,
  assinatura: { id: string; user_id: string; plano: string },
  referencia: string,
  valor: number,
  pagoEm: string,
  parcela: number | null,
) {
  const expira = fimDoCiclo(assinatura.plano);

  // O unique (assinatura_id, referencia) é o que impede o reenvio do mesmo
  // evento virar dois ciclos de acesso. Conflito aqui não é erro: é o BTG
  // repetindo o aviso porque não recebeu 200 a tempo.
  const { error } = await db.from('pagamentos_assinatura').insert({
    assinatura_id: assinatura.id,
    user_id: assinatura.user_id,
    referencia,
    valor_brl: valor,
    pago_em: pagoEm,
    parcela,
  });
  if (error) {
    if (String(error.code) === '23505') return false;
    throw error;
  }

  await db.from('assinaturas_btg').update({
    status: 'ativa',
    ativada_em: new Date().toISOString(),
    proximo_ciclo_em: expira,
  }).eq('id', assinatura.id);

  await db.from('profiles').update({
    assinatura_status: 'ativa',
    assinatura_plano: assinatura.plano,
    assinatura_expira_em: expira,
  }).eq('id', assinatura.user_id);

  return true;
}

/**
 * Primeiro pagamento da jornada 3.
 *
 * Chega como `instant-collections.paid`, com o txId que a criação da
 * autorização devolveu em `activation.txId`. Devolve false quando o txId
 * não é de assinatura nenhuma — aí quem chamou segue tratando como recarga
 * desconhecida.
 */
async function ativarPelaPrimeiraParcela(db: Db, txId: string, dados: Record<string, unknown>) {
  const { data: assinatura } = await db
    .from('assinaturas_btg')
    .select('id, user_id, plano, valor_cobrado_brl, status')
    .eq('tx_id_primeiro', txId)
    .maybeSingle();
  if (!assinatura) return false;

  const pago = Number((dados as any)?.paidAmount ?? assinatura.valor_cobrado_brl);
  const quando = String((dados as any)?.paidAt ?? new Date().toISOString());
  await darAcesso(db, assinatura, `primeira:${txId}`, pago, quando, 1);
  return true;
}

/** Eventos da recorrência. */
async function tratarPixAutomatico(tipo: string, dados: Record<string, unknown>) {
  const db = admin();
  const d = dados as any;

  // `externalId` é nosso, mandado na criação e devolvido em todo evento.
  // Nem todo evento traz — os de agendamento vêm com `authorizationId`.
  const externalId = d?.externalId ?? null;
  const authorizationId = d?.authorizationId ?? null;

  let consulta = db.from('assinaturas_btg')
    .select('id, user_id, plano, valor_cobrado_brl, status');
  consulta = externalId
    ? consulta.eq('external_id', externalId)
    : consulta.eq('authorization_id', authorizationId);
  const { data: assinatura } = await consulta.maybeSingle();

  if (!assinatura) {
    console.error('[btg-webhook] assinatura desconhecida:', tipo, externalId, authorizationId);
    return json({ erro: 'assinatura não encontrada' });
  }

  await db.from('assinaturas_btg')
    .update({ ultimo_evento: d, authorization_id: authorizationId ?? undefined })
    .eq('id', assinatura.id);

  // Só a aprovação e o pagamento mexem no acesso. `authorization-created`
  // é só o aviso de que o QR existe — quem cria já sabia disso.
  if (tipo.endsWith('.scheduling-paid')) {
    const referencia = String(d?.schedulingId ?? d?.paymentTxId ?? crypto.randomUUID());
    const novo = await darAcesso(
      db, assinatura, referencia,
      Number(d?.amountPaid ?? d?.amount ?? assinatura.valor_cobrado_brl),
      String(d?.paidAt ?? new Date().toISOString()),
      Number(d?.installmentNumber ?? 0) || null,
    );
    return json({ ok: true, cicloNovo: novo });
  }

  if (tipo.endsWith('.authorization-rejected')) {
    // Recusa do agendamento não derruba o acesso já pago: o ciclo corrente
    // continua valendo até a data que ficou registrada. O que muda é que o
    // próximo não vem — e `assinatura-processar-ciclo` avisa a tempo.
    await db.from('assinaturas_btg')
      .update({ status: 'recusada' }).eq('id', assinatura.id);
    return json({ ok: true, status: 'recusada' });
  }

  if (tipo.endsWith('.cancelled') || tipo.endsWith('.canceled')) {
    await db.from('assinaturas_btg').update({
      status: 'cancelada',
      cancelada_em: new Date().toISOString(),
    }).eq('id', assinatura.id);
    return json({ ok: true, status: 'cancelada' });
  }

  return json({ ok: true, registrado: tipo });
}
