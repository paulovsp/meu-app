import { salvarCotacaoCache, getCotacaoCache } from './database';

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

export function getMoeda(codigo) {
  return MOEDAS.find((m) => m.codigo === codigo) || MOEDAS[0];
}

export function formatarValorMoeda(valor, moedaCodigo) {
  const locale = LOCALE_POR_MOEDA[moedaCodigo] || 'pt-BR';
  return (valor || 0).toLocaleString(locale, { style: 'currency', currency: moedaCodigo || 'BRL' });
}

function formatarDataParaBcb(data) {
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const dd = String(data.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${data.getFullYear()}`;
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

  const hoje = new Date();
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 7);

  const url =
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(' +
    'moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
    `?@moeda='${moedaCodigo}'&@dataInicial='${formatarDataParaBcb(seteDiasAtras)}'` +
    `&@dataFinalCotacao='${formatarDataParaBcb(hoje)}'` +
    '&$top=1&$orderby=dataHoraCotacao%20desc&$format=json';

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Banco Central respondeu ${resp.status}`);

  const json = await resp.json();
  const item = json?.value?.[0];
  if (!item) throw new Error('Nenhuma cotação PTAX encontrada nos últimos dias.');

  const media = (item.cotacaoCompra + item.cotacaoVenda) / 2;
  await salvarCotacaoCache(moedaCodigo, media, item.dataHoraCotacao);
  return { valor: media, data: item.dataHoraCotacao };
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
