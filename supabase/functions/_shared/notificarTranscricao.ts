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
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RESEND_URL = 'https://api.resend.com/emails';

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
      await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Dr.Sig <naoresponda@drsig.com.br>',
          to: [perfil.email],
          subject: title,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A2E;">
              <h2>${title}</h2>
              <p>${corpo}</p>
              <p>Abra o app Dr.Sig para conferir.</p>
            </div>
          `,
        }),
      });
    } catch (_) {}
  }
}
