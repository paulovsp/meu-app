// Conexão com o WhatsApp Business (API oficial da Meta).
//
// Serve pra uma coisa só: comprovante de pagamento que o analisante manda
// por WhatsApp é lido por OCR e aparece na fila de revisão. NUNCA marca
// pagamento como recebido sozinho — quem confirma é sempre a profissional.
//
// As credenciais ficam em `integracoes_whatsapp`, não em `profiles`
// (migration 0060). O token de acesso e o App Secret são gravados pelo app
// mas NÃO podem ser lidos por ele: o GRANT de leitura exclui essas duas
// colunas. Por isso a tela mostra "configurado" em vez de exibir o valor —
// segredo que a gente guarda não volta pra tela.
import { supabase } from './supabase';
import { SUPABASE_URL } from './supabase';

/** URL que a profissional cola no painel da Meta como webhook. Uma só,
 *  compartilhada por todas as contas: o payload diz de qual número veio. */
export const URL_WEBHOOK = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

/**
 * Garante que existe uma linha para esta profissional e devolve o Verify
 * Token dela.
 *
 * A linha nasce ANTES das credenciais de propósito: na Meta, o webhook é
 * configurado primeiro (e é aí que a Meta chama o handshake conferindo esse
 * token), e só depois a pessoa copia Phone Number ID, token e App Secret.
 */
export async function garantirTokenDeVerificacao() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre de novo.');

  const existente = await getIntegracaoWhatsapp();
  if (existente?.verify_token) return existente.verify_token;

  const { data, error } = await supabase
    .from('integracoes_whatsapp')
    .insert({ user_id: user.id })
    .select('verify_token')
    .single();
  if (error) throw error;
  return data.verify_token;
}

export async function getIntegracaoWhatsapp() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('integracoes_whatsapp')
    .select('phone_number_id, verify_token, conectado_em, invalidado_em, invalidado_motivo')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Grava (ou substitui) as credenciais.
 *
 * O App Secret é obrigatório: é com ele que o servidor confere a assinatura
 * de cada mensagem que a Meta envia. Sem ele, a Edge Function recusa tudo —
 * e é isso mesmo que deve acontecer, porque sem conferir assinatura
 * qualquer um poderia injetar um comprovante falso na fila.
 */
export async function conectarWhatsapp({ phoneNumberId, accessToken, appSecret }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre de novo.');
  if (!phoneNumberId?.trim()) throw new Error('Informe o Phone Number ID.');
  if (!accessToken?.trim()) throw new Error('Informe o token de acesso.');
  if (!appSecret?.trim()) {
    throw new Error(
      'Informe o App Secret. Ele é o que permite ao servidor conferir que a '
      + 'mensagem veio mesmo da Meta — sem isso, nenhum comprovante é aceito.'
    );
  }

  // Grava por função, não por upsert direto na tabela.
  //
  // O upsert falhava com "permission denied for table integracoes_whatsapp"
  // e resistiu a tudo que foi medido em 06/09/2026: os privilégios de
  // INSERT e UPDATE existem em todas as colunas pra `authenticated`, a
  // sessão é válida (a mesma escreve em outras tabelas), o cache do
  // PostgREST foi recarregado, e esta mesma tela INSERE aqui sem problema
  // em `garantirTokenDeVerificacao`. Só o upsert era recusado.
  //
  // A função `salvar_integracao_whatsapp` (migration 0073) faz a mesma
  // coisa com privilégio próprio e confere `auth.uid()` lá dentro — a
  // garantia de não escrever na linha alheia continua, só saiu da RLS pra
  // dentro da função.
  const { error } = await supabase.rpc('salvar_integracao_whatsapp', {
    p_phone_number_id: phoneNumberId.trim(),
    p_access_token: accessToken.trim(),
    p_app_secret: appSecret.trim(),
  });
  if (error) throw error;
}

export async function desconectarWhatsapp() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('integracoes_whatsapp').delete().eq('user_id', user.id);
  if (error) throw error;
}
