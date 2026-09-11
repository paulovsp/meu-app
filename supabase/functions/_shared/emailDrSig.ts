// ─── O envelope de todo e-mail do Dr.Sig ───────────────────────────────
//
// Sete funções mandam e-mail, e cada uma tinha o seu HTML: Arial num,
// azul-marinho noutro, "Dr.Sig" em negrito aqui e em itálico ali. Quem
// recebia um e-mail de recibo e depois um de recuperação de senha não
// tinha como saber que vinham do mesmo lugar.
//
// Aqui fica a identidade visual do app (src/theme/index.js) traduzida para
// e-mail: papel morno, sálvia, tinta quente, o nome em itálico e o rótulo
// espaçado — o mesmo cabeçalho da tela de entrada e das páginas em
// app.drsig.com.br. Tudo inline e em tabela, porque cliente de e-mail não
// lê folha de estilo nem flexbox.
//
// As funções só dizem o CONTEÚDO: título, parágrafos, um botão. O resto é
// daqui.

const PAPEL_BASE = '#F7F5F0';
const PAPEL_ALTO = '#FDFCFA';
const PAPEL_LINHA = '#EAE5DC';
const PAPEL_VEU = '#F1EDE5';
const TINTA_900 = '#302C28';
const TINTA_700 = '#4E4941';
const TINTA_500 = '#756E66';
const TINTA_400 = '#8C857B';
const SALVIA_TINTA = '#497363';
const SALVIA_FUNDA = '#3A5C4F';
const SALVIA_BASE = '#6B9E8A';
const SALVIA_VEU = '#E4EFE9';

const FONTE = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const REMETENTE = 'Dr.Sig <naoresponda@drsig.com.br>';
export const SITE = 'https://drsig.com.br';
export const CONTATO = 'drsig@drsig.com.br';

/** Escapa texto que entra em HTML. Nome de pessoa, período, valor — tudo
 *  que veio de fora passa por aqui antes de entrar no e-mail. */
