// ─── Rubricas clínicas dos Núcleos Psíquicos ──────────────────────────────
// A rubrica (definições, indicadores, diferenciais, âncoras) mora fora do
// código: o JSON semente em config/nucleos/rubricas.v1.json é a fonte de
// verdade versionada em git, e a rubrica ATIVA fica em uma tabela do banco
// (rubricas_config) — assim dá pra editar sem precisar recompilar o app.
//
// Este arquivo é dividido em duas partes: validação de schema (pura, sem
// nenhuma dependência de banco/rede — testável isoladamente) e carregamento
// (toca o banco, só chamado em runtime real, nunca nos testes).

import rubricaSemente from '../../config/nucleos/rubricas.v1.json';

const NUCLEOS_ESPERADOS = ['bem', 'mal', 'mau', 'bom'];
const INSTANCIAS_ESPERADAS = ['ego', 'id', 'superego', 'superid'];

/**
 * Valida o formato de uma rubrica (mesmo schema do config/nucleos/rubricas.v1.json).
 * Retorna { valido: boolean, erros: string[] }. Nunca lança exceção — quem
 * chama decide o que fazer com uma rubrica inválida (ex: rejeitar edição).
 */
export function validarSchemaRubrica(rubrica) {
  const erros = [];

  if (!rubrica || typeof rubrica !== 'object') {
    return { valido: false, erros: ['Rubrica precisa ser um objeto.'] };
  }
  if (!rubrica.versao) erros.push('Campo "versao" ausente.');
  if (!rubrica.atualizado_em) erros.push('Campo "atualizado_em" ausente.');
  if (!rubrica.nucleos || typeof rubrica.nucleos !== 'object') {
    erros.push('Campo "nucleos" ausente ou inválido.');
  } else {
    for (const chave of NUCLEOS_ESPERADOS) {
      const n = rubrica.nucleos[chave];
      if (!n) { erros.push(`Núcleo "${chave}" ausente.`); continue; }
      if (!n.nome) erros.push(`Núcleo "${chave}" sem "nome".`);
      if (!n.definicao) erros.push(`Núcleo "${chave}" sem "definicao".`);
      if (!Array.isArray(n.indicadores) || n.indicadores.length === 0) {
        erros.push(`Núcleo "${chave}" sem indicadores.`);
      } else {
        n.indicadores.forEach((ind, i) => {
          if (!ind.codigo) erros.push(`Núcleo "${chave}" indicador[${i}] sem "codigo".`);
          if (!ind.descricao) erros.push(`Núcleo "${chave}" indicador[${i}] sem "descricao".`);
        });
      }
    }
  }
  if (!Array.isArray(rubrica.diagonais) || rubrica.diagonais.length === 0) {
    erros.push('Campo "diagonais" ausente ou vazio.');
  }
  if (!rubrica.instancias || typeof rubrica.instancias !== 'object') {
    erros.push('Campo "instancias" ausente ou inválido.');
  } else {
    for (const chave of INSTANCIAS_ESPERADAS) {
      const inst = rubrica.instancias[chave];
      if (!inst) { erros.push(`Instância "${chave}" ausente.`); continue; }
      if (!Array.isArray(inst.nucleos) || inst.nucleos.length !== 3) {
        erros.push(`Instância "${chave}" precisa apontar para exatamente 3 núcleos.`);
      }
      if (!inst.fantasma_exclui) erros.push(`Instância "${chave}" sem "fantasma_exclui".`);
    }
  }
  if (!rubrica.eu_nuclear || !rubrica.eu_nuclear.descricao) {
    erros.push('Campo "eu_nuclear" ausente ou sem descrição.');
  }

  return { valido: erros.length === 0, erros };
}

/** Devolve a lista de códigos de núcleo válidos (bem|mal|mau|bom), mais eu_nuclear. */
export function codigosNucleos(comEuNuclear = true) {
  return comEuNuclear ? [...NUCLEOS_ESPERADOS, 'eu_nuclear'] : [...NUCLEOS_ESPERADOS];
}

/** Dado um núcleo, devolve seu par diagonal (ex: "bem" -> "bom"), ou null. */
export function nucleoDiagonalDe(nucleo, rubrica = rubricaSemente) {
  const par = (rubrica.diagonais || []).find((p) => p.includes(nucleo));
  if (!par) return null;
  return par.find((n) => n !== nucleo) || null;
}

export function getRubricaSemente() {
  return rubricaSemente;
}

/**
 * Rubrica ativa: lê de rubricas_config; se não houver nenhuma linha ainda,
 * semeia com o JSON versionado e devolve. Toca o banco — só usar em runtime,
 * nunca importar isto em teste de lógica pura (por isso o require() é
 * tardio, dentro da função, e não um import no topo do arquivo).
 */
export function carregarRubricaAtiva() {
  const { getRubricaConfigAtiva, salvarRubricaConfig } = require('./database');
  const existente = getRubricaConfigAtiva();
  if (existente) {
    return { ...JSON.parse(existente.conteudo), _versaoSalva: existente.versao };
  }
  salvarRubricaConfig(rubricaSemente.versao, JSON.stringify(rubricaSemente));
  return { ...rubricaSemente, _versaoSalva: rubricaSemente.versao };
}

/** Salva uma nova versão da rubrica como ativa, após validar o schema. */
export function salvarNovaVersaoRubrica(rubrica) {
  const { valido, erros } = validarSchemaRubrica(rubrica);
  if (!valido) {
    throw new Error(`Rubrica inválida: ${erros.join(' ')}`);
  }
  const { salvarRubricaConfig } = require('./database');
  salvarRubricaConfig(rubrica.versao, JSON.stringify(rubrica));
}
