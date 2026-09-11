// Instalações do Google Play, lidas do balde de relatórios do Play Console.
//
// O Play não tem API de instalações: publica, uma vez por dia, um CSV por
// mês em `gs://pubsite_prod_<id-do-desenvolvedor>/stats/installs/`. A conta
// de serviço do projeto (a mesma do `eas submit`) entra com a chave guardada
// em GOOGLE_SERVICE_ACCOUNT_B64 e lê só esse prefixo. O relatório atrasa
// até dois dias; por isso cada coleta relê o mês corrente e o anterior e
// grava tudo de novo (é idempotente).

const BALDE = 'pubsite_prod_5102598592269973042';
const PACOTE = 'br.com.drsig.app';

type Chave = { client_email: string; private_key: string };

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemParaDer(pem: string): Uint8Array {
  const corpo = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
}

async function tokenDeLeitura(chave: Chave): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const cabecalho = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const corpo = b64url(enc.encode(JSON.stringify({
    iss: chave.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_only',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 600,
  })));
  const privada = await crypto.subtle.importKey(
    'pkcs8', pemParaDer(chave.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privada, enc.encode(`${cabecalho}.${corpo}`)));
  const jwt = `${cabecalho}.${corpo}.${b64url(assinatura)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`token do Google: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

/** O CSV do Play é UTF-16LE com BOM; a primeira linha é o cabeçalho. */
function decodificarCsv(bytes: ArrayBuffer): string[][] {
  const texto = new TextDecoder('utf-16le').decode(bytes).replace(/^﻿/, '');
  return texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(','));
}

export type InstalacoesDoDia = { dia: string; instalacoes: number };

/**
 * Instalações por dia (dispositivos, "Daily Device Installs") dos meses
 * pedidos. Mês sem relatório ainda (404) é pulado; qualquer outro erro sobe,
 * com a mensagem do Google, para quem chamou decidir o que dizer ao dono.
 */
export async function lerInstalacoes(meses: string[]): Promise<InstalacoesDoDia[]> {
  const b64 = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_B64');
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 não configurado.');
  const chave = JSON.parse(atob(b64)) as Chave;
  const token = await tokenDeLeitura(chave);

  const dias: InstalacoesDoDia[] = [];
  for (const mes of meses) {
    const nome = encodeURIComponent(`stats/installs/installs_${PACOTE}_${mes.replace('-', '')}_overview.csv`);
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BALDE}/o/${nome}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(`relatório ${mes}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const linhas = decodificarCsv(await r.arrayBuffer());
    const cabecalho = linhas[0] || [];
    const colData = cabecalho.indexOf('Date');
    const colInst = cabecalho.indexOf('Daily Device Installs');
    if (colData < 0 || colInst < 0) throw new Error(`relatório ${mes}: colunas inesperadas (${cabecalho.join('|').slice(0, 120)})`);
    for (const l of linhas.slice(1)) {
      const dia = l[colData];
      const n = Number(l[colInst]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && Number.isFinite(n)) dias.push({ dia, instalacoes: n });
    }
  }
  return dias;
}

/** O mês corrente e o anterior, no formato 'AAAA-MM'. */
export function mesesRecentes(): string[] {
  const agora = new Date();
  const m = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [m(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1))), m(agora)];
}
