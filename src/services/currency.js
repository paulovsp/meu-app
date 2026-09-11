import { getCotacaoCache } from './database';

// Moedas disponíveis para o preço da sessão, além do Real.
export const MOEDAS = [
  { codigo: 'BRL', nome: 'Real',              simbolo: 'R$'  },
  { codigo: 'USD', nome: 'Dólar Americano',   simbolo: 'US$' },
  { codigo: 'EUR', nome: 'Euro',              simbolo: '€'   },
  { codigo: 'GBP', nome: 'Libra Esterlina',   simbolo: '£'   },
  { codigo: 'AUD', nome: 'Dólar Australiano', simbolo: 'A$'  },
  { codigo: 'CAD', nome: 'Dólar Canadense',   simbolo: 'C$'  },
];

const LOCALE_POR_MOEDA = {
  BRL: 'pt-BR', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', AUD: 'en-AU', CAD: 'en-CA',
};

export function formatarValorMoeda(valor, moedaCodigo) {
  const locale = LOCALE_POR_MOEDA[moedaCodigo] || 'pt-BR';
  return (valor || 0).toLocaleString(locale, { style: 'currency', currency: moedaCodigo || 'BRL' });
}

/**
 * Busca a cotação PTAX oficial (Banco Central do Brasil) mais recente
 * disponível para a moeda informada, dentro dos últimos 7 dias corridos
 * (cobre fins de semana/feriados em que a PTAX não é publicada), e
 * atualiza o cache local usado pelos cálculos financeiros.
 * Lança erro se a rede falhar ou não houver cotação no período.
 */
export async function atualizarCotacao(moedaCodigo) {
  if (!moedaCodigo || moedaCodigo === 'BRL') {
    return { valor: 1, data: null };
  }

  // A busca no Banco Central e a gravacao acontecem no servidor
  // (Edge Function `cotacao-atualizar`), nao aqui.
  //
  // `cotacoes_cache` tem uma linha por moeda e e compartilhada por TODOS os
  // usuarios: e dela que saem as conversoes de preco de sessao nos calculos
  // financeiros de todo mundo. Enquanto o app escrevia direto, qualquer
  // pessoa logada podia gravar a cotacao que quisesse — e o estrago nao
  // ficava na conta dela, ficava no livro-caixa dos outros.
  //
  // Agora o app diz QUAL moeda quer. Quanto ela vale, quem responde e o
  // Banco Central.
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.functions.invoke('cotacao-atualizar', {
    body: { moeda: moedaCodigo },
  });
  if (error) {
    let mensagem = error.message;
    try {
      const corpo = await error.context?.json();
      if (corpo?.error) mensagem = corpo.error;
    } catch (_) {}
    throw new Error(mensagem);
  }
  if (data?.error) throw new Error(data.error);
  return { valor: Number(data?.valor_brl), data: data?.data_cotacao ?? null };
}

/** Última cotação conhecida em cache (pode ser null se nunca buscada). */
export async function getCotacaoCacheada(moedaCodigo) {
  if (!moedaCodigo || moedaCodigo === 'BRL') return null;
  return (await getCotacaoCache(moedaCodigo)) || null;
}

export function formatarDataCotacao(dataCotacaoStr) {
  if (!dataCotacaoStr) return '';
  const data = new Date(dataCotacaoStr.replace(' ', 'T'));
  if (isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR');
}
