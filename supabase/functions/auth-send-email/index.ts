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
//
// O visual vem de _shared/emailDrSig.ts — o mesmo envelope de todo e-mail
// do app. Aqui só se escreve o conteúdo.
import { botao, destaque, envelope, enviarEmail, escaparHtml, h2, lista, p, tabela } from '../_shared/emailDrSig.ts';

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
// A recuperação de senha tinha o MESMO defeito que o cadastro já teve, e
// mais um. O mesmo: apontava pro GET /auth/v1/verify, que os scanners de
// e-mail seguem sozinhos, consumindo o token de uso único antes da pessoa
// clicar. O a mais: o redirect_to só era incluído se viesse preenchido, e
// sem ele o Supabase mandava a pessoa pra URL padrão do projeto — nunca
// pra tela de escolher a senha nova. Na prática, o link nunca funcionou.
function montarLinkRedefinirSenha(tokenHash: string) {
  const url = new URL('https://app.drsig.com.br/redefinir-senha.html');
  url.searchParams.set('token_hash', tokenHash);
  return url.toString();
}

function montarLinkConfirmacaoCadastro(tokenHash: string) {
  const url = new URL('https://app.drsig.com.br/confirmar-cadastro.html');
  url.searchParams.set('token_hash', tokenHash);
  return url.toString();
}

const RODAPE_PADRAO = 'Se você não reconhece esta solicitação, ignore este e-mail: nada acontece sem que o botão seja usado.';

/** O e-mail de boas-vindas: confirmação + o que o app faz + planos + demonstração. */
function emailDeBoasVindas(nome: string, linkSignup: string): string {
  const saudacao = nome ? `Olá, ${escaparHtml(nome.split(' ')[0])}!` : 'Olá!';
  return envelope({
    titulo: 'Seja bem-vindo(a) ao Dr.Sig',
    saudacao,
    previa: 'Confirme sua conta e escolha seu plano — leva dois minutos.',
    corpo:
      p('O Dr.Sig é o consultório digital de quem exerce psicoterapia: agenda, prontuário e financeiro do seu acompanhamento — inclusive de analisantes e supervisionandos — num lugar só, pensado para a sua rotina clínica.')
      + botao('Confirmar minha conta e ver os planos', linkSignup)
      + p('O link vale por algumas horas. Depois de confirmar, você escolhe o plano na mesma tela.', { pequeno: true })
      + h2('O que você pode fazer no app')
      + lista([
        '<strong>Agenda</strong> — horários fixos que se repetem sozinhos, com faltas e cancelamentos registrados.',
        '<strong>Sessões e prontuário</strong> — registre atendimentos, grave e transcreva sessões (com autorização do analisante) e edite anotações com formatação.',
        '<strong>Busca Dr.Sig e relatórios</strong> — pergunte em português sobre o histórico de um analisante; relatórios de evolução, frequência e pagamento saem prontos.',
        '<strong>Analisantes e supervisionandos</strong> — cadastro completo, com os dois vínculos podendo coexistir na mesma pessoa.',
        '<strong>Cobrança e financeiro</strong> — o que está em aberto, o que entrou, o que saiu; recibos em PDF direto para o analisante e para o seu contador.',
        '<strong>Cursos</strong> — o histórico da sua formação continuada, com gravação e transcrição de aulas.',
      ])
      + h2('Planos, sem fidelidade')
      + tabela([
        ['Mensal', 'R$ 89 por mês'],
        ['Semestral', 'R$ 414 a cada 6 meses (R$ 69/mês)'],
        ['Anual', 'R$ 588 por ano (R$ 49/mês)'],
      ])
      + p('Os três são assinatura e renovam sozinhos até você cancelar — muda só de quanto em quanto tempo a cobrança acontece. Pagamento em cartão de crédito, pelo Mercado Pago, sem precisar de conta lá. Cancele quando quiser, pelo app, sem multa; o acesso vale até o fim do período pago.', { pequeno: true })
      + destaque(
        '<strong>Quer conhecer o app antes de decidir?</strong><br/>'
        + 'Na tela de entrada, toque em <strong>Conhecer o app sem criar conta</strong>: é o consultório do Sigmund Freud, com 15 fichas, agenda, registros e sessões transcritas. Somente leitura — dá para ver tudo, sem mexer em nada.',
      )
      + p(`Dúvidas? Escreva para <a href="mailto:drsig@drsig.com.br" style="color:#497363;">drsig@drsig.com.br</a>. Antes de usar o app, leia os <a href="https://app.drsig.com.br/termos.html" style="color:#497363;">Termos de Uso</a> e a <a href="https://app.drsig.com.br/privacidade.html" style="color:#497363;">Política de Privacidade</a>.`, { pequeno: true }),
    rodape: 'Se você não criou esta conta, ignore este e-mail: nada acontece sem que o botão seja usado.',
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405 });
  }

  const payload = await req.text();

  try {
    await verificarAssinatura(payload, req.headers);
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 401 });
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
      subject = 'Bem-vindo(a) ao Dr.Sig — confirme seu cadastro';
      html = emailDeBoasVindas(nome, montarLinkConfirmacaoCadastro(emailData?.token_hash));
    } else if (tipo === 'email_change') {
      subject = 'Confirme seu novo e-mail no Dr.Sig';
      html = envelope({
        titulo: 'Confirme seu novo e-mail',
        corpo: p('Você pediu para trocar o e-mail da sua conta no Dr.Sig. Confirme no botão abaixo para a troca valer.')
          + botao('Confirmar novo e-mail', link),
        rodape: RODAPE_PADRAO,
      });
    } else if (tipo === 'recovery') {
      subject = 'Redefinição de senha — Dr.Sig';
      html = envelope({
        titulo: 'Escolha uma nova senha',
        saudacao: nome ? `Olá, ${escaparHtml(nome.split(' ')[0])}.` : undefined,
        previa: 'O link para escolher a nova senha está aqui.',
        corpo: p('Recebemos um pedido para redefinir a senha da sua conta no Dr.Sig. Toque no botão para escolher uma nova:')
          + botao('Redefinir minha senha', montarLinkRedefinirSenha(emailData?.token_hash))
          + p('O link só funciona uma vez e vale por pouco tempo. Se expirar, peça outro na tela de entrada do app, em "Esqueci minha senha".', { pequeno: true }),
        rodape: 'Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.',
      });
    } else {
      subject = 'Confirmação — Dr.Sig';
      html = envelope({
        titulo: 'Confirmação necessária',
        corpo: p('Toque no botão abaixo para continuar:') + botao('Continuar', link),
        rodape: RODAPE_PADRAO,
      });
    }

    await enviarEmail(RESEND_API_KEY, email, subject, html);

    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 500 });
  }
});
