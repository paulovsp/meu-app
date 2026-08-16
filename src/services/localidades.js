// Base oficial de cidades/estados do Brasil (API pública do IBGE) — usada
// pra impedir que o campo Cidade/UF do cadastro vire texto livre (cidade
// inventada, sigla errada etc.). Estados são uma lista fixa (não mudam);
// municípios são buscados por UF na hora e ficam em cache na memória do
// app pra não bater na API de novo toda vez que o mesmo estado é aberto.
const IBGE_MUNICIPIOS_URL = (uf) =>
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;

export const ESTADOS_BR = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
];

const cacheMunicipiosPorUF = new Map();

/** Lista de municípios (nomes) de um estado, em ordem alfabética. */
export async function buscarCidadesPorUF(uf) {
  const siglaUpper = (uf || '').toUpperCase();
  if (cacheMunicipiosPorUF.has(siglaUpper)) {
    return cacheMunicipiosPorUF.get(siglaUpper);
  }
  const resposta = await fetch(IBGE_MUNICIPIOS_URL(siglaUpper));
  if (!resposta.ok) throw new Error('Não foi possível carregar as cidades desse estado.');
  const dados = await resposta.json();
  const nomes = dados.map((m) => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  cacheMunicipiosPorUF.set(siglaUpper, nomes);
  return nomes;
}
