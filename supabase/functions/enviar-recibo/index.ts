// Edge Function: enviar-recibo
// Chamada pelo app (autenticado, via supabase.functions.invoke) quando a
// psicanalista toca em "Emitir" na tela Fiscal. Dois modos, conforme
// `tipo`:
//  - 'recibo' (padrão): envia o PDF do recibo (já gerado no app, recebido
//    aqui em base64) por e-mail — pro analisante e pro contador, como dois
//    envios independentes (nenhum dos dois é obrigatório).
//  - 'nota': não gera PDF nenhum — manda só um resumo dos dados (nome,
//    CPF, período, valor) pro contador, que emite a nota fiscal de
//    verdade e a envia ao analisante por fora do app.
// Ambos via Resend. Mesmo caminho já usado em solicitar-autorizacao: sem
// tela de compartilhar nem de compor e-mail, o envio acontece no servidor.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

function formatarMoedaBRL(valor: number) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function enviarEmail({ to, subject, html, pdfBase64 }: {
  to: string; subject: string; html: string; pdfBase64?: string;
}) {
  const body: Record<string, unknown> = {
    from: 'Dr.Sig <naoresponda@drsig.com.br>',
    to: [to],
    subject,
    html,
  };
  if (pdfBase64) {
    body.attachments = [{ filename: 'recibo.pdf', content: pdfBase64 }];
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Falha ao enviar e-mail pra ${to}: ${erro}`);
  }
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
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), { status: 401 });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const {
      tipo, patientEmail, patientNome, patientCpf, contadorEmail, periodo, valor, pdfBase64,
      corpoPacienteHtml, corpoContadorHtml,
    } = body || {};
    const tipoEmissao = tipo === 'nota' ? 'nota' : 'recibo';

    if (!patientNome || !periodo) {
      return new Response(JSON.stringify({ error: 'Dados incompletos.' }), { status: 400 });
    }
    if (tipoEmissao === 'recibo' && !pdfBase64) {
      return new Response(JSON.stringify({ error: 'Dados incompletos.' }), { status: 400 });
    }
    if (tipoEmissao === 'nota' && !contadorEmail) {
      return new Response(JSON.stringify({ error: 'Você não tem e-mail do contador cadastrado em Meu Perfil — não há para quem enviar.' }), { status: 400 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil } = await supabaseAdmin.from('profiles').select('nome').eq('id', userId).single();
    const nomePsicanalista = perfil?.nome || 'sua psicanalista';

    let enviadoPaciente = false;
    let enviadoContador = false;
    const erros: string[] = [];

    if (tipoEmissao === 'nota') {
      try {
        const cpfTexto = patientCpf ? ` (CPF ${patientCpf})` : '';
        const html = corpoContadorHtml ||
          `<p>Olá.</p><p>Segue o resumo para emissão da nota fiscal referente a <strong>${patientNome}</strong>${cpfTexto}, ${periodo}, no valor de <strong>${formatarMoedaBRL(valor)}</strong>.</p><p>Solicitação enviada por ${nomePsicanalista}. Por favor, emita a nota fiscal e a envie diretamente ao analisante.</p>`;
        await enviarEmail({
          to: contadorEmail,
          subject: `Emissão de nota fiscal — ${patientNome} — ${periodo}`,
          html,
        });
        enviadoContador = true;
      } catch (e) {
        erros.push(String((e as Error).message || e));
      }
    } else {
      if (patientEmail) {
        try {
          const html = corpoPacienteHtml ||
            `<p>Olá, ${patientNome}.</p><p>Segue em anexo o recibo de prestação de serviços referente a ${periodo}, emitido por ${nomePsicanalista}.</p>`;
          await enviarEmail({
            to: patientEmail,
            subject: `Seu recibo — ${periodo}`,
            html,
            pdfBase64,
          });
          enviadoPaciente = true;
        } catch (e) {
          erros.push(String((e as Error).message || e));
        }
      }

      if (contadorEmail) {
        try {
          const html = corpoContadorHtml ||
            `<p>Segue em anexo o recibo emitido para ${patientNome}, referente a ${periodo}.</p>`;
          await enviarEmail({
            to: contadorEmail,
            subject: `Recibo — ${patientNome} — ${periodo}`,
            html,
            pdfBase64,
          });
          enviadoContador = true;
        } catch (e) {
          erros.push(String((e as Error).message || e));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, enviadoPaciente, enviadoContador, erros }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), { status: 500 });
  }
});
