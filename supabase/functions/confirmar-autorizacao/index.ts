// Edge Function: confirmar-autorizacao
// API JSON pura (sem servir HTML) — o Supabase reescreve à força qualquer
// resposta text/html pra text/plain e trava com uma CSP "sandbox" no
// domínio padrão dele (proteção deles contra phishing), então a página que
// o analisante vê fica hospedada fora daqui, no GitHub Pages
// (docs/autorizacao.html), que chama esta função via fetch(). Aqui só
// valida token/documento e atualiza o status; não renderiza nada visual.
//
// GET  ?token=xxx        -> estado atual da solicitação (pra a página
//                           decidir se mostra o passo de upload ou uma
//                           mensagem).
// POST ?token=xxx  body: { acao: 'negar' }
//                     ou: { acao: 'autorizar', imagemBase64, mimeType }
//
// A2: em vez de o analisante digitar nome/CPF/nascimento (dados que a
// própria profissional cadastrou e portanto conhece — não provam que quem
// está respondendo é de fato o analisante), agora ele envia uma foto de um
// documento com foto (RG, CNH ou passaporte). O CPF é extraído por OCR e
// comparado: precisa bater com o CPF do analisante cadastrado, e NÃO pode
// bater com o CPF da própria profissional (bloqueio automático contra
// autoautorização). A imagem passa só na memória desta requisição — nunca
// é salva em disco, banco ou Storage; só o resultado (aprovado/rejeitado),
// a data/hora e o método de verificação ficam registrados, em
// `autorizacoes_transcricao` (colunas `metodo_verificacao`/`motivo_rejeicao`,
// migration 0034).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Tamanho máximo aceito pro upload (bytes, já em base64). A página cliente
// redimensiona a foto antes de enviar, mas essa checagem é a garantia do
// lado do servidor.
const MAX_IMAGEM_BASE64_CHARS = 6_000_000; // ~4.5MB de imagem original

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function normalizarTexto(texto: string) {
  return (texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function normalizarCpf(texto: string) {
  return (texto || '').replace(/\D/g, '');
}

// CPF tem 11 dígitos, geralmente impresso como 000.000.000-00 em RG/CNH.
// Passaporte não tem CPF — nesse caso o regex simplesmente não acha nada,
// e o código cai no fallback por nome (ver extrairResultadoOcr).
function extrairCpfDoTexto(texto: string): string | null {
  const match = texto.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  return match ? normalizarCpf(match[0]) : null;
}

async function extrairTextoDoDocumento(imagemBase64: string, mimeType: string): Promise<string> {
  const prefixo = mimeType === 'application/pdf' ? 'data:application/pdf' : 'data:image/jpeg';
  const form = new FormData();
  form.set('apikey', OCR_SPACE_API_KEY);
  form.set('language', 'por');
  form.set('OCREngine', '2');
  form.set('scale', 'true');
  form.set('base64Image', `${prefixo};base64,${imagemBase64}`);

  const resp = await fetch('https://apipro1.ocr.space/parse/image', { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error(`Falha no serviço de OCR (${resp.status}).`);
  }
  const data = await resp.json();
  if (data?.IsErroredOnProcessing) {
    throw new Error(String(data?.ErrorMessage || 'Falha ao processar o documento.'));
  }
  const partes = (data?.ParsedResults || []).map((r: { ParsedText?: string }) => r.ParsedText || '');
  return partes.join('\n');
}

type ResultadoVerificacao =
  | { ok: true; metodo: 'documento_ocr' | 'documento_ocr_nome' }
  | { ok: false; motivo: 'cpf_do_profissional' | 'cpf_nao_confere' | 'documento_ilegivel' };

async function verificarDocumento(
  textoOcr: string,
  patientCpf: string,
  patientNome: string,
  cpfProfissional: string | null
): Promise<ResultadoVerificacao> {
  const cpfEncontrado = extrairCpfDoTexto(textoOcr);

  if (cpfEncontrado) {
    if (cpfProfissional && cpfEncontrado === normalizarCpf(cpfProfissional)) {
      return { ok: false, motivo: 'cpf_do_profissional' };
    }
    if (cpfEncontrado === normalizarCpf(patientCpf)) {
      return { ok: true, metodo: 'documento_ocr' };
    }
    return { ok: false, motivo: 'cpf_nao_confere' };
  }

  // Sem CPF legível (ex.: passaporte, ou foto de baixa qualidade) — aceita
  // como sinal mais fraco se o nome do analisante aparece no texto extraído.
  const textoNormalizado = normalizarTexto(textoOcr);
  const nomeNormalizado = normalizarTexto(patientNome);
  const sobrenomes = nomeNormalizado.split(/\s+/).filter((p) => p.length > 2);
  const nomeEncontrado = sobrenomes.length > 0 && sobrenomes.every((parte) => textoNormalizado.includes(parte));

  if (nomeEncontrado) {
    return { ok: true, metodo: 'documento_ocr_nome' };
  }

  return { ok: false, motivo: 'documento_ilegivel' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (!token) {
    return json({ state: 'invalid' }, 400);
  }

  const { data: solicitacao } = await supabaseAdmin
    .from('autorizacoes_transcricao')
    .select('*')
    .eq('token', token)
    .single();

  if (!solicitacao) {
    return json({ state: 'invalid' }, 404);
  }

  if (solicitacao.status === 'autorizada') {
    return json({ state: 'already_authorized' });
  }
  if (solicitacao.status === 'negada') {
    return json({ state: 'already_denied' });
  }
  if (new Date(solicitacao.expira_em) < new Date()) {
    return json({ state: 'expired' }, 410);
  }
  if (solicitacao.tentativas >= 5) {
    return json({ state: 'locked' }, 403);
  }

  if (req.method === 'GET') {
    return json({ state: 'form' });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const acao = body?.acao;

    if (acao === 'negar') {
      await supabaseAdmin
        .from('autorizacoes_transcricao')
        .update({ status: 'negada', respondido_em: new Date().toISOString() })
        .eq('token', token);
      return json({ state: 'denied' });
    }

    const imagemBase64 = String(body?.imagemBase64 || '');
    const mimeType = String(body?.mimeType || 'image/jpeg');
    if (!imagemBase64) {
      return json({ state: 'mismatch', erro: 'Envie a foto do documento.' });
    }
    if (imagemBase64.length > MAX_IMAGEM_BASE64_CHARS) {
      return json({ state: 'mismatch', erro: 'Arquivo muito grande. Tente uma foto mais leve.' });
    }

    const { data: perfilProfissional } = await supabaseAdmin
      .from('profiles')
      .select('cpf')
      .eq('id', solicitacao.user_id)
      .single();

    let resultado: ResultadoVerificacao;
    try {
      const textoOcr = await extrairTextoDoDocumento(imagemBase64, mimeType);
      resultado = await verificarDocumento(
        textoOcr,
        solicitacao.patient_cpf,
        solicitacao.patient_nome,
        perfilProfissional?.cpf ?? null
      );
    } catch (err) {
      // Falha do serviço de OCR não é uma tentativa "errada" do analisante
      // (não é ele quem falhou) — não conta pro limite de 5 tentativas.
      return json({
        state: 'mismatch',
        erro: 'Não conseguimos ler o documento agora. Tente novamente em instantes.',
        detalhe: String(err?.message || err),
      });
    }

    if (resultado.ok) {
      await supabaseAdmin
        .from('autorizacoes_transcricao')
        .update({
          status: 'autorizada',
          respondido_em: new Date().toISOString(),
          metodo_verificacao: resultado.metodo,
          motivo_rejeicao: null,
        })
        .eq('token', token);
      return json({ state: 'authorized' });
    }

    // Documento da própria profissional: bloqueia na hora (não deixa
    // esgotar as 5 tentativas tentando outra foto) — é o sinal mais forte
    // de autoautorização que a A2 existe pra impedir.
    const bloqueioImediato = resultado.motivo === 'cpf_do_profissional';
    const novasTentativas = bloqueioImediato ? 5 : solicitacao.tentativas + 1;

    await supabaseAdmin
      .from('autorizacoes_transcricao')
      .update({ tentativas: novasTentativas, motivo_rejeicao: resultado.motivo })
      .eq('token', token);

    return json({
      state: novasTentativas >= 5 ? 'locked' : 'mismatch',
      motivo: resultado.motivo,
      tentativasRestantes: Math.max(0, 5 - novasTentativas),
    });
  }

  return json({ state: 'method_not_allowed' }, 405);
});
