// Edge Function: reenviar-instrucoes-plano
//
// O beco sem saída que esta função existe pra fechar: quem se cadastra e não
// escolhe um plano na hora fica com a conta em `sem_assinatura`. O app então
// recusa toda criação — sessão, registro, analisante — com um aviso dizendo
// que "enviamos um e-mail com os próximos passos". Se esse e-mail foi
// perdido, apagado ou nunca chegou, não havia NADA a fazer dentro do app: o
// aviso apontava pra uma mensagem que a pessoa não tem mais.
//
// Aqui ela pede o e-mail de novo, do próprio app, e ele chega na hora.
//
// O link precisa levar a pessoa autenticada até a página de planos, que só
// consegue chamar o checkout com uma sessão em mãos. O token vem de um
// magic link do Supabase, gerado no servidor — não dá pra montar isso no
// cliente sem expor a service role.
//
// Mas o `action_link` que o Supabase devolve NÃO pode ser mandado por
// e-mail: ele é um GET em /auth/v1/verify, e antivírus de e-mail (Safe
// Links, proxy corporativo) abrem sozinhos todo link que chega. Como o
// token é de uso único, ele era consumido antes de a pessoa clicar, e o
// link chegava morto. É o mesmo defeito já corrigido no e-mail de cadastro
// e no de recuperação de senha; este era o terceiro.
//
// Por isso o que vai no e-mail é o `hashed_token` cru, apontando pra nossa
// própria página, que só o troca por sessão depois de um clique de
// verdade — num POST, que nenhum scanner dispara.
//
// JWT normal: quem pede é a própria dona da conta, autenticada no app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Dois destinos, o mesmo mecanismo. A recarga de créditos passou a chegar
// pelo mesmo caminho do plano — e-mail com link para a nossa página —
// porque a política de pagamentos do Google Play alcança os dois: crédito
// de IA gasto dentro do app é bem digital tanto quanto a assinatura.
const DESTINOS = {
  plano: {
    pagina: 'https://app.drsig.com.br/escolher-plano.html',
    assunto: 'Dr.Sig — o link para escolher seu plano',
    pediu: 'Você pediu, pelo app, o link para escolher seu plano. É este:',
    botao: 'Escolher meu plano',
    depois: 'Assim que o pagamento for confirmado, o acesso é liberado sozinho — basta abrir o app de novo.',
    ondePedir: 'Meu Perfil › Seu plano',
  },
  creditos: {
    pagina: 'https://app.drsig.com.br/recarregar-creditos.html',
    assunto: 'Dr.Sig — o link para recarregar seus créditos de IA',
    pediu: 'Você pediu, pelo app, o link para recarregar seus créditos de IA. É este:',
    botao: 'Recarregar créditos',
    depois: 'Pix ou cartão. O crédito entra na sua conta na hora em que o pagamento é confirmado.',
    ondePedir: 'Meu Perfil › Créditos de IA',
  },
} as const;

type Destino = keyof typeof DESTINOS;

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

async function enviarEmail(to: string, subject: string, html: string) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: 'Dr.Sig <naoresponda@drsig.com.br>', to: [to], subject, html }),
  });
  if (!resp.ok) throw new Error(`Falha ao enviar e-mail: ${await resp.text()}`);
}

function corpo(nome: string, link: string, destino: Destino) {
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  const d = DESTINOS[destino];
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #302C28; line-height: 1.55;">
      <p style="font-size:22px;font-weight:800;font-style:italic;color:#3A5C4F;margin:0 0 4px;">Dr.Sig</p>
      <p style="font-size:11px;font-weight:700;color:#6B9E8A;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 24px;">O seu assistente clínico</p>

      <h1 style="font-size:20px;margin:0 0 14px;">${saudacao}</h1>
      <p>${d.pediu}</p>

      <p style="margin:26px 0;">
        <a href="${link}" style="background:#497363;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">${d.botao}</a>
      </p>

      <p style="font-size:13.5px;color:#756E66;">O link vale por 1 hora e só pode ser usado uma vez. Se expirar, é só pedir outro pelo app, em ${d.ondePedir}.</p>
      <p style="font-size:13.5px;color:#756E66;">${d.depois}</p>

      <p style="color:#A9A299;font-size:12px;margin-top:28px;">Se não foi você que pediu, ignore este e-mail: nada acontece sem que o link seja aberto.</p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseUser.auth.getUser();
    const email = userData?.user?.email;
    if (!email) return json({ error: 'Sessão inválida.' }, 401);

    const body = await req.json().catch(() => ({}));
    const destino: Destino = body?.destino === 'creditos' ? 'creditos' : 'plano';
    const d = DESTINOS[destino];

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: perfil } = await admin
      .from('profiles')
      .select('nome, conta_demonstracao')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (perfil?.conta_demonstracao) {
      return json({ error: 'A conta de demonstração não assina nem compra créditos. Crie a sua conta.' }, 403);
    }

    // `magiclink` e não `signup`: a conta já está confirmada. O que se quer
    // é uma sessão válida chegando na página.
    const { data: linkData, error: erroLink } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: d.pagina },
    });
    if (erroLink || !linkData?.properties?.hashed_token) {
      return json({ error: 'Não foi possível gerar o link. Tente de novo em instantes.' }, 502);
    }

    // Nossa página, com o token cru — nunca o action_link do Supabase (ver
    // nota no topo: scanner de e-mail queima token de uso único).
    const link = `${d.pagina}?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}`;

    await enviarEmail(email, d.assunto, corpo(perfil?.nome || '', link, destino));

    // Devolve o e-mail pra tela poder dizer PARA ONDE mandou — a dúvida
    // mais comum de quem não recebe é se foi pro endereço certo.
    return json({ ok: true, email });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
