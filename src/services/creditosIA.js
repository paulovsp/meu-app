// ─── Créditos de IA ─────────────────────────────────────────────────────
// Saldo (em US$, internamente) que as Edge Functions de IA (ia-transcrever,
// ia-busca) checam e deduzem a cada chamada.
// Exibido em R$ no app (mais familiar) usando a mesma cotação de
// referência fixa da Edge Function `renovar-creditos` — aproximada, só
// pra exibição, não busca cotação ao vivo.
import { supabase } from './supabase';

const TAXA_REFERENCIA_USD_BRL = 5.08;

// Espelha CREDITO_MENSAL_BRL de supabase/functions/renovar-creditos —
// só pra mostrar "quanto vem na próxima renovação" sem precisar
// perguntar ao servidor.
export const PLANOS_CREDITO_MENSAL_BRL = {
  mensal: 20,
  semestral: 30,
  anual: 40,
};

export const PLANO_LABEL = {
  mensal: 'Mensal',
  semestral: 'Semestral',
  anual: 'Anual',
};

// Espelha VALORES_PERMITIDOS_BRL de supabase/functions/mercadopago-criar-checkout-creditos
// — só pra montar as opções no app; a validação de verdade é sempre no
// servidor, não confia em nada que vier do cliente.
export const PACOTES_CREDITO_AVULSO_BRL = [20, 50, 100];

/** Pede um link de checkout do Mercado Pago pra recarga avulsa de créditos
 * de IA — o usuário abre esse link (Linking.openURL) pra pagar. */
export async function criarCheckoutCreditos(valorBRL) {
  const { data, error } = await supabase.functions.invoke('mercadopago-criar-checkout-creditos', {
    body: { valorBRL },
  });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    throw new Error(mensagem);
  }
  return data?.initPoint;
}

export async function getSaldoCreditos(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('creditos_ia')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Erro ao buscar saldo de créditos de IA:', error.message);
    return null;
  }
  return Number(data?.creditos_ia ?? 0);
}

export function usdParaBRL(valorUSD) {
  return (valorUSD || 0) * TAXA_REFERENCIA_USD_BRL;
}

export function formatarSaldoBRL(valorUSD) {
  if (valorUSD == null) return '—';
  return usdParaBRL(valorUSD).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Verifica e aplica a renovação mensal de créditos, conforme o plano da
 * conta. Chamada silenciosamente ao abrir Meu Perfil — se não houver
 * renovação pendente, não faz nada visível.
 */
export async function chamarRenovarCreditos() {
  const { data, error } = await supabase.functions.invoke('renovar-creditos', { body: {} });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    console.error('Erro ao renovar créditos de IA:', mensagem);
    return null;
  }
  return data;
}
