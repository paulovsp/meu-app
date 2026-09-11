// Edge Function: enviar-convite-testador
//
// Registra convites de cortesia (migration 0103) e manda o e-mail de
// boas-vindas aos testadores. Quem chama é o dono, pela linha de comando
// — não há tela no app para isso, e não deve haver: convite é promessa de
// meses de acesso grátis.
//
// Autenticação por segredo próprio no cabeçalho `x-convite-secret`
// (CONVITE_TESTADOR_SECRET), no mesmo espírito do `x-cron-secret` das
// funções agendadas. Deploy com --no-verify-jwt.
//
// Corpo:
//   {
//     emails: string[],          // quem convidar
//     validoAte: 'YYYY-MM-DD',   // até quando a cortesia vale (fim do dia, Brasília)
//     creditosBrl?: number,      // crédito de IA de entrada (padrão 10)
//     previaPara?: string        // se vier, NÃO manda aos convidados: manda um
//                                // único e-mail de amostra para este endereço
//   }
//
// Os convites são registrados sempre — inclusive na prévia — porque a
// cortesia precisa estar pronta antes de a pessoa se cadastrar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { botao, destaque, envelope, enviarEmail, escaparHtml, h2, imagem, lista, p, passo } from '../_shared/emailDrSig.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const CONVITE_SECRET = Deno.env.get('CONVITE_TESTADOR_SECRET')!;

const LINK_PLAY = 'https://play.google.com/store/apps/details?id=br.com.drsig.app';
const RESPONDER_PARA = 'drsig@drsig.com.br';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** O e-mail. `email` aparece no texto porque a cortesia é amarrada a ele:
 *  cadastrar com outro endereço não libera nada. */