export function escaparHtml(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Um parágrafo de corpo. */
export function p(html: string, opcoes: { pequeno?: boolean } = {}): string {
  const tamanho = opcoes.pequeno ? '13px' : '15px';
  const cor = opcoes.pequeno ? TINTA_500 : TINTA_700;
  return `<p style="margin:0 0 14px;font-size:${tamanho};line-height:1.55;color:${cor};">${html}</p>`;
}

/** Subtítulo de seção dentro do e-mail. */
export function h2(texto: string): string {
  return `<h2 style="margin:24px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${SALVIA_FUNDA};">${texto}</h2>`;
}

/** Lista simples. */
export function lista(itens: string[]): string {
  const li = itens.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join('');
  return `<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.5;color:${TINTA_700};">${li}</ul>`;
}

/** Bloco de destaque — o mesmo véu sálvia com filete das páginas. */
export function destaque(html: string): string {
  return `<div style="background:${SALVIA_VEU};border-left:3px solid ${SALVIA_TINTA};padding:12px 16px;border-radius:4px 12px 12px 4px;margin:18px 0;font-size:13.5px;line-height:1.55;color:${TINTA_700};">${html}</div>`;
}

/** O botão. Um por e-mail, no máximo — quem tem dois botões não tem nenhum. */
export function botao(texto: string, href: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto;">
      <tr><td style="border-radius:12px;background:${SALVIA_TINTA};">
        <a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${FONTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${texto}</a>
      </td></tr>
    </table>`;
}

/** Uma imagem de largura total, com cantos do cartão. Sempre com `alt`:
 *  metade dos clientes de e-mail abre com imagens desligadas. */
export function imagem(src: string, alt: string): string {
  return `<img src="${src}" alt="${escaparHtml(alt)}" width="508" style="display:block;width:100%;max-width:508px;height:auto;border-radius:12px;margin:0 0 18px;" />`;
}

/** Passo numerado — para "como começar". */
export function passo(numero: number, titulo: string, texto: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 14px;">
      <tr>
        <td valign="top" style="padding-right:12px;">
          <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:14px;background:${SALVIA_VEU};color:${SALVIA_FUNDA};font-weight:600;font-size:14px;">${numero}</span>
        </td>
        <td valign="top">
          <div style="font-size:15px;font-weight:600;color:${TINTA_900};line-height:1.4;">${titulo}</div>
          <div style="font-size:14px;color:${TINTA_700};line-height:1.5;margin-top:2px;">${texto}</div>
        </td>
      </tr>
    </table>`;
}

/** Tabela de duas colunas (plano × preço, dado × valor). */
export function tabela(linhas: Array<[string, string]>): string {
  const trs = linhas.map(([a, b], i) => `
    <tr style="background:${i % 2 === 0 ? PAPEL_VEU : 'transparent'};">
      <td style="padding:9px 12px;border-bottom:1px solid ${PAPEL_LINHA};font-size:13.5px;color:${TINTA_900};font-weight:600;">${a}</td>
      <td style="padding:9px 12px;border-bottom:1px solid ${PAPEL_LINHA};font-size:13.5px;color:${TINTA_700};">${b}</td>
    </tr>`).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px;">${trs}</table>`;
}

export type OpcoesEnvelope = {
  /** O título grande, logo abaixo da marca. */
  titulo: string;
  /** "Olá, Maria." — opcional. */
  saudacao?: string;
  /** O miolo, já em HTML (use p(), h2(), lista(), destaque(), botao()). */
  corpo: string;
  /** Linha discreta no fim do cartão ("Se não foi você, ignore…"). */
  rodape?: string;
  /** Texto de pré-visualização que os clientes mostram ao lado do assunto. */
  previa?: string;
};

/**
 * Monta o e-mail inteiro.
 *
 * Largura 560, papel morno atrás, cartão claro na frente, marca em cima,
 * assinatura legal embaixo. A marca é a mesma da tela de entrada do app:
 * "Dr.Sig" em itálico sálvia, "O SEU ASSISTENTE CLÍNICO" espaçado.
 */
export function envelope(o: OpcoesEnvelope): string {
  const previa = o.previa
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${PAPEL_BASE};">${escaparHtml(o.previa)}</div>`
    : '';
  const saudacao = o.saudacao
    ? `<p style="margin:0 0 6px;font-size:15px;color:${TINTA_500};">${o.saudacao}</p>`
    : '';
  const rodape = o.rodape
    ? `<p style="margin:26px 0 0;font-size:12.5px;line-height:1.5;color:${TINTA_400};">${o.rodape}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escaparHtml(o.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPEL_BASE};font-family:${FONTE};">
${previa}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${PAPEL_BASE};">
  <tr><td align="center" style="padding:28px 12px 36px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;">
      <tr><td align="center" style="padding:6px 0 18px;">
        <a href="${SITE}" style="text-decoration:none;">
          <span style="display:block;font-family:${FONTE};font-size:34px;line-height:1.1;font-weight:600;font-style:italic;letter-spacing:-0.7px;color:${SALVIA_FUNDA};">Dr.Sig</span>
          <span style="display:block;margin-top:4px;font-family:${FONTE};font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:${SALVIA_BASE};">O seu assistente clínico</span>
        </a>
      </td></tr>
      <tr><td style="height:4px;background:${SALVIA_TINTA};border-radius:4px 4px 0 0;line-height:4px;font-size:4px;">&nbsp;</td></tr>
      <tr><td style="background:${PAPEL_ALTO};border-radius:0 0 18px 18px;padding:28px 26px;border:1px solid ${PAPEL_LINHA};border-top:0;">
        ${saudacao}
        <h1 style="margin:0 0 16px;font-family:${FONTE};font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-0.3px;color:${TINTA_900};">${o.titulo}</h1>
        ${o.corpo}
        ${rodape}
      </td></tr>
      <tr><td style="padding:22px 8px 0;font-family:${FONTE};font-size:12px;line-height:1.6;color:${TINTA_400};text-align:center;">
        Dr.Sig Soluções Digitais · Paulo Von Schwerin Pimentel LTDA · CNPJ 68.542.896/0001-74<br/>
        <a href="${SITE}" style="color:${TINTA_500};">drsig.com.br</a> ·
        <a href="mailto:${CONTATO}" style="color:${TINTA_500};">${CONTATO}</a> ·
        <a href="https://app.drsig.com.br/privacidade.html" style="color:${TINTA_500};">Privacidade</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Envia pela Resend. Lança erro com o motivo quando a API recusa. */
export async function enviarEmail(
  apiKey: string,
  para: string,
  assunto: string,
  html: string,
  anexos?: Array<{ filename: string; content: string }>,
  // Quem deve receber a resposta, quando o e-mail é uma conversa e não um
  // aviso: o remetente é naoresponda@, mas o convite de testador quer que
  // a pessoa simplesmente responda.
  responderPara?: string,
): Promise<void> {
  const corpo: Record<string, unknown> = { from: REMETENTE, to: [para], subject: assunto, html };
  if (anexos?.length) corpo.attachments = anexos;
  if (responderPara) corpo.reply_to = responderPara;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao enviar e-mail para ${para}: ${await resp.text()}`);
  }
}
