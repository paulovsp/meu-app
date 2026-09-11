// Edge Function: assinatura-cancelar
//
// Cancela a assinatura da própria pessoa, do app, num toque.
//
// Por que precisa existir: a tela de pagamento promete "cancele quando
// quiser — pelo app, em Meu Perfil". Não havia botão nenhum. A única coisa
// parecida no perfil era "Excluir conta", que apaga tudo — quem só queria
// parar de pagar tinha que escolher entre continuar pagando e destruir o
// próprio arquivo clínico. Prometer cancelamento fácil e esconder a saída
// é o padrão que a lei chama de obstáculo, e é o tipo de coisa que vira
// reclamação pública antes de virar processo.
//
// Cancelar NÃO tira o acesso na hora: o que foi pago está pago, e vale até
// o fim do período. Quem grava isso no perfil é o mesmo módulo do webhook
// — `sincronizarPreapproval` lê a assinatura no Mercado Pago depois do
// cancelamento e reflete o estado real, em vez de este arquivo ter a sua
// própria opinião sobre o que "cancelada" significa.
//
// JWT normal: quem cancela é a dona da conta, autenticada no app. O id da
// assinatura vem do PERFIL dela, nunca do corpo da requisição — senão
// bastaria mandar o id de outra pessoa pra cancelar a assinatura alheia.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cancelarPreapproval, sincronizarPreapproval } from '../_shared/assinaturaMercadoPago.ts';
import { atualizarQuemIndicou } from '../_shared/indicacoes.ts';
import { servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')!;

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

Deno.serve(servir('assinatura-cancelar', async (req) => {
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil } = await admin
      .from('profiles')
      .select('assinatura_status, assinatura_expira_em, mp_preapproval_id')
      .eq('id', userId)
      .maybeSingle();

    if (!perfil) return json({ error: 'Conta não encontrada.' }, 404);

    if (perfil.assinatura_status === 'cortesia') {
      return json({ error: 'Sua conta é de cortesia — não há assinatura para cancelar.' }, 400);
    }
    if (!perfil.mp_preapproval_id) {
      return json({
        error: 'Não há assinatura ativa nesta conta. Se você acabou de pagar, espere um minuto e tente de novo.',
      }, 400);
    }
    if (perfil.assinatura_status === 'cancelada') {
      return json({ ok: true, jaEstavaCancelada: true, validaAte: perfil.assinatura_expira_em });
    }

    // A validade é lida ANTES de cancelar: o cancelamento zera o campo no
    // perfil (não renova mais), e é justamente essa data que a pessoa
    // precisa ver na tela — até quando ela ainda pode usar o que pagou.
    const validaAte = perfil.assinatura_expira_em;

    const cancelada = await cancelarPreapproval(MP_ACCESS_TOKEN, String(perfil.mp_preapproval_id));
    if (!cancelada) {
      return json({
        error: 'Não foi possível cancelar agora. Tente de novo em alguns minutos, ou escreva para drsig@drsig.com.br que a gente cancela para você.',
      }, 502);
    }

    // Reflete o estado real, lido do Mercado Pago — mesma função que o
    // webhook usa. Se falhar, o cancelamento JÁ aconteceu lá: o webhook e a
    // conferência diária acertam o perfil em seguida, e dizer "não deu"
    // aqui faria a pessoa cancelar duas vezes.
    try {
      await sincronizarPreapproval(admin, MP_ACCESS_TOKEN, String(perfil.mp_preapproval_id), 'cancelamento-pelo-app');
      // Deixou de ser um indicado ativo: quem indicou perde os 10%.
      await atualizarQuemIndicou(admin, MP_ACCESS_TOKEN, userId);
    } catch (err) {
      console.error('assinatura-cancelar: cancelou no Mercado Pago, mas não sincronizou o perfil.', err);
    }

    return json({ ok: true, validaAte });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}));
