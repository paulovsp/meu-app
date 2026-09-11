// ─── "Seu acesso termina em X dias" ────────────────────────────────────
//
// Vale só para quem NÃO tem cobrança recorrente: cortesia, período
// concedido à mão, ou acesso gratuito por indicação que deixou de valer.
// Quem tem cartão recorrente não precisa de aviso nenhum — para essa
// pessoa a data que se aproxima não pede ação, e avisar seria assustar à
// toa.
//
// Até agora o único lugar que dizia isso era o cartão dentro do app, que a
// pessoa precisa abrir para ver. Quem não abrisse descobria tentando usar,
// no dia seguinte, com a porta fechada — depois de ter organizado a
// semana contando com o app.
//
// Dois marcos: 7 dias (dá tempo de decidir e resolver) e 1 dia (a última
// chance de não ser pego de surpresa). `aviso_fim_acesso_dias` guarda o
// que já saiu, porque a conferência acorda todo dia e sem isso o mesmo
// aviso sairia sete vezes.
//
// Não passa por preferência de notificação de propósito: isto é
// transacional, da mesma natureza de um recibo. Desligar o aviso de que o
// acesso vai acabar não é uma preferência que sirva a alguém.
import type { Cliente } from './assinaturaMercadoPago.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PAGINA_APP = 'Meu Perfil › Seu plano';

export const MARCOS_DE_AVISO = [7, 1] as const;

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function corpoDoEmail(nome: string, dias: number, dataFim: string): string {
  const quando = dias === 1 ? 'amanhã' : `em ${dias} dias`;
  const saudacao = nome ? `Olá, ${nome.split(' ')[0]}.` : 'Olá.';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #302C28; line-height: 1.55;">
      <h2 style="font-size:19px;margin:0 0 14px;">Seu acesso ao Dr.Sig termina ${quando}</h2>
      <p>${saudacao}</p>
      <p>Em <strong>${dataFim}</strong> sua conta deixa de permitir criar sessões, registros e
      cadastros. Não há cobrança automática nesta conta — nada será debitado, e nada acontece
      sozinho.</p>
      <p><strong>Nada é apagado.</strong> Tudo que você já registrou continua aí, e a exportação
      dos seus dados segue liberada, com ou sem plano.</p>
      <p>Para continuar usando, abra o app em <strong>${PAGINA_APP}</strong> e toque em
      <strong>Receber o link por e-mail</strong> — o link para escolher um plano chega na hora.</p>
      <p style="color:#8A857D;font-size:12.5px;margin-top:26px;">
        Se você já escolheu um plano nas últimas horas, pode ignorar este e-mail.
      </p>
    </div>
  `;
}

async function enviarEmail(para: string, assunto: string, html: string): Promise<boolean> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Dr.Sig <naoresponda@drsig.com.br>',
        to: [para],
        subject: assunto,
        html,
      }),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

async function enviarPush(token: string, titulo: string, corpo: string): Promise<boolean> {
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: token,
        title: titulo,
        body: corpo,
        // Canal 'default': os canais nomeados do app (transcricao, atraso,
        // sessao) sao criados no aparelho quando o app roda, e um canal que
        // nao existe faz o Android engolir a notificacao em silencio. Aviso
        // de fim de acesso nao pode depender disso.
        channelId: 'default',
        sound: 'default',
      }),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

export type ResumoAvisos = { enviados: number; erros: string[] };

/**
 * Avisa quem está prestes a perder o acesso e não tem cobrança recorrente.
 *
 * Idempotente: `aviso_fim_acesso_dias` garante que cada marco sai uma vez
 * só, por mais vezes que esta função rode no mesmo dia.
 */
export async function avisarFimDeAcesso(admin: Cliente): Promise<ResumoAvisos> {
  const resumo: ResumoAvisos = { enviados: 0, erros: [] };

  const agora = new Date();
  const limite = new Date(agora.getTime() + 7 * 86400000);

  // Sem `mp_preapproval_id` é a definição de "não renova sozinho" usada em
  // todo o app, inclusive no cartão do perfil. Um lugar só decidindo isso é
  // o que impede o e-mail dizer uma coisa e a tela dizer outra.
  const { data: contas, error } = await admin
    .from('profiles')
    .select('id, nome, email, assinatura_expira_em, aviso_fim_acesso_dias, expo_push_token')
    .is('mp_preapproval_id', null)
    .in('assinatura_status', ['ativa', 'cortesia'])
    .gt('assinatura_expira_em', agora.toISOString())
    .lte('assinatura_expira_em', limite.toISOString());

  if (error) {
    resumo.erros.push(`consulta: ${error.message}`);
    return resumo;
  }

  for (const conta of contas || []) {
    try {
      const fim = new Date(String(conta.assinatura_expira_em));
      // Dias inteiros até o fim, contados por data e não por horas: quem
      // vence amanhã às 9h e quem vence amanhã às 23h recebem o mesmo
      // "amanhã", que é o que as duas pessoas entendem.
      const soData = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const dias = Math.round((soData(fim) - soData(agora)) / 86400000);

      // O maior marco ainda não enviado que já foi alcançado. Quem instala
      // o app faltando 3 dias recebe o aviso de 7 (o primeiro que cabe),
      // em vez de não receber nenhum.
      const jaEnviado = conta.aviso_fim_acesso_dias;
      const marco = MARCOS_DE_AVISO.find(
        (m) => dias <= m && (jaEnviado == null || m < jaEnviado),
      );
      if (marco == null) continue;

      const dataFim = formatarData(String(conta.assinatura_expira_em));
      const quando = dias <= 1 ? 'amanhã' : `em ${dias} dias`;

      let algumSaiu = false;
      if (conta.email) {
        algumSaiu = await enviarEmail(
          String(conta.email),
          `Seu acesso ao Dr.Sig termina ${quando}`,
          corpoDoEmail(String(conta.nome || ''), dias, dataFim),
        ) || algumSaiu;
      }
      if (conta.expo_push_token) {
        algumSaiu = await enviarPush(
          String(conta.expo_push_token),
          `Seu acesso termina ${quando}`,
          `Em ${dataFim} o app deixa de permitir novos registros. Escolha um plano em ${PAGINA_APP}.`,
        ) || algumSaiu;
      }

      // Só marca como avisado se ALGUM canal saiu. Marcar depois de falhar
      // nos dois seria trocar um aviso repetido por aviso nenhum — e o
      // segundo erro é muito pior que o primeiro.
      if (algumSaiu) {
        await admin
          .from('profiles')
          .update({ aviso_fim_acesso_dias: marco })
          .eq('id', conta.id);
        resumo.enviados++;
      } else {
        resumo.erros.push(`${conta.id}: nenhum canal aceitou o aviso`);
      }
    } catch (err) {
      resumo.erros.push(`${conta.id}: ${String((err as Error)?.message || err)}`);
    }
  }

  return resumo;
}
