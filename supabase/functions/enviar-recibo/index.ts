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
//
// ── Quem decide os destinatários é o banco, não a requisição ───────────
//
// Esta função já aceitou `patientEmail`, `contadorEmail` e o HTML dos dois
// e-mails vindos do corpo da chamada. Qualquer conta autenticada — a de
// demonstração, cuja senha é pública, inclusive — podia mandar o HTML que
// quisesse, com anexo, para o endereço que quisesse, assinado por
// naoresponda@drsig.com.br. Phishing com a nossa marca, e um único abuso
// derrubava a reputação do domínio na Resend: aí paravam de chegar os
// e-mails de cadastro e de senha de todo mundo.
//
// Agora a chamada diz QUAL analisante (que precisa ser dela) e o TEXTO que
// ela escreveu; os endereços vêm da ficha e do perfil, e o texto vira HTML
// aqui, escapado. Não há como este servidor mandar e-mail para alguém que
// não seja um analisante ou o contador de quem chamou.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { envelope, enviarEmail as enviarPelaResend, escaparHtml, p } from '../_shared/emailDrSig.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Um recibo em PDF tem dezenas de KB; um megabyte já é anexo de outra
// natureza. O limite existe para esta função não virar um transporte de
// arquivo qualquer em nome do Dr.Sig.
const TAMANHO_MAXIMO_PDF_BASE64 = 2 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatarMoedaBRL(valor: number) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Texto autoral da profissional vira o corpo do e-mail: escapado, e cada
// quebra de linha vira um parágrafo próprio.
function textoParaHtml(texto: string) {
  const escapado = escaparHtml(String(texto || ''));
  const paragrafos = escapado.split('\n').filter((l) => l.trim()).map((l) => p(l));
  return paragrafos.join('') || p(escapado);
}

/** Manda o e-mail no envelope do Dr.Sig, com o recibo em anexo quando houver. */
async function enviarEmail({ to, subject, titulo, html, pdfBase64, rodape }: {
  to: string; subject: string; titulo: string; html: string; pdfBase64?: string; rodape: string;
}) {
  const corpo = envelope({ titulo, corpo: html, rodape });
  const anexos = pdfBase64 ? [{ filename: 'recibo.pdf', content: pdfBase64 }] : undefined;
  await enviarPelaResend(RESEND_API_KEY, to, subject, corpo, anexos);
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
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { tipo, patientId, periodo, valor, pdfBase64, mensagemPaciente, mensagemContador } = body || {};
    const tipoEmissao = tipo === 'nota' ? 'nota' : 'recibo';

    if (!patientId || !periodo) return json({ error: 'Dados incompletos.' }, 400);
    if (tipoEmissao === 'recibo') {
      if (!pdfBase64) return json({ error: 'Dados incompletos.' }, 400);
      if (String(pdfBase64).length > TAMANHO_MAXIMO_PDF_BASE64) {
        return json({ error: 'O recibo ficou grande demais para ser enviado por e-mail.' }, 413);
      }
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // A ficha tem que ser de quem chamou — é daqui, e só daqui, que sai
    // o e-mail do analisante.
    const { data: paciente } = await supabaseAdmin
      .from('patients')
      .select('nome, cpf, email')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!paciente) return json({ error: 'Analisante não encontrado.' }, 404);

    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('nome, contador_email, conta_demonstracao')
      .eq('id', userId)
      .single();
    if (perfil?.conta_demonstracao) {
      return json({ error: 'A conta de demonstração não envia e-mails.' }, 403);
    }
    const nomePsicanalista = perfil?.nome || 'sua psicanalista';
    const contadorEmail = String(perfil?.contador_email || '').trim() || null;
    const pacienteEmail = String(paciente.email || '').trim() || null;
    const patientNome = escaparHtml(String(paciente.nome || ''));

    if (tipoEmissao === 'nota' && !contadorEmail) {
      return json({ error: 'Você não tem e-mail do contador cadastrado em Meu Perfil — não há para quem enviar.' }, 400);
    }
    if (tipoEmissao === 'recibo' && !pacienteEmail && !contadorEmail) {
      return json({ error: 'Este analisante não tem e-mail cadastrado, e você não tem e-mail do contador cadastrado em Meu Perfil — não há para quem enviar.' }, 400);
    }

    let enviadoPaciente = false;
    let enviadoContador = false;
    const erros: string[] = [];
    const periodoTexto = escaparHtml(String(periodo));

    if (tipoEmissao === 'nota') {
      try {
        const cpfTexto = paciente.cpf ? ` (CPF ${escaparHtml(String(paciente.cpf))})` : '';
        const html = mensagemContador
          ? textoParaHtml(mensagemContador)
          : p('Olá.') + p(`Segue o resumo para emissão da nota fiscal referente a <strong>${patientNome}</strong>${cpfTexto}, ${periodoTexto}, no valor de <strong>${formatarMoedaBRL(Number(valor))}</strong>.`) + p(`Solicitação enviada por ${escaparHtml(nomePsicanalista)}. Por favor, emita a nota fiscal e a envie diretamente ao analisante.`);
        await enviarEmail({
          to: contadorEmail!,
          subject: `Emissão de nota fiscal — ${paciente.nome} — ${periodo}`,
          titulo: 'Emissão de nota fiscal',
          html,
          rodape: `Enviado pelo Dr.Sig a pedido de ${escaparHtml(nomePsicanalista)}.`,
        });
        enviadoContador = true;
      } catch (e) {
        erros.push(String((e as Error).message || e));
      }
    } else {
      if (pacienteEmail) {
        try {
          const html = mensagemPaciente
            ? textoParaHtml(mensagemPaciente)
            : p(`Olá, ${patientNome}.`) + p(`Segue em anexo o recibo de prestação de serviços referente a ${periodoTexto}, emitido por ${escaparHtml(nomePsicanalista)}.`);
          await enviarEmail({
            to: pacienteEmail,
            subject: `Seu recibo — ${periodo}`,
            titulo: 'Seu recibo',
            html,
            pdfBase64,
            rodape: `O recibo está em anexo, em PDF. Enviado pelo Dr.Sig a pedido de ${escaparHtml(nomePsicanalista)}.`,
          });
          enviadoPaciente = true;
        } catch (e) {
          erros.push(String((e as Error).message || e));
        }
      }

      if (contadorEmail) {
        try {
          const html = mensagemContador
            ? textoParaHtml(mensagemContador)
            : p(`Segue em anexo o recibo emitido para ${patientNome}, referente a ${periodoTexto}.`);
          await enviarEmail({
            to: contadorEmail,
            subject: `Recibo — ${paciente.nome} — ${periodo}`,
            titulo: `Recibo — ${patientNome}`,
            html,
            pdfBase64,
            rodape: `O recibo está em anexo, em PDF. Enviado pelo Dr.Sig a pedido de ${escaparHtml(nomePsicanalista)}.`,
          });
          enviadoContador = true;
        } catch (e) {
          erros.push(String((e as Error).message || e));
        }
      }
    }

    return json({
      ok: true,
      enviadoPaciente,
      enviadoContador,
      erros,
      // Para a tela dizer PARA ONDE foi, sem precisar adivinhar.
      destinos: { paciente: enviadoPaciente ? pacienteEmail : null, contador: enviadoContador ? contadorEmail : null },
    });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
