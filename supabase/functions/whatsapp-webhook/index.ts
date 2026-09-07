// Edge Function: whatsapp-webhook (item 13, v13 — opcional)
// Uma única função, compartilhada por todas as contas que configurarem ela
// como webhook — cada profissional cola essa mesma URL no painel da PRÓPRIA
// conta Meta Business; o payload que chega diz o `phone_number_id` de quem
// recebeu, e é por ele que achamos de qual profissional (linha em
// `profiles`) se trata. Pública (deploy com --no-verify-jwt), como
// mercadopago-webhook — quem chama é a Meta, sem JWT de usuário.
//
// GET  -> handshake de verificação do webhook (Meta exige isso ao
//         configurar a subscription: confere hub.verify_token contra o
//         segredo compartilhado e ecoa hub.challenge de volta).
// POST -> mensagens recebidas. Processa foto E documento: baixa a mídia da
//         Graph API, roda OCR (mesmo serviço já usado na autorização de
//         gravação), tenta casar o número do remetente com
//         `patients.telefone` do profissional dono daquele phone_number_id,
//         e — só se parecer um comprovante (palavra-chave ou valor
//         detectado) — grava em `whatsapp_comprovantes` como 'pendente'.
//
//         Documento entrou em 07/09/2026 porque a maioria dos bancos manda
//         o comprovante em PDF, não em foto — essas mensagens vinham sendo
//         descartadas em silêncio, e o comprovante chegava no WhatsApp da
//         profissional sem nunca aparecer no app.
//
// O arquivo em si NUNCA é salvo — só passa em memória durante esta
// requisição, igual à autorização de gravação. Nunca marca pagamento como
// recebido sozinha: isso é sempre uma confirmação manual da profissional,
// no app.
//
// ── Autenticidade (corrigido em 05/09/2026) ──────────────────────────────
// Antes, esta função aceitava qualquer POST. A justificativa no código era
// que o endereço "só nós conhecemos" — mas ele é EXIBIDO na tela de Apps
// conectados para toda profissional que configura o WhatsApp. Ou seja:
// qualquer pessoa que conhecesse a URL e um phone_number_id podia injetar
// comprovantes falsos na fila de alguém, e comprovante confirmado vira
// pagamento marcado como recebido. Agora cada requisição precisa trazer o
// X-Hub-Signature-256 que a Meta calcula com o App Secret — e o App Secret
// é de cada profissional, guardado em `integracoes_whatsapp` numa coluna
// que o app nem consegue ler.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assinaturaMetaConfere } from '../_shared/assinaturaMeta.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY')!;
// O Verify Token do handshake é POR PROFISSIONAL, gerado pelo banco e
// mostrado na tela de conexão (migration 0061). Antes era um só,
// compartilhado por todas as contas e passado "pelo suporte" — o que
// impedia qualquer pessoa de concluir a configuração sozinha.

const GRAPH_API_VERSION = 'v21.0';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function normalizarDigitos(texto: string): string {
  return (texto || '').replace(/\D/g, '');
}

// Tolera diferença de código de país (compara pelo sufixo, exige pelo
// menos 8 dígitos em comum — DDD + número local, sem o "9" na frente).
function telefonesCorrespondem(a: string, b: string): boolean {
  const da = normalizarDigitos(a);
  const db = normalizarDigitos(b);
  if (!da || !db) return false;
  const [curto, longo] = da.length <= db.length ? [da, db] : [db, da];
  return curto.length >= 8 && longo.endsWith(curto);
}

function extrairValor(texto: string): number | null {
  const match = texto.match(/R\$\s*([\d.]{1,7},\d{2}|\d+,\d{2}|\d+)/i);
  if (!match) return null;
  const valor = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(valor) ? null : valor;
}

function pareceComprovante(texto: string): boolean {
  const normalizado = texto.toLowerCase();
  const palavrasChave = ['pix', 'comprovante', 'transfer', 'recibo', 'pagamento', 'valor'];
  return palavrasChave.some((p) => normalizado.includes(p)) || extrairValor(texto) !== null;
}