function emailDeConvite(email: string, validoAte: string): string {
  const ate = dataBR(validoAte);
  return envelope({
    titulo: 'Você recebeu um convite para testar o Dr.Sig',
    saudacao: 'Olá!',
    previa: `Acesso completo e gratuito até ${ate}, em troca da sua opinião.`,
    corpo:
      imagem('https://app.drsig.com.br/img/convite-hero.png', 'Dr.Sig — o seu assistente clínico')
      + p('O Dr.Sig é um aplicativo feito para quem atende em psicoterapia: a agenda, as fichas dos analisantes, o registro das sessões, a cobrança e os recibos ficam num lugar só — no celular, com sigilo garantido pelo próprio banco de dados.')
      + p('Ele está pronto, e antes de abrir para todo mundo eu queria que um grupo pequeno de colegas usasse de verdade, no dia a dia, e me dissesse o que funciona e o que não funciona. Você é uma dessas pessoas.')
      + destaque(
        `<strong>O seu convite</strong><br/>`
        + `Acesso completo, gratuito, até <strong>${ate}</strong> — com os créditos de IA inclusos (R$ 10 por mês, para transcrição, relatórios e busca). `
        + `Nada é cobrado, não é preciso cadastrar cartão, e nada muda sem você saber. A cortesia está amarrada a este e-mail: <strong>${escaparHtml(email)}</strong>.`,
      )
      + h2('Como começar')
      + passo(1, 'Instale o app', `Android, pela Play Store: <a href="${LINK_PLAY}" style="color:#497363;">Dr.Sig — o seu assistente clínico</a>. Se ainda não aparecer na loja, é porque o Google está terminando a liberação — tente de novo em algumas horas.`)
      + passo(2, 'Crie sua conta com este mesmo e-mail', `Toque em <strong>Criar conta</strong> e use <strong>${escaparHtml(email)}</strong>. A liberação é automática: a conta já nasce com o acesso completo até ${ate}, sem tela de pagamento.`)
      + passo(3, 'Deixe o app te mostrar', 'No primeiro acesso, um roteiro curto mostra o que preencher para o app funcionar inteiro. Se quiser só olhar antes, na tela de entrada há o <strong>Conhecer o app sem criar conta</strong>: um consultório fictício, o do Freud, com fichas, agenda e sessões — somente leitura.')
      + botao('Baixar o Dr.Sig no Google Play', LINK_PLAY)
      + h2('O que dá para fazer')
      + lista([
        '<strong>Agenda</strong> com horários fixos que se repetem sozinhos, faltas e cancelamentos registrados.',
        '<strong>Fichas</strong> de analisantes e supervisionandos, com todo o histórico de cada pessoa.',
        '<strong>Sessões</strong> escritas, ou gravadas e transcritas — só com autorização do analisante, pedida por e-mail pelo próprio app.',
        '<strong>Busca e relatórios</strong>: pergunte em português sobre o histórico de alguém; relatórios de evolução, frequência e pagamento saem prontos.',
        '<strong>Cobrança, financeiro e recibos</strong>: o que está em aberto, o que entrou, e o recibo em PDF direto para o analisante e para o seu contador.',
        '<strong>Cursos</strong>: o histórico da sua formação, com aulas gravadas e transcritas.',
      ])
      + h2('O que peço em troca: sua opinião, sempre')
      + p('Este teste não tem questionário nem prazo para responder. O que eu preciso é do que você notar usando: o que ajudou, o que atrapalhou, o que faltou, o que está confuso, o que você faria diferente. Uma frase já basta.')
      + p(`<strong>É só responder a este e-mail</strong>, quantas vezes quiser, a qualquer hora — a resposta chega direto para mim. Vou devolvendo as novidades por aqui conforme as sugestões entrarem, e cada uma delas fica creditada a quem a fez.`)
      + h2('Duas coisas importantes')
      + p('<strong>Use com dados reais, se quiser.</strong> O app é para isso, e o sigilo é garantido: cada conta só enxerga os próprios analisantes, e a regra é aplicada pelo banco de dados, não pela tela. Você pode exportar tudo e apagar a conta a qualquer momento, pelo próprio app.')
      + p('<strong>Gravar uma sessão depende da autorização do analisante.</strong> O app pede por e-mail a ele, e sem a confirmação não grava — é assim de propósito.', { pequeno: false }),
    rodape: 'Convite pessoal, enviado por Paulo Pimentel. Se você preferir não participar, é só ignorar este e-mail — nada acontece.',
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (!CONVITE_SECRET || req.headers.get('x-convite-secret') !== CONVITE_SECRET) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const emails: string[] = Array.isArray(body?.emails)
      ? body.emails.map((e: unknown) => String(e).trim().toLowerCase()).filter((e: string) => e.includes('@'))
      : [];
    const validoAte = String(body?.validoAte || '');
    if (!emails.length) return json({ error: 'Informe ao menos um e-mail.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validoAte)) return json({ error: 'validoAte precisa ser YYYY-MM-DD.' }, 400);
    const creditosBrl = Number(body?.creditosBrl) > 0 ? Number(body.creditosBrl) : 10;
    const previaPara = body?.previaPara ? String(body.previaPara).trim().toLowerCase() : null;

    // Fim do dia em Brasília: quem é liberado "até 31/12" usa o dia 31.
    const validoAteIso = `${validoAte}T23:59:59-03:00`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Registra (ou renova) o convite. Convite já usado não é reaberto: a
    // conta existe e a cortesia dela se ajusta no perfil, não aqui.
    const registrados: string[] = [];
    for (const email of emails) {
      const { data: existente } = await admin
        .from('convites_cortesia')
        .select('usado_em')
        .eq('email', email)
        .maybeSingle();
      if (existente?.usado_em) continue;
      const { error } = await admin
        .from('convites_cortesia')
        .upsert({ email, valido_ate: validoAteIso, creditos_brl: creditosBrl }, { onConflict: 'email' });
      if (error) return json({ error: `Não consegui registrar ${email}: ${error.message}` }, 500);
      registrados.push(email);
    }

    const enviados: string[] = [];
    const erros: string[] = [];
    const assunto = 'Convite: teste o Dr.Sig com acesso completo';
    const destinos = previaPara ? [previaPara] : emails;
    for (const email of destinos) {
      try {
        await enviarEmail(RESEND_API_KEY, email, assunto, emailDeConvite(email, validoAte), undefined, RESPONDER_PARA);
        enviados.push(email);
      } catch (err) {
        erros.push(`${email}: ${String((err as Error).message || err)}`);
      }
    }

    return json({ ok: true, registrados, enviados, previa: !!previaPara, erros });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
