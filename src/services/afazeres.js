import { supabase } from './supabase';
import { tinta, semantica, acento } from '../theme';

/**
 * Formatação de um afazer — tamanho, negrito e cor.
 *
 * As cores saem do tema, não de hexadecimal solto: são as mesmas tintas
 * semânticas que o app já usa sobre papel morno, com contraste conferido.
 * O banco guarda o NOME ('vermelho'), não o valor — quando a paleta mudar,
 * nenhum dado precisa migrar (ver migration 0080).
 */
export const TAMANHOS_AFAZER = {
  p: { fontSize: 13, lineHeight: 20 },
  m: { fontSize: 15, lineHeight: 23 },
  g: { fontSize: 18, lineHeight: 26 },
};

export const CORES_AFAZER = {
  verde:    { label: 'Verde',    valor: semantica.sucesso.tinta },
  ambar:    { label: 'Âmbar',    valor: semantica.atencao.tinta },
  vermelho: { label: 'Vermelho', valor: semantica.erro.tinta },
  azul:     { label: 'Azul',     valor: semantica.info.tinta },
  roxo:     { label: 'Roxo',     valor: acento.busca.tinta },
};

/** Estilo pronto pra um `<Text>`, a partir do que está gravado no afazer.
 *  Um lugar só: a tela de Afazeres e o widget da Início mostram igual. */
export function estiloDoAfazer(afazer) {
  const tamanho = TAMANHOS_AFAZER[afazer?.tamanho] || TAMANHOS_AFAZER.m;
  return {
    ...tamanho,
    fontWeight: afazer?.negrito ? '700' : '400',
    color: CORES_AFAZER[afazer?.cor]?.valor || tinta.t700,
  };
}

/**
 * A ordem é a que a pessoa montou arrastando (coluna `ordem`, migration
 * 0079) — não mais "concluídos no fim, mais recente primeiro".
 *
 * O agrupamento automático por `concluido` saiu de propósito: ele brigava
 * com a organização manual, porque marcar um item como feito o fazia pular
 * de lugar e desmanchar a ordem recém-montada. Concluído fica onde está,
 * riscado. `criado_em` continua como desempate pra fichas que, por algum
 * motivo, tenham ficado sem ordem.
 */
export async function listarAfazeres() {
  const { data, error } = await supabase
    .from('afazeres')
    .select('*')
    .order('ordem', { ascending: true, nullsFirst: false })
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data;
}

/** Novo afazer entra no TOPO — é onde a pessoa acabou de olhar, e onde o
 *  app já o colocava antes. `ordem` menor que qualquer existente. */
export async function adicionarAfazer(texto) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data: primeiro } = await supabase
    .from('afazeres')
    .select('ordem')
    .eq('user_id', session.user.id)
    .order('ordem', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('afazeres')
    .insert({
      user_id: session.user.id,
      texto: texto.trim(),
      ordem: (primeiro?.ordem ?? 1) - 1,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Texto e formatação. Campos ausentes não são tocados — a tela de edição
 *  manda tudo junto, mas isso deixa a função servir pra um ajuste só. */
export async function editarAfazer(id, { texto, tamanho, negrito, cor }) {
  const patch = {};
  if (texto !== undefined) patch.texto = texto.trim();
  if (tamanho !== undefined) patch.tamanho = tamanho;
  if (negrito !== undefined) patch.negrito = !!negrito;
  // `cor: null` é uma escolha válida (voltar ao padrão), diferente de
  // `undefined`, que é "não mexe".
  if (cor !== undefined) patch.cor = cor || null;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('afazeres').update(patch).eq('id', id);
  if (error) throw error;
}

export async function alternarAfazer(id, concluido) {
  const { error } = await supabase
    .from('afazeres')
    .update({ concluido, concluido_em: concluido ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function removerAfazer(id) {
  const { error } = await supabase.from('afazeres').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Grava a lista inteira na ordem recebida, numa transação só.
 *
 * Via RPC e não upsert em massa: upsert do PostgREST foi o que custou seis
 * migrations na integração do WhatsApp antes de virar RPC. Aqui já nasce
 * assim. `ids` é a lista completa, na ordem final.
 */
export async function reordenarAfazeres(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.rpc('reordenar_afazeres', { p_ids: ids });
  if (error) throw error;
}
