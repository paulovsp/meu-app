// Edge Function: btg-criar-assinatura
//
// Cria a assinatura do plano como Pix Automático (jornada 3): a pessoa
// autoriza uma vez no app do banco dela, o primeiro pagamento sai na hora
// por QR code, e os seguintes saem sozinhos no intervalo do plano.
//
// Por que não Pix de cobrança única renovado por lembrete: obrigaria a
// pagar ativamente todo ciclo, e isso derruba retenção. O Pix Automático
// tem inclusive política de retentativa própria do BTG (ACCEPT_3R_7D — três
// tentativas em sete dias quando falta saldo), que é justamente o que
// segura a assinatura quando a conta está vazia no dia do vencimento.
//
// A jornada 3 dispara DOIS eventos diferentes, e o webhook trata os dois:
// o pagamento imediato chega como `instant-collections.paid` (igual a uma
// cobrança Pix comum) e cada recorrência como `automatic-pix.scheduling-paid`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  chamarBtg, tokenValido, admin, criarLinkDeCartao, contaDaEmpresa,
  comAcrescimoDeCartao, ACRESCIMO_CARTAO,
} from '../_shared/btg.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PIX_KEY = Deno.env.get('BTG_PIX_KEY')!;

// Confirmado na referência oficial. Note o `/flow` no fim e o singular em
// `authorization`: é a rota da jornada, não um CRUD de autorizações.
const CAMINHO_AUTORIZACAO = '/banking/collections/automatic-pix/authorization/flow';

// A primeira cobrança da recorrência não pode ser hoje: o BTG exige pelo
// menos 3 dias de intervalo. Quem cobra na hora é o `immediatePix` — é essa
// a divisão de trabalho da jornada 3.
const DIAS_MINIMOS_ATE_A_PRIMEIRA = 3;

