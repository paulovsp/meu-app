// Edge Function: solicitar-autorizacao
// Chamada pelo app (autenticado, via supabase.functions.invoke). Recebe os
// dados de identidade do analisante, gera um token único, grava a
// solicitação em `autorizacoes_transcricao` e manda o e-mail de confirmação
// via Resend. SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY são
// injetadas automaticamente pelo Supabase — só RESEND_API_KEY precisa ser
// configurada manualmente como secret desta função.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

function gerarToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado.' }), { status: 401 });
    }

    // Client no contexto do usuário que chamou, só pra identificar quem é.
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), { status: 401 });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { patient_local_id, nome, cpf, nascimento, email } = body || {};
    if (!patient_local_id || !nome || !cpf || !nascimento || !email) {
      return new Response(JSON.stringify({ error: 'Dados incompletos.' }), { status: 400 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Nome da psicanalista, pro e-mail deixar claro quem está solicitando.
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('nome')
      .eq('id', userId)
      .single();
    const nomePsicanalista = perfil?.nome || 'sua psicanalista';

    const token = gerarToken();
    // A.2: validade curta (48h) — agora que a confirmação pede foto de
    // documento, faz sentido um prazo mais apertado que o texto digitado
    // de antes (era 7 dias).
    const expiraEm = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin.from('autorizacoes_transcricao').insert({
      user_id: userId,
      patient_local_id,
      patient_nome: nome,
      patient_cpf: cpf,
      patient_nascimento: nascimento,
      patient_email: email,
      token,
      expira_em: expiraEm,
    });
    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
    }

    // A página fica no GitHub Pages, não na própria Edge Function — o
    // Supabase reescreve à força qualquer resposta HTML das Edge Functions
    // pra text/plain no domínio padrão dele (proteção contra phishing),
    // então confirmar-autorizacao virou só uma API JSON chamada por essa
    // página estática via fetch().
    const linkConfirmacao = `https://app.drsig.com.br/autorizacao.html?token=${token}`;
    const primeiroNome = String(nome).trim().split(' ')[0];

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Dr.Sig <naoresponda@drsig.com.br>',
        to: [email],
        subject: `${nomePsicanalista} está pedindo sua autorização`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
            <h2>Autorização de gravação e transcrição</h2>
            <p>Olá, ${primeiroNome}.</p>
            <p><strong>${nomePsicanalista}</strong> está pedindo sua autorização para gravar em áudio e transcrever suas sessões, como parte do seu acompanhamento clínico.</p>
            <p>Clique no link abaixo e escolha se autoriza ou não. Se autorizar, vamos pedir uma foto de um documento com foto (RG, CNH ou passaporte) só pra confirmar que é você — a foto não fica guardada, é usada apenas nessa conferência.</p>
            <p><a href="${linkConfirmacao}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Responder à solicitação</a></p>
            <p style="color:#888;font-size:12px;">Se você não é ${primeiroNome} ou não reconhece essa solicitação, ignore este e-mail. O link expira em 48 horas.</p>
          </div>
        `,
      }),
    });

    if (!emailResp.ok) {
      const erro = await emailResp.text();
      return new Response(JSON.stringify({ error: `Falha ao enviar e-mail: ${erro}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
});