// Limite do OCR.space: 1 MB por arquivo no plano gratuito. Comprovante de
// banco fica muito abaixo disso (PDF de uma página, ~50-200 KB), mas quem
// fotografa a tela em 12 MP estoura fácil — e sem esta checagem o serviço
// devolve um erro genérico que não diz o que houve.
const TAMANHO_MAXIMO_OCR_BYTES = 1024 * 1024;

async function baixarMidiaBase64(
  mediaId: string,
  accessToken: string
): Promise<{ base64: string; mimeType: string; bytes: number } | null> {
  const metaResp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaResp.ok) return null;
  const meta = await metaResp.json();
  const url = meta?.url;
  if (!url) return null;

  const midiaResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!midiaResp.ok) return null;
  const buffer = new Uint8Array(await midiaResp.arrayBuffer());
  return {
    base64: base64Encode(buffer),
    mimeType: meta?.mime_type || 'image/jpeg',
    bytes: buffer.byteLength,
  };
}

/** O comprovante que o banco manda quase nunca é foto: é PDF. Aceitar só
 *  imagem deixava de fora a forma mais comum de comprovante que existe. */
function ehPdf(mimeType: string): boolean {
  return (mimeType || '').toLowerCase().includes('pdf');
}

/** Tipos que vale a pena tentar ler. Documento pode chegar como PDF (o
 *  caso do banco) ou como imagem — alguns aparelhos mandam a foto da
 *  galeria como "documento" em vez de "imagem". */
function midiaLegivel(mimeType: string): boolean {
  const m = (mimeType || '').toLowerCase();
  return ehPdf(m) || m.startsWith('image/');
}

/**
 * Texto de um comprovante, seja ele foto ou PDF.
 *
 * O OCR.space lê os dois; o que muda é o prefixo do data-URI e o
 * `filetype`, que para PDF precisa ser explícito — sem ele o serviço tenta
 * interpretar o conteúdo como imagem e falha.
 *
 * `OCREngine 2` (o que já era usado) não aceita PDF; o motor 1 aceita. Por
 * isso a escolha do motor passa a depender do tipo de arquivo, e não é
 * detalhe: mandar PDF no motor 2 volta como "erro ao processar", que é
 * indistinguível de um comprovante ilegível.
 */
