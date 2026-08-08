// ─── Emissão fiscal (Recibo ou Nota) por analisante ────────────────────
// Recibo: dinâmica original — gera um PDF no app e o envia por e-mail
// direto ao analisante (e cópia ao contador), via Edge Function
// `enviar-recibo`. Nota: não gera PDF nenhum — manda só um resumo dos
// dados pro contador, que emite a nota fiscal de verdade por fora do app.
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { formatarMoeda } from './database';
import { montarMensagemReciboPaciente, montarMensagemReciboContador, montarMensagemNotaContador } from './mensagens';

// Texto autoral (do profissional) vira o corpo do e-mail — escapa HTML pra
// não quebrar a renderização se ele tiver digitado "<" ou "&", e cada
// quebra de linha vira um parágrafo próprio.
function textoParaHtml(texto) {
  const escapado = (texto || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escapado
    .split('\n').filter((l) => l.trim())
    .map((l) => `<p>${l}</p>`).join('') || `<p>${escapado}</p>`;
}

export const MESES_LABEL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function dataExtenso(data) {
  return `${data.getDate()} de ${MESES_LABEL[data.getMonth()]} de ${data.getFullYear()}`;
}

function isoParaBRCurta(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function composePeriodoMensal(mesLabel, ano) {
  return `no mês de ${mesLabel} de ${ano}`;
}

export function composePeriodoSemana(inicioISO, fimISO) {
  return `na semana de ${isoParaBRCurta(inicioISO)} a ${isoParaBRCurta(fimISO)}`;
}

export function composePeriodoSessao(dataISO) {
  return `na sessão realizada em ${isoParaBRCurta(dataISO)}`;
}

// ─── Recibo de Prestação de Serviços ───────────────────────────────────
// Formato padrão usado por profissionais autônomos no Brasil para que o
// analisante possa deduzir a despesa no Imposto de Renda. Não é uma Nota
// Fiscal Eletrônica (NFS-e) — isso exigiria integração com o sistema da
// prefeitura de cada cidade + certificado digital, fora do escopo do app.
function gerarHtmlRecibo({ profissional, paciente, valor, periodo }) {
  const cpfPacienteTexto = paciente.cpf ? `, CPF nº ${paciente.cpf}` : '';
  const rodapeProfissional = [
    profissional.cpf ? `CPF: ${profissional.cpf}` : null,
    profissional.crp ? `CRP: ${profissional.crp}` : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  // Assinatura desenhada (imagem) só preenche visualmente acima da linha —
  // não substitui o nome/CPF/CRP impressos logo abaixo dela.
  const assinaturaImgHtml = profissional.assinatura
    ? `<img src="${profissional.assinatura}" style="display:block; margin: 0 auto; max-width:220px; max-height:70px;" />`
    : '';

  return `
    <html>
      <head><meta charset="utf-8" /></head>
      <body style="font-family: Helvetica, Arial, sans-serif; padding: 48px; color: #1A1A2E;">
        <h2 style="text-align:center; letter-spacing: 1px;">RECIBO DE PRESTAÇÃO DE SERVIÇOS</h2>

        <p style="margin-top:48px; font-size:16px; line-height:1.8; text-align:justify;">
          Recebi de <strong>${paciente.nome}</strong>${cpfPacienteTexto}, a quantia de
          <strong>${formatarMoeda(valor)}</strong>, referente à prestação de serviços de
          psicoterapia/atendimento psicológico prestados ${periodo}.
        </p>

        <p style="margin-top:64px; font-size:15px;">
          ${profissional.cidade ? `${profissional.cidade} - ${profissional.uf}` : '_______________'}, ${dataExtenso(new Date())}.
        </p>

        <div style="margin-top:80px; text-align:center;">
          ${assinaturaImgHtml}
          <p style="display:inline-block; border-top:1px solid #1A1A2E; padding-top:8px; margin-top:${profissional.assinatura ? '4px' : '0'}; font-size:14px;">
            ${profissional.nome}<br/>
            ${rodapeProfissional}
          </p>
        </div>
      </body>
    </html>
  `;
}

function extrairErroInvoke(error) {
  let mensagem = error.message;
  return (async () => {
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    return mensagem;
  })();
}

/** Gera o PDF do recibo e o envia por e-mail (analisante + cópia ao
 * contador, dois envios independentes). Lança erro se nada puder ser
 * enviado ou se a Edge Function falhar. */
export async function emitirRecibo({ profissional, paciente, valor, periodo }) {
  if (!paciente.email && !profissional?.contador_email) {
    throw new Error('Este analisante não tem e-mail cadastrado, e você não tem e-mail do contador cadastrado em Meu Perfil — não há para quem enviar.');
  }

  const html = gerarHtmlRecibo({ profissional, paciente, valor, periodo });
  const { uri } = await Print.printToFileAsync({ html });
  const pdfBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

  const corpoPacienteHtml = textoParaHtml(montarMensagemReciboPaciente(profissional, { nome: paciente.nome, periodo }));
  const corpoContadorHtml = textoParaHtml(montarMensagemReciboContador(profissional, { nome: paciente.nome, periodo }));

  const { data, error } = await supabase.functions.invoke('enviar-recibo', {
    body: {
      tipo: 'recibo',
      patientEmail: paciente.email || null,
      patientNome: paciente.nome,
      contadorEmail: profissional?.contador_email || null,
      periodo,
      pdfBase64,
      corpoPacienteHtml,
      corpoContadorHtml,
    },
  });
  if (error) throw new Error(await extrairErroInvoke(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Não gera PDF — manda só o resumo dos dados pro contador emitir a nota
 * fiscal de verdade e enviá-la ao analisante por fora do app. */
export async function emitirNota({ profissional, paciente, valor, periodo }) {
  if (!profissional?.contador_email) {
    throw new Error('Você não tem e-mail do contador cadastrado em Meu Perfil — não há para quem enviar a nota.');
  }

  const cpfTexto = paciente.cpf ? ` (CPF ${paciente.cpf})` : '';
  const corpoContadorHtml = textoParaHtml(montarMensagemNotaContador(profissional, {
    nome: paciente.nome, periodo, valor: formatarMoeda(valor), cpfTexto,
  }));

  const { data, error } = await supabase.functions.invoke('enviar-recibo', {
    body: {
      tipo: 'nota',
      patientNome: paciente.nome,
      patientCpf: paciente.cpf || null,
      contadorEmail: profissional.contador_email,
      periodo,
      valor,
      corpoContadorHtml,
    },
  });
  if (error) throw new Error(await extrairErroInvoke(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function emitirParaPaciente(tipo, params) {
  return tipo === 'nota' ? emitirNota(params) : emitirRecibo(params);
}