// Espelha PLANOS de src/services/planos.js. O valor NUNCA vem do cliente:
// bastaria editar a requisição pra assinar o anual por um real.
// `periodo` usa o enum do BTG: ANNUALLY, MONTHLY, QUARTERLY, SEMIANNUAL,
// WEEKLY. Não é ANNUAL.
const PLANOS: Record<string, { valorBRL: number; meses: number; periodo: string }> = {
  mensal: { valorBRL: 89, meses: 1, periodo: 'MONTHLY' },
  semestral: { valorBRL: 414, meses: 6, periodo: 'SEMIANNUAL' },
  anual: { valorBRL: 588, meses: 12, periodo: 'ANNUALLY' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function soDigitos(v: unknown) {
  return String(v ?? '').replace(/\D/g, '');
}

/** AAAA-MM-DD somando meses, sem estourar em fim de mês. */
function emMeses(meses: number, base = new Date()): string {
  const d = new Date(base);
  const dia = d.getDate();
  d.setMonth(d.getMonth() + meses);
  if (d.getDate() < dia) d.setDate(0); // 31/01 + 1 mês vira 28/02, não 03/03
  return d.toISOString().slice(0, 10);
}

function emDias(dias: number): Date {
  return new Date(Date.now() + dias * 86400_000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const comoUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await comoUsuario.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const corpo = await req.json().catch(() => ({}));
    const plano = String(corpo?.plano ?? '');
    const config = PLANOS[plano];
    if (!config) return json({ error: 'Plano inválido.' }, 400);

    // 'pix' é recorrente de verdade; 'cartao' é um link por ciclo, com o
    // acréscimo da adquirência repassado — e dito na tela antes da escolha.
    const forma = corpo?.forma === 'cartao' ? 'cartao' : 'pix';

    const db = admin();

    if (forma === 'cartao') {
      const valorComTaxa = comAcrescimoDeCartao(config.valorBRL);
      const { data: linhaCartao, error: erroCartao } = await db
        .from('assinaturas_btg')
        .insert({
          user_id: userId,
          plano,
          forma: 'cartao',
          valor_plano_brl: config.valorBRL,
          valor_cobrado_brl: valorComTaxa,
          taxa_percentual: ACRESCIMO_CARTAO * 100,
        })
        .select().single();
      if (erroCartao) throw erroCartao;

      const link = await criarLinkDeCartao({
        nome: `Dr.Sig ${plano} — ${linhaCartao.external_id}`,
        valorBRL: valorComTaxa,
      });
      if (!link.linkUrl) {
        return json({ error: 'O BTG não devolveu o link de pagamento.' }, 502);
      }
      await db.from('assinaturas_btg').update({
        payment_link_id: link.id,
        link_url: link.linkUrl,
      }).eq('id', linhaCartao.id);

      return json({
        externalId: linhaCartao.external_id,
        forma: 'cartao',
        linkUrl: link.linkUrl,
        valorBRL: valorComTaxa,
        valorPlanoBRL: config.valorBRL,
        plano,
      });
    }

    // O Pix Automático exige identificar o pagador: é o app do banco DELE
    // que vai mostrar a autorização pra aprovar.
    const { data: perfil } = await db
      .from('profiles').select('nome, cpf').eq('id', userId).maybeSingle();
    const cpf = soDigitos(perfil?.cpf);
    if (!perfil?.nome || cpf.length !== 11) {
      return json({
        error: 'Antes de assinar, complete nome e CPF no seu perfil — o banco precisa deles para autorizar a recorrência.',
      }, 400);
    }

    // Reaproveita uma assinatura ainda não autorizada em vez de criar outra
    // a cada toque: senão um duplo-clique deixa duas autorizações abertas no
    // banco da pessoa, e ela aprova as duas sem perceber.
    const { data: aberta } = await db
      .from('assinaturas_btg')
      .select('*')
      .eq('user_id', userId).eq('plano', plano).eq('status', 'aguardando')
      .gt('criado_em', new Date(Date.now() - 30 * 60_000).toISOString())
      .order('criado_em', { ascending: false })
      .limit(1).maybeSingle();
    if (aberta?.emv) {
      return json({
        externalId: aberta.external_id,
        emv: aberta.emv,
        qrCodeUrl: aberta.qr_code_url,
        valorBRL: Number(aberta.valor_cobrado_brl),
        plano,
        reaproveitada: true,
      });
    }

    const { data: linha, error: erroInsert } = await db
      .from('assinaturas_btg')
      .insert({
        user_id: userId,
        plano,
        forma: 'pix_automatico',
        valor_plano_brl: config.valorBRL,
        valor_cobrado_brl: config.valorBRL, // Pix não tem acréscimo
        taxa_percentual: 0,
      })
      .select().single();
    if (erroInsert) throw erroInsert;

    const sessao = await tokenValido();

    const conta = await contaDaEmpresa(sessao);
    if (!conta?.number) {
      return json({ error: 'Não consegui identificar a conta que recebe no BTG.' }, 502);
    }

    // A recorrência começa no primeiro vencimento DEPOIS da carência do
    // BTG; o ciclo de hoje é o `immediatePix`, cobrado na hora.
    const primeira = emDias(DIAS_MINIMOS_ATE_A_PRIMEIRA + 1);
    const inicial = emMeses(config.meses, primeira);

    const autorizacao = await chamarBtg(CAMINHO_AUTORIZACAO, {
      method: 'POST',
      body: JSON.stringify({
        // Nosso identificador, devolvido em todo evento — é o que liga o
        // pagamento à pessoa sem depender de casar e-mail.
        externalId: linha.external_id,
        period: config.periodo,
        // Três tentativas em sete dias antes de desistir do ciclo. É o que
        // segura a assinatura quando a conta está vazia no vencimento.
        retryPolicy: 'ACCEPT_3R_7D',
        amount: config.valorBRL,
        initialDate: inicial,
        // Sem fidelidade: dois anos de horizonte, renovado enquanto a
        // assinatura seguir ativa. `assinatura-processar-ciclo` acompanha.
        finalDate: emMeses(24),
        account: { number: conta.number, branch: conta.branch },
        link: {
          contract: String(linha.external_id),
          description: `Dr.Sig — plano ${plano}`,
          debtor: { taxId: cpf, name: perfil.nome, personType: 'F' },
        },
        // A metade "jornada 3": o pagamento de hoje, por QR code, junto da
        // autorização da recorrência. Uma leitura só resolve as duas.
        immediatePix: {
          pixKey: PIX_KEY,
          amount: config.valorBRL,
          allowCustomerChangeValue: false,
          expiresIn: 3600,
          description: `Dr.Sig — plano ${plano}`,
        },
      }),
    }, sessao, 'banking');

    const emv = autorizacao?.qrCodeInfo?.emv ?? null;
    const qrCodeUrl = autorizacao?.location?.url ?? null;
    const authorizationId = autorizacao?.authorizationId ?? null;
    const txPrimeiro = autorizacao?.activation?.txId ?? null;

    await db.from('assinaturas_btg').update({
      authorization_id: authorizationId,
      tx_id_primeiro: txPrimeiro,
      emv,
      qr_code_url: qrCodeUrl,
      ultimo_evento: autorizacao ?? null,
    }).eq('id', linha.id);

    if (!emv && !qrCodeUrl) {
      return json({ error: 'O BTG criou a autorização mas não devolveu o QR code.' }, 502);
    }

    return json({
      externalId: linha.external_id,
      emv,
      qrCodeUrl,
      valorBRL: config.valorBRL,
      plano,
    });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