async function extrairTexto(base64: string, mimeType: string): Promise<string> {
  const pdf = ehPdf(mimeType);
  const prefixo = pdf
    ? 'data:application/pdf'
    : (mimeType.includes('png') ? 'data:image/png' : 'data:image/jpeg');

  const form = new FormData();
  form.set('apikey', OCR_SPACE_API_KEY);
  form.set('language', 'por');
  form.set('OCREngine', pdf ? '1' : '2');
  form.set('scale', 'true');
  if (pdf) form.set('filetype', 'PDF');
  form.set('base64Image', `${prefixo};base64,${base64}`);

  const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Falha no serviço de OCR (${resp.status}).`);
  const data = await resp.json();
  if (data?.IsErroredOnProcessing) throw new Error(String(data?.ErrorMessage || 'Falha ao processar imagem.'));
  const partes = (data?.ParsedResults || []).map((r: { ParsedText?: string }) => r.ParsedText || '');
  return partes.join('\n');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Handshake de verificação do webhook. Acontece ANTES de a pessoa ter as
  // credenciais em mãos: ela configura o webhook na Meta primeiro e só
  // depois copia Phone Number ID e tokens. Por isso a identificação aqui é
  // pelo verify_token, que a tela já mostrou pra ela copiar.
  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (modo !== 'subscribe' || !token || !challenge) {
      return json({ error: 'Verificação falhou.' }, 403);
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: dono } = await supabaseAdmin
      .from('integracoes_whatsapp')
      .select('user_id')
      .eq('verify_token', token)
      .maybeSingle();
    if (!dono) return json({ error: 'Verificação falhou.' }, 403);
    return new Response(challenge, { status: 200 });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  // Sempre responde 200 rápido pro Meta não ficar reenviando o mesmo evento
  // — qualquer falha no processamento fica só no log, não vira erro pro
  // remetente (mesmo espírito do catch-up fiscal automático).
  try {
    // Lido como TEXTO: a assinatura da Meta é calculada sobre o corpo bruto,
    // então re-serializar o JSON invalidaria a conferência.
    const corpoBruto = await req.text();
    const body = JSON.parse(corpoBruto || 'null');
    const assinaturaRecebida = req.headers.get('x-hub-signature-256');
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const entradas = body?.entry || [];
    for (const entrada of entradas) {
      for (const mudanca of entrada?.changes || []) {
        const valor = mudanca?.value;
        const phoneNumberId = valor?.metadata?.phone_number_id;
        const mensagens = valor?.messages || [];
        if (!phoneNumberId || mensagens.length === 0) continue;

        const { data: integracao } = await supabaseAdmin
          .from('integracoes_whatsapp')
          .select('user_id, access_token, app_secret')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle();
        if (!integracao?.access_token) continue; // ninguém configurou esse número

        // O phone_number_id vem do corpo, que é justamente o que se quer
        // provar — por isso a ordem é: descobrir de quem seria, e só então
        // exigir a assinatura feita com o segredo DESSA conta. Quem não tem
        // o segredo não consegue forjar, escolha o número que escolher.
        if (!(await assinaturaMetaConfere(assinaturaRecebida, corpoBruto, integracao.app_secret))) {
          console.error('[whatsapp-webhook] Assinatura inválida ou App Secret ausente para', phoneNumberId);
          continue;
        }

        for (const mensagem of mensagens) {
          // Foto OU documento. A maioria dos bancos manda o comprovante em
          // PDF, e até aqui essas mensagens eram descartadas em silêncio —
          // o comprovante chegava no WhatsApp e nunca aparecia no app.
          const anexo = mensagem?.type === 'image'
            ? mensagem.image
            : (mensagem?.type === 'document' ? mensagem.document : null);
          if (!anexo?.id) continue;
          // O `mime_type` do próprio evento evita baixar um .docx ou um
          // .zip só pra descobrir depois que não dá pra ler.
          if (anexo.mime_type && !midiaLegivel(anexo.mime_type)) continue;

          const arquivo = await baixarMidiaBase64(anexo.id, integracao.access_token);
          if (!arquivo) continue;
          if (!midiaLegivel(arquivo.mimeType)) continue;
          if (arquivo.bytes > TAMANHO_MAXIMO_OCR_BYTES) {
            console.error(
              `[whatsapp-webhook] Arquivo grande demais pro OCR: ${arquivo.bytes} bytes (${arquivo.mimeType})`,
            );
            continue;
          }

          let texto = '';
          try {
            texto = await extrairTexto(arquivo.base64, arquivo.mimeType);
          } catch (e) {
            console.error('[whatsapp-webhook] Falha no OCR:', (e as Error)?.message || e);
            continue;
          }
          if (!texto.trim() || !pareceComprovante(texto)) continue;

          const remetente = String(mensagem.from || '');
          const { data: pacientes } = await supabaseAdmin
            .from('patients')
            .select('id, telefone')
            .eq('user_id', integracao.user_id)
            .not('telefone', 'is', null);
          const pacienteEncontrado = (pacientes || []).find((p) => telefonesCorrespondem(p.telefone, remetente));

          await supabaseAdmin.from('whatsapp_comprovantes').insert({
            user_id: integracao.user_id,
            patient_id: pacienteEncontrado?.id ?? null,
            telefone_remetente: remetente,
            texto_extraido: texto.trim().slice(0, 2000),
            valor_detectado: extrairValor(texto),
            status: 'pendente',
          });
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp-webhook] Erro:', (err as Error)?.message || err);
  }

  return json({ received: true });
});
