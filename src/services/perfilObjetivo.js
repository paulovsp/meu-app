// ─── Perfil Psicossomático — aba Objetivo ─────────────────────────────────
// Agrupa menções objetivas de sono, alimentação, movimento e medicina a
// partir de registros e transcrições — mais simples que os Núcleos
// Psíquicos (sem indicadores/vias/transições), mas segue o mesmo cuidado:
// pseudonimização antes da IA, e trecho literal verificado contra o texto
// de origem antes de aceitar qualquer item.

import { pseudonimizar, reverterPseudonimizacao, chamarGroqJson } from './nucleos';

export const CATEGORIAS_OBJETIVO = [
  { chave: 'sono', label: 'Sono', icon: 'moon-outline' },
  { chave: 'alimentacao', label: 'Alimentação', icon: 'nutrition-outline' },
  { chave: 'movimento', label: 'Movimento', icon: 'walk-outline' },
  { chave: 'medicina', label: 'Medicina', icon: 'medkit-outline' },
];

const CATEGORIAS_VALIDAS = CATEGORIAS_OBJETIVO.map((c) => c.chave);

export function montarPromptObjetivo(textoRegistro) {
  const promptSistema =
    'Você extrai menções OBJETIVAS sobre saúde física do texto de um registro clínico ' +
    '(transcrição de sessão ou anotação). Categorias:\n' +
    '- sono: qualidade/rotina de sono, insônia, pesadelos.\n' +
    '- alimentacao: hábitos alimentares, apetite, peso, nutrição.\n' +
    '- movimento: atividade física, sedentarismo, exercício.\n' +
    '- medicina: medicações em uso, diagnósticos médicos, consultas, exames.\n' +
    'Só marque quando houver menção CLARA e objetiva — não infira a partir de estado emocional ' +
    'nem repita o mesmo fato duas vezes. Na dúvida, não marque. Cite o trecho EXATAMENTE como ' +
    'aparece no texto original (não parafraseie). Responda SOMENTE em JSON, no formato: ' +
    '{"itens": [{"trecho_literal": "...", "categoria": "sono|alimentacao|movimento|medicina"}]}';
  return { promptSistema, promptUsuario: textoRegistro };
}

export async function chamarGroqObjetivo(promptSistema, promptUsuario) {
  return chamarGroqJson(promptSistema, promptUsuario);
}

/** Aceita o item só se o trecho citado existir literalmente no texto de origem. */
export function validarItemObjetivo(itemBruto, textoOriginal) {
  if (!itemBruto || typeof itemBruto.trecho_literal !== 'string') return null;
  const trecho = itemBruto.trecho_literal.trim();
  if (!trecho || !textoOriginal) return null;
  if (textoOriginal.indexOf(trecho) === -1) return null;
  if (!CATEGORIAS_VALIDAS.includes(itemBruto.categoria)) return null;
  return { trecho_literal: trecho, categoria: itemBruto.categoria };
}

/** Roda o motor sobre um texto já pseudonimizado e devolve itens validados. */
export async function analisarTextoObjetivo(conteudoOriginal, paciente) {
  const conteudoPseudonimizado = pseudonimizar(conteudoOriginal, paciente);
  const { promptSistema, promptUsuario } = montarPromptObjetivo(conteudoPseudonimizado);
  const resposta = await chamarGroqObjetivo(promptSistema, promptUsuario);
  const itensBrutos = Array.isArray(resposta?.itens) ? resposta.itens : [];

  return itensBrutos
    .map((bruto) => {
      const trechoRevertido = reverterPseudonimizacao(bruto.trecho_literal || '', paciente);
      return validarItemObjetivo({ ...bruto, trecho_literal: trechoRevertido }, conteudoOriginal);
    })
    .filter(Boolean);
}
