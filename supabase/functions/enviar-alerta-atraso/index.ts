// Edge Function: enviar-alerta-atraso
// Chamada pelo app (autenticado) quando há recebimentos mensais em atraso
// ainda não avisados hoje (ver src/services/alertaAtraso.js). Só PUSH —
// o e-mail de atraso saiu daqui (item 1, leva pós-v13): mandar e-mail toda
// vez que a Início ganha foco fazia o horário do aviso parecer aleatório.
// O e-mail agora é o digest diário (enviar-digest-diario, num horário fixo,
// via cron), que já cobre atraso + sessões sem relato num envio só. Push
// continua aqui porque é mais leve (não é "caixa de entrada") e faz sentido
// ser mais imediato.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user?.email) return json({ error: 'Sessão inválida.' }, 401);

    const body = await req.json();
    const { atrasados } = body || {};
    if (!Array.isArray(atrasados) || atrasados.length === 0) {
      return json({ error: 'Nada pra avisar.' }, 400);
    }

    const { data: perfil } = await supabaseUser
      .from('profiles')
      .select('expo_push_token, notif_atraso_push')
      .eq('id', userData.user.id)
      .single();

    const titulo = `${atrasados.length} recebimento${atrasados.length === 1 ? '' : 's'} em atraso`;
    const erros: string[] = [];

    if (perfil?.notif_atraso_push === true && perfil?.expo_push_token) {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: perfil.expo_push_token,
          title: titulo,
          body: atrasados.map((a: { nome: string }) => a.nome).join(', '),
        }),
      });
      if (!resp.ok) erros.push(`push: ${await resp.text()}`);
    }

    if (erros.length > 0) {
      return json({ error: `Falha ao notificar — ${erros.join(' | ')}` }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
