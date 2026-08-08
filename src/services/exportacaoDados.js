// ─── Exportação de dados (item I.22 — direito de portabilidade da LGPD) ──
// Gera um único arquivo JSON com tudo que pertence ao profissional: os
// próprios dados cadastrais e, de cada analisante sob sua responsabilidade,
// ficha + sessões + registros. Compartilhado via a folha de compartilhar
// nativa (mesmo mecanismo já usado em DetalheRegistroScreen.js pra anexos).
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { listarPacientes, getSessions, getRecords } from './database';

export async function exportarDadosUsuario() {
  const { data: { session } } = await supabase.auth.getSession();
  const { data: perfil, error: erroPerfil } = await supabase
    .from('profiles')
    .select('nome, email, cpf, crp, telefone, pix_key, cidade, uf, created_at')
    .eq('id', session.user.id)
    .single();
  if (erroPerfil) throw erroPerfil;

  const pacientes = await listarPacientes();
  const analisantes = await Promise.all(
    pacientes.map(async (p) => {
      const [sessoes, registros] = await Promise.all([getSessions(p.id), getRecords(p.id)]);
      return { ...p, sessoes, registros };
    })
  );

  const pacote = {
    exportado_em: new Date().toISOString(),
    profissional: perfil,
    analisantes,
  };

  const nomeArquivo = `drsig-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  const uri = `${FileSystem.documentDirectory}${nomeArquivo}`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(pacote, null, 2));

  const disponivel = await Sharing.isAvailableAsync();
  if (disponivel) {
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Exportar meus dados' });
  }
  return uri;
}
