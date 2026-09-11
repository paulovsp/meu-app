// Edge Function: excluir-conta
//
// Apaga permanentemente a conta autenticada. Três coisas, nesta ordem, e
// a ordem é o que importa:
//
//  1. Cancela a assinatura no Mercado Pago. ANTES de apagar, e falhando
//     fechado: se o cancelamento não der certo, a conta NÃO é apagada. A
//     alternativa — apagar mesmo assim — deixava a recorrência viva num
//     cartão cujo dono não tem mais app, nem perfil, nem aviso nenhum: a
//     cobrança do mês seguinte chegava no webhook, não achava a conta e
//     morria em silêncio. Era exatamente o que acontecia até aqui.
//
//  2. Apaga as fotos do Storage. O bucket `avatars` é público (é uma foto
//     de exibição) e `deleteUser` não toca nele: sem este passo, a foto e
//     a capa de uma conta excluída continuavam acessíveis pela URL.
//
//  3. `auth.admin.deleteUser`: todo o resto — profiles, patients e, em
//     cascata, sessions, records, transcript_turns, availability_slots,
//     appointments, pagamentos, relatorios, autorizacoes, uso_ia — cai
//     pelo `on delete cascade` das migrations.
//
// Depois, quem indicou esta conta perde a indicação: o desconto de quem
// a indicou é recalculado, senão ficaria valendo por uma conta que não
// existe.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cancelarPreapproval } from '../_shared/assinaturaMercadoPago.ts';
import { aplicarDescontoDeIndicacoes } from '../_shared/indicacoes.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;

const BUCKET_FOTOS = 'avatars';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(servir('excluir-conta', async (req) => {
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: perfil } = await admin
      .from('profiles')
      .select('mp_preapproval_id, assinatura_status, indicado_por, conta_demonstracao')
      .eq('id', userId)
      .maybeSingle();

    // A conta de demonstração é de todo mundo; ninguém a exclui.
    if (perfil?.conta_demonstracao) {
      return json({ error: 'A conta de demonstração não pode ser excluída.' }, 403);
    }

    // 1. A recorrência morre primeiro. `cancelada` no perfil não basta como
    // prova — o estado que vale é o do Mercado Pago, e cancelarPreapproval
    // confere lá antes de desistir.
    if (perfil?.mp_preapproval_id) {
      const cancelada = await cancelarPreapproval(MP_ACCESS_TOKEN, String(perfil.mp_preapproval_id));
      if (!cancelada) {
        return json({
          error: 'Não foi possível cancelar sua assinatura no Mercado Pago, e a conta não pode ser excluída com uma cobrança ativa. Tente de novo em alguns minutos, ou escreva para drsig@drsig.com.br.',
        }, 502);
      }
    }

    // 2. As fotos. Erro aqui não impede a exclusão: uma foto de perfil
    // órfã é um problema menor do que uma conta que a pessoa pediu para
    // apagar e continua existindo — mas fica registrado.
    try {
      const { data: arquivos } = await admin.storage.from(BUCKET_FOTOS).list(userId);
      const caminhos = (arquivos || []).map((a) => `${userId}/${a.name}`);
      if (caminhos.length) await admin.storage.from(BUCKET_FOTOS).remove(caminhos);
    } catch (err) {
      console.error('excluir-conta: não consegui apagar as fotos.', { userId, err });
    }

    // 3. Tudo o mais, em cascata.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 500);

    // Quem indicou esta conta tinha 10% por ela. Não tem mais.
    if (perfil?.indicado_por) {
      try {
        await aplicarDescontoDeIndicacoes(admin, MP_ACCESS_TOKEN, String(perfil.indicado_por));
      } catch (err) {
        // A conferência diária passa por todo mundo e acerta.
        console.error('excluir-conta: não consegui recalcular o desconto de quem indicou.', err);
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}));
