// Edge Function: auth-send-email
// Auth Hook "Send Email" do Supabase — configurado no painel
// (Authentication > Hooks > Send Email), substitui COMPLETAMENTE o envio
// nativo de e-mail de auth (signup/recovery/email change/etc). O Supabase
// chama esta função em vez de mandar o e-mail dele mesmo, o que permite
// controlar 100% do texto/visual (o editor de template do painel não
// estava permitindo customizar o "Confirm signup"). Envio real via Resend,
// mesmo remetente `naoresponda@drsig.com.br` já usado nas outras funções.
//
// A chamada vem da infraestrutura do Supabase, não do app — não tem
// Authorization de usuário nem JWT. A autenticidade é garantida pela
// assinatura HMAC no header `webhook-signature` (padrão Standard
// Webhooks), verificada com o secret gerado ao habilitar o hook no painel
// (formato "v1,whsec_XXXX...", salvo aqui como SEND_EMAIL_HOOK_SECRET).
// Por isso o deploy precisa ser feito com --no-verify-jwt.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET')!;

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function verificarAssinatura(payload: string, headers: Headers) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatureHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !signatureHeader) {
    throw new Error('Assinatura ausente no request.');
  }

  const secretPart = HOOK_SECRET.split(',')[1] || HOOK_SECRET;
  const secretB64 = secretPart.replace('whsec_', '');
  const key = await crypto.subtle.importKey(
    'raw',
    base64Decode(secretB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signedContent = `${id}.${timestamp}.${payload}`;
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const esperado = base64Encode(new Uint8Array(sigBytes));

  const recebidas = signatureHeader.split(' ').map((s) => s.split(',')[1]);
  if (!recebidas.includes(esperado)) {
    throw new Error('Assinatura inválida.');
  }
}

async function enviarEmail(to: string, subject: string, html: string) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: 'Dr.Sig <naoresponda@drsig.com.br>', to: [to], subject, html }),
  });
  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Falha ao enviar e-mail: ${erro}`);
  }
}

function montarLinkVerificacao(tokenHash: string, tipo: string, redirectTo: string) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', tipo);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

function envelope(tituloInterno: string, corpoHtml: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
      <h2>${tituloInterno}</h2>
      ${corpoHtml}
      <p style="color:#888;font-size:12px;">Se você não reconhece essa solicitação, ignore este e-mail.</p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405 });
  }

  const payload = await req.text();

  try {
    await verificarAssinatura(payload, req.headers);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 401 });
  }

  try {
    const { user, email_data: emailData } = JSON.parse(payload);
    const email = user?.email;
    const tipo = emailData?.email_action_type;
    const link = montarLinkVerificacao(emailData?.token_hash, tipo, emailData?.redirect_to);

    let subject: string;
    let html: string;

    if (tipo === 'signup') {
      subject = 'Bem-vindo(a) ao Dr.Sig!';
      html = envelope(
        'Bem-vindo(a) ao Dr.Sig',
        `
          <p>Obrigado por se cadastrar!</p>
          <p>O Dr.Sig é o seu assistente pra organizar a prática clínica: agenda, financeiro, fiscal e o acompanhamento dos seus analisantes, tudo em um só lugar.</p>
          <p>Falta só confirmar seu cadastro clicando no botão abaixo:</p>
          <p><a href="${link}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar cadastro</a></p>
          <p style="margin-top:24px;">Pra usar o Dr.Sig, é só escolher um plano de assinatura — os próximos passos estão aqui:</p>
          <p><a href="https://drsig.com.br" style="color:#3D5A80;">drsig.com.br</a></p>
        `
      );
    } else if (tipo === 'email_change') {
      subject = 'Confirme seu novo e-mail no Dr.Sig';
      html = envelope(
        'Confirmação de novo e-mail',
        `
          <p>Falta pouco! Clique no link abaixo pra confirmar seu novo e-mail:</p>
          <p><a href="${link}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar</a></p>
        `
      );
    } else if (tipo === 'recovery') {
      subject = 'Redefinição de senha — Dr.Sig';
      html = envelope(
        'Redefinir sua senha',
        `
          <p>Recebemos um pedido pra redefinir a senha da sua conta no Dr.Sig. Clique no link abaixo pra escolher uma nova senha:</p>
          <p><a href="${link}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Redefinir senha</a></p>
        `
      );
    } else {
      subject = 'Confirmação — Dr.Sig';
      html = envelope(
        'Confirmação necessária',
        `
          <p>Clique no link abaixo pra continuar:</p>
          <p><a href="${link}" style="background:#3D5A80;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Continuar</a></p>
        `
      );
    }

    await enviarEmail(email, subject, html);

    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
});
