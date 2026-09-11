// Edge Function: resend-webhook
//
// O que a Resend sabe e a gente não sabia: e-mail que voltou (bounce),
// e-mail marcado como spam, e — quando o recebimento estiver ligado — os
// e-mails que as usuárias mandam para drsig@ em resposta aos nossos.
//
// Bounce e reclamação viram evento em op_eventos (o Vigia vê). E-mail
// recebido vira linha em op_feedbacks (o Zelador triagem).
//
// Pública (--no-verify-jwt): quem chama é a Resend. A autenticidade é a
// assinatura Svix no cabeçalho (`svix-id`, `svix-timestamp`,
// `svix-signature`), verificada com RESEND_WEBHOOK_SECRET — o segredo que
// o painel da Resend mostra ao criar o webhook. Sem segredo configurado,
// a função recusa tudo: um endpoint que aceita qualquer POST e escreve em
// tabela seria uma porta para encher o Vigia de ruído.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { registrarEvento, servir } from '../_shared/registrarEvento.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Padrão Standard Webhooks (Svix): HMAC-SHA256 de "id.timestamp.payload"
// com o segredo (base64, depois do prefixo "whsec_").
async function assinaturaValida(payload: string, headers: Headers): Promise<boolean> {
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sig = headers.get('svix-signature');
  if (!id || !ts || !sig || !WEBHOOK_SECRET) return false;
  // Rejeita o que tem mais de 5 minutos: replay de uma notificação antiga.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const chave = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(WEBHOOK_SECRET.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const esperado = bytesToBase64(new Uint8Array(
    await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${id}.${ts}.${payload}`)),
  ));
  return sig.split(' ').map((p) => p.split(',')[1]).includes(esperado);
}

Deno.serve(servir('resend-webhook', async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const payload = await req.text();
  if (!(await assinaturaValida(payload, req.headers).catch(() => false))) {
    return json({ error: 'Assinatura inválida.' }, 401);
  }

  const evento = JSON.parse(payload);
  const tipo = String(evento?.type || '');
  const dados = evento?.data || {};
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (tipo === 'email.bounced' || tipo === 'email.complained' || tipo === 'email.delivery_delayed') {
    await registrarEvento('resend', tipo === 'email.complained' ? 'erro' : 'aviso', `${tipo}: ${(dados.to || []).join(', ')}`, {
      assunto: dados.subject,
      motivo: dados?.bounce?.message ?? dados?.bounce?.type ?? null,
      email_id: dados.email_id,
    });
    return json({ ok: true });
  }

  if (tipo === 'email.received') {
    // O evento traz só o id; o conteúdo vem da API de recebimento.
    const resp = await fetch(`https://api.resend.com/emails/receiving/${dados.email_id}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    const email = resp.ok ? await resp.json() : null;
    const de = String(email?.from || dados.from || '');
    const nome = de.includes('<') ? de.split('<')[0].trim().replace(/^"|"$/g, '') : null;
    const endereco = de.includes('<') ? de.split('<')[1].replace('>', '').trim() : de;
    await admin.from('op_feedbacks').insert({
      canal: 'email',
      de_email: endereco || null,
      de_nome: nome,
      assunto: email?.subject ?? dados.subject ?? null,
      corpo: String(email?.text || email?.html || '(sem corpo)').slice(0, 20000),
    });
    return json({ ok: true });
  }

  return json({ ok: true, ignorado: tipo });
}));
