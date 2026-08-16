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

// Site institucional (drsig.com.br, repo separado) — não o domínio
// app.drsig.com.br, que só hospeda páginas estáticas (termos, privacidade,
// confirmação) e não tem index.html na raiz.
const SITE_URL = 'https://drsig.com.br';

function montarLinkVerificacao(tokenHash: string, tipo: string, redirectTo: string) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', tipo);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

// O link de "signup" NÃO aponta mais direto pro GET /auth/v1/verify —
// qualquer scanner de segurança de e-mail (Microsoft Safe Links, proxy
// corporativo, etc.) segue automaticamente todo link de um e-mail assim
// que ele chega, e como o token é de uso único, isso consome o token
// ANTES da pessoa clicar de verdade (erro real visto nos logs: "One-time
// token not found"). A correção: o link aponta pra uma página nossa
// (confirmar-cadastro.html) que exige um clique de verdade num botão —
// só DEPOIS desse clique é que o token é enviado pro Supabase (via POST,
// não GET, também mais resistente a pré-carregamento automático).
function montarLinkConfirmacaoCadastro(tokenHash: string) {
  const url = new URL('https://app.drsig.com.br/confirmar-cadastro.html');
  url.searchParams.set('token_hash', tokenHash);
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
    const nome = user?.user_metadata?.nome || '';
    const tipo = emailData?.email_action_type;
    const link = montarLinkVerificacao(emailData?.token_hash, tipo, emailData?.redirect_to);

    let subject: string;
    let html: string;

    if (tipo === 'signup') {
      // Item pós-teste "rever arquitetura do cadastro": e-mail completo
      // (boas-vindas + explicação do app + funcionalidades + planos + termos
      // essenciais + tour + login demo), com o botão levando pro fluxo
      // completo confirmar -> escolher plano -> pagar -> acesso liberado
      // (ver mercadopago-criar-checkout-assinatura e docs/escolher-plano.html).
      const linkSignup = montarLinkConfirmacaoCadastro(emailData?.token_hash);
      const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
      subject = 'Bem-vindo(a) ao Dr.Sig — confirme seu cadastro';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1A1A2E; line-height: 1.55;">
          <p style="font-size:22px;font-weight:800;font-style:italic;color:#3D5A80;margin:0 0 4px;">Dr.Sig</p>
          <p style="font-size:11px;font-weight:700;color:#5B7FA6;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 24px;">O seu assistente clínico</p>

          <h1 style="font-size:20px;margin:0 0 14px;">${saudacao} Seja bem-vindo(a).</h1>
          <p>O Dr.Sig é o consultório digital de quem exerce psicoterapia: organiza a agenda, o prontuário e o financeiro do seu acompanhamento — inclusive de analisantes e supervisionandos — tudo em um único lugar, pensado pra sua rotina clínica.</p>

          <h2 style="font-size:15px;color:#3D5A80;margin:26px 0 10px;">O que você pode fazer no app</h2>
          <ul style="padding-left:20px;margin:0 0 20px;font-size:14px;">
            <li><strong>Agenda</strong> — horários recorrentes, visão diária e semanal, com zoom pra ajustar o tamanho dos blocos.</li>
            <li><strong>Sessões e prontuário</strong> — registre atendimentos, grave e transcreva sessões automaticamente (com autorização do analisante) e edite anotações com formatação de texto.</li>
            <li><strong>Busca Dr.Sig</strong> — pergunte em linguagem natural sobre o histórico de um analisante e receba relatórios prontos (resumo de sessões, frequência, pagamento).</li>
            <li><strong>Analisantes e Supervisionandos</strong> — cadastro completo, com os dois vínculos podendo coexistir na mesma pessoa.</li>
            <li><strong>Financeiro e Recebíveis</strong> — acompanhe pagamentos em aberto e recebidos, com cobrança mensal, por sessão ou mensal fixo.</li>
            <li><strong>Fiscal</strong> — gere recibos em PDF e envie automaticamente pro analisante e pro seu contador.</li>
            <li><strong>Cursos</strong> — mantenha um histórico da sua formação continuada, com opção de gravar e transcrever aulas.</li>
            <li><strong>Pagamentos</strong> — controle as despesas administrativas do seu próprio consultório.</li>
          </ul>

          <h2 style="font-size:15px;color:#3D5A80;margin:26px 0 10px;">Planos, sem fidelidade</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:8px;">
            <tr style="background:#F5F7FA;">
              <td style="padding:8px 10px;border:1px solid #E2E6EC;"><strong>Mensal</strong></td>
              <td style="padding:8px 10px;border:1px solid #E2E6EC;">R$ 89/mês</td>
            </tr>
            <tr>
              <td style="padding:8px 10px;border:1px solid #E2E6EC;"><strong>Semestral</strong></td>
              <td style="padding:8px 10px;border:1px solid #E2E6EC;">R$ 414 a cada 6 meses (~R$ 69/mês)</td>
            </tr>
            <tr style="background:#F5F7FA;">
              <td style="padding:8px 10px;border:1px solid #E2E6EC;"><strong>Anual</strong></td>
              <td style="padding:8px 10px;border:1px solid #E2E6EC;">R$ 588/ano (~R$ 49/mês)</td>
            </tr>
          </table>
          <p style="font-size:12.5px;color:#6B6860;">Cancele quando quiser, sem multa. Pagamento via Mercado Pago (cartão ou Pix).</p>

          <p style="text-align:center;margin:28px 0;">
            <a href="${linkSignup}" style="background:#3D5A80;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">Confirmar minha conta e ver os planos</a>
          </p>
          <p style="color:#888;font-size:12.5px;text-align:center;margin-top:-18px;">Esse link expira em algumas horas. Se você não criou essa conta, ignore este e-mail.</p>

          <div style="background:#F5F7FA;border-left:3px solid #3D5A80;padding:14px 16px;border-radius:4px;margin:24px 0;">
            <strong style="font-size:14px;">Quer conhecer o app na prática antes de decidir?</strong>
            <p style="margin:8px 0 0;font-size:13.5px;">
              Preparamos uma conta de demonstração já com analisantes, supervisionandos, agenda e sessões de exemplo —
              dá pra explorar tudo sem mexer nos seus próprios dados:
            </p>
            <p style="margin:10px 0 0;font-size:13.5px;">
              E-mail: <strong>oseusig@gmail.com</strong><br/>
              Senha: <strong>Viena1900</strong>
            </p>
          </div>

          <h2 style="font-size:15px;color:#3D5A80;margin:26px 0 10px;">Informações legais</h2>
          <p style="font-size:12.5px;color:#6B6860;">
            O Dr.Sig é oferecido por <strong>Dr.Sig Soluções Digitais</strong> (Paulo Von Schwerin Pimentel LTDA,
            CNPJ 68.542.896/0001-74). Leia os
            <a href="https://app.drsig.com.br/termos.html" style="color:#3D5A80;">Termos de Uso</a> e a
            <a href="https://app.drsig.com.br/privacidade.html" style="color:#3D5A80;">Política de Privacidade</a>
            antes de usar o app.
          </p>

          <p style="font-size:13.5px;margin-top:20px;">
            Qualquer dúvida, fale com a gente: <a href="mailto:drsig@drsig.com.br" style="color:#3D5A80;">drsig@drsig.com.br</a><br/>
            Saiba mais em: <a href="${SITE_URL}" style="color:#3D5A80;">drsig.com.br</a>
          </p>

          <p style="margin-top:24px;font-style:italic;color:#6B6860;font-size:13px;">— Equipe Dr.Sig<br/>O consultório e a escuta, no mesmo lugar.</p>
        </div>
      `;
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
