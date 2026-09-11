// Aviso de transcrição — push e e-mail, nas duas vias, para qualquer origem.
//
// Existe porque a mesma notificação estava escrita em vários lugares, e as
// cópias divergiram: o webhook da AssemblyAI mandava push E e-mail, enquanto
// as buscas periódicas do Meet e do Zoom só mandavam push. Quem usa aviso por
// e-mail simplesmente não era avisado das sessões feitas pelo Meet — sem erro
// em lugar nenhum, porque cada função "funcionava" isoladamente.
//
// Push e e-mail são reforço: o status também aparece ao abrir a sessão. Por
// isso nenhuma falha aqui pode derrubar o fluxo de quem chamou.
import { envelope, enviarEmail, escaparHtml, p } from './emailDrSig.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function notificarTranscricao(
  admin: any,
  userId: string | undefined,
  sessionId: string,
  title: string,
  corpo: string,
) {
  if (!userId) return;

  let perfil: any = null;
  try {
    const { data } = await admin
      .from('profiles')
      .select('email, expo_push_token, notif_transcricao_push, notif_transcricao_email')
      .eq('id', userId)
      .single();
    perfil = data;
  } catch (_) {
    return;
  }
  if (!perfil) return;

  if (perfil.notif_transcricao_push !== false && perfil.expo_push_token) {
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: perfil.expo_push_token,
          title,
          body: corpo,
          channelId: 'transcricao',
          data: { sessionId },
        }),
      });
    } catch (_) {}
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (perfil.notif_transcricao_email === true && perfil.email && resendKey) {
    try {
      await enviarEmail(resendKey, perfil.email, title, envelope({
        titulo: escaparHtml(title),
        corpo: p(escaparHtml(corpo)) + p('Abra o app Dr.Sig para conferir.', { pequeno: true }),
        rodape: 'Você recebe este aviso porque ligou o e-mail de transcrição em Meu Perfil › Notificações.',
      }));
    } catch (_) {}
  }
}
