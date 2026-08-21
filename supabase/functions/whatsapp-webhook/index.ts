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
// POST -> mensagens recebidas. Só processa mensagens do tipo "image": baixa
//         a mídia da Graph API, roda OCR (mesmo serviço já usado na
//         autorização de gravação), tenta casar o número do remetente com
//         `patients.telefone` do profissional dono daquele phone_number_id,
//         e — só se parecer um comprovante (palavra-chave ou valor
//         detectado) — grava em `whatsapp_comprovantes` como 'pendente'.
// A imagem em si NUNCA é salva — só passa em memória durante esta
// requisição, igual à autorização de gravação. Nunca marca pagamento como
// recebido sozinha: isso é sempre uma confirmação manual da profissional,
// no app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY')!;
// Segredo escolhido por nós (não pela Meta) — cada profissional cola esse
// MESMO valor no campo "Verify Token" ao configurar o webhook na própria
// conta. Só confirma que quem está configurando a subscription passou pelo
// Dr.Sig, não autentica requisições de mensagem em si (essas vêm por HTTPS
// direto da Meta pro endpoint que só nós conhecemos).
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')!;

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

async function baixarImagemBase64(
  mediaId: string,
  accessToken: string
): Promise<{ base64: string; mimeType: string } | null> {
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
  return { base64: base64Encode(buffer), mimeType: meta?.mime_type || 'image/jpeg' };
}

async function extrairTextoDaImagem(imagemBase64: string, mimeType: string): Promise<string> {
  const prefixo = mimeType.includes('png') ? 'data:image/png' : 'data:image/jpeg';
  const form = new FormData();
  form.set('apikey', OCR_SPACE_API_KEY);
  form.set('language', 'por');
  form.set('OCREngine', '2');
  form.set('scale', 'true');
  form.set('base64Image', `${prefixo};base64,${imagemBase64}`);

  const resp = await fetch('https://apipro1.ocr.space/parse/image', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Falha no serviço de OCR (${resp.status}).`);
  const data = await resp.json();
  if (data?.IsErroredOnProcessing) throw new Error(String(data?.ErrorMessage || 'Falha ao processar imagem.'));
  const partes = (data?.ParsedResults || []).map((r: { ParsedText?: string }) => r.ParsedText || '');
  return partes.join('\n');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (modo === 'subscribe' && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return json({ error: 'Verificação falhou.' }, 403);
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  // Sempre responde 200 rápido pro Meta não ficar reenviando o mesmo evento
  // — qualquer falha no processamento fica só no log, não vira erro pro
  // remetente (mesmo espírito do catch-up fiscal automático).
  try {
    const body = await req.json().catch(() => null);
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const entradas = body?.entry || [];
    for (const entrada of entradas) {
      for (const mudanca of entrada?.changes || []) {
        const valor = mudanca?.value;
        const phoneNumberId = valor?.metadata?.phone_number_id;
        const mensagens = valor?.messages || [];
        if (!phoneNumberId || mensagens.length === 0) continue;

        const { data: perfil } = await supabaseAdmin
          .from('profiles')
          .select('id, whatsapp_access_token')
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .maybeSingle();
        if (!perfil?.whatsapp_access_token) continue; // ninguém configurou esse número

        for (const mensagem of mensagens) {
          if (mensagem?.type !== 'image' || !mensagem?.image?.id) continue;

          const imagem = await baixarImagemBase64(mensagem.image.id, perfil.whatsapp_access_token);
          if (!imagem) continue;

          let texto = '';
          try {
            texto = await extrairTextoDaImagem(imagem.base64, imagem.mimeType);
          } catch (e) {
            console.error('[whatsapp-webhook] Falha no OCR:', (e as Error)?.message || e);
            continue;
          }
          if (!texto.trim() || !pareceComprovante(texto)) continue;

          const remetente = String(mensagem.from || '');
          const { data: pacientes } = await supabaseAdmin
            .from('patients')
            .select('id, telefone')
            .eq('user_id', perfil.id)
            .not('telefone', 'is', null);
          const pacienteEncontrado = (pacientes || []).find((p) => telefonesCorrespondem(p.telefone, remetente));

          await supabaseAdmin.from('whatsapp_comprovantes').insert({
            user_id: perfil.id,
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
