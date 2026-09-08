// Busca de endereço pelo CEP.
//
// Digitar rua, bairro, cidade e estado é o trecho mais chato de qualquer
// cadastro, e é justamente o que os Correios já sabem. Com o CEP, sobra
// número e complemento — que é a única parte que ninguém pode adivinhar.
//
// ViaCEP: público, sem chave, sem cadastro, mantido há mais de uma década.
// Não exige nada de você além de estar online — e quando não estiver, o
// formulário continua funcionando com os campos preenchidos à mão.
const VIACEP = 'https://viacep.com.br/ws';

/** Só os dígitos, no máximo 8. */
export function apenasDigitosCep(texto) {
  return String(texto || '').replace(/\D/g, '').slice(0, 8);
}

/** "90560001" -> "90560-001", enquanto se digita. */
export function mascararCep(texto) {
  const n = apenasDigitosCep(texto);
  if (n.length <= 5) return n;
  return `${n.slice(0, 5)}-${n.slice(5)}`;
}

export function cepCompleto(texto) {
  return apenasDigitosCep(texto).length === 8;
}

/**
 * Endereço de um CEP, ou null.
 *
 * Devolve `null` em toda situação em que não dá pra afirmar o endereço:
 * CEP incompleto, CEP que não existe, sem internet, serviço fora do ar. O
 * formulário trata os quatro do mesmo jeito — os campos ficam editáveis e
 * a pessoa preenche à mão. Nenhum deles pode impedir um cadastro.
 *
 * O tempo limite é curto de propósito: isto acontece enquanto alguém
 * espera digitando. Melhor desistir em três segundos e deixar preencher à
 * mão do que travar o campo esperando uma resposta que talvez não venha.
 */
export async function buscarEnderecoPorCep(cep) {
  const n = apenasDigitosCep(cep);
  if (n.length !== 8) return null;

  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 3000);
  try {
    const resp = await fetch(`${VIACEP}/${n}/json/`, { signal: controle.signal });
    if (!resp.ok) return null;
    const d = await resp.json();
    // O ViaCEP responde 200 com `{ erro: true }` para CEP inexistente —
    // não é erro de rede, é resposta negativa.
    if (!d || d.erro) return null;
    return {
      cep: mascararCep(n),
      logradouro: d.logradouro || '',
      bairro: d.bairro || '',
      cidade: d.localidade || '',
      uf: d.uf || '',
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(tempo);
  }
}

/** Monta a linha única de endereço que o app já mostra em vários lugares,
 *  a partir das partes. Vazio quando não há nada. */
export function montarEnderecoCompleto({ logradouro, numero, complemento, bairro, cidade, uf, cep }) {
  const rua = [logradouro, numero].filter(Boolean).join(', ');
  const linha1 = [rua, complemento].filter(Boolean).join(' — ');
  const local = [bairro, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
  return [linha1, local, cep].filter(Boolean).join(' · ');
}
