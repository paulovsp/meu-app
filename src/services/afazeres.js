import { supabase } from './supabase';

export async function listarAfazeres() {
  const { data, error } = await supabase
    .from('afazeres')
    .select('*')
    .order('concluido', { ascending: true })
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data;
}

export async function adicionarAfazer(texto) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('afazeres')
    .insert({ user_id: session.user.id, texto: texto.trim() })
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
