import { supabase } from './supabase';

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
