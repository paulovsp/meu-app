// Edge Function: enviar-alerta-atraso
// Chamada pelo app (autenticado) quando há recebimentos mensais em atraso
// ainda não avisados hoje (ver src/services/alertaAtraso.js). Manda UM
// e-mail agregado — não um por paciente — pro próprio e-mail de login da
// psicanalista, via Resend. Sem custo de crédito de IA (não usa nenhum
// provedor de IA), só um e-mail informativo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function formatarMoedaBRL(valor: number) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

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
      .select('expo_push_token, notif_atraso_email, notif_atraso_push')
      .eq('id', userData.user.id)
      .single();

    const titulo = `${atrasados.length} recebimento${atrasados.length === 1 ? '' : 's'} em atraso`;
    const linhas = atrasados
      .map((a: { nome: string; diasAtraso: number; valor: number }) =>
        `- ${a.nome}: ${a.diasAtraso} dia${a.diasAtraso === 1 ? '' : 's'} de atraso — ${formatarMoedaBRL(a.valor)}`)
      .join('<br/>');

    // Canais independentes (item D.10) — cada um só dispara se a pessoa
    // ligou, e a falha de um não impede o outro.
    const erros: string[] = [];

    if (perfil?.notif_atraso_email !== false) {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Dr.Sig <naoresponda@drsig.com.br>',
          to: [userData.user.email],
          subject: titulo,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
              <h2>Recebimentos em atraso</h2>
              <p>${linhas}</p>
              <p>Abra o app Dr.Sig e confira em Recebíveis.</p>
            </div>
          `,
        }),
      });
      if (!resp.ok) erros.push(`e-mail: ${await resp.text()}`);
    }

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
