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

// Recarga avulsa: link de pagamento do BTG, Pix, sem taxa.
//
// Cada pacote credita mais do que custa — o bônus cresce com o valor, e é
// o que o Pix sem taxa permite devolver. `creditoBRL` é o que entra no
// saldo; `valorBRL` é o que sai do bolso.
//
// ATENÇÃO ao mexer: `link` e `valorBRL` têm que casar. Um link trocado faz
// alguém pagar R$ 100 e receber R$ 25. O valor aparece no botão E na
// página do BTG, então a divergência fica visível antes de pagar — mas o
// lugar de acertar é aqui.
export const PACOTES_CREDITO_AVULSO = [
  { valorBRL: 20,  creditoBRL: 25,  link: 'https://links.btgpactual.com/S4TyflcSY6EuiRk' },
  { valorBRL: 50,  creditoBRL: 70,  link: 'https://links.btgpactual.com/zqdayH1bEaMeneV' },
  { valorBRL: 100, creditoBRL: 150, link: 'https://links.btgpactual.com/fwW-N42ZC1yaUSd' },
];

/** Quanto o pacote devolve a mais, em %, pra dizer isso na tela sem que
 *  ninguém tenha que fazer a conta de cabeça. */
export function bonusDoPacote({ valorBRL, creditoBRL }) {
  return Math.round(((creditoBRL - valorBRL) / valorBRL) * 100);
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
