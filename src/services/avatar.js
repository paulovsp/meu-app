import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Lê a foto escolhida como bytes. No celular a foto é um arquivo do
// aparelho; na versão de computador é um endereço do próprio navegador
// (blob: ou data:), que se lê com fetch.
async function lerFoto(uri) {
  if (Platform.OS === 'web') {
    const resposta = await fetch(uri);
    return resposta.arrayBuffer();
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return decode(base64);
}

/** Envia a foto de perfil pro Storage (bucket "avatars", sempre no path
 * "<user_id>/avatar.jpg" — cada profissional só pode escrever no próprio,
 * ver migration 0028) e grava a URL pública em profiles.avatar_url.
 * Retorna a URL nova, já pronta pra usar em <Image source={{ uri }}>. */
export async function enviarFotoPerfil(uri) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session.user.id;
  const path = `${userId}/avatar.jpg`;

  const bytes = await lerFoto(uri);
  const { error: erroUpload } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (erroUpload) throw erroUpload;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-busting: o path não muda quando a foto é trocada, então sem um
  // parâmetro diferente na URL o cache de imagem do RN continuaria
  // mostrando a foto antiga mesmo depois do upload.
  const urlComVersao = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: erroUpdate } = await supabase
    .from('profiles')
    .update({ avatar_url: urlComVersao })
    .eq('id', userId);
  if (erroUpdate) throw erroUpdate;

  return urlComVersao;
}

/** Mesma lógica de `enviarFotoPerfil`, mas pra foto de fundo do cabeçalho
 * ("<user_id>/capa.jpg", coluna profiles.capa_url) — mesmo bucket, mesmas
 * policies de storage (cobrem qualquer arquivo da pasta do usuário). */
export async function enviarFotoCapa(uri) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session.user.id;
  const path = `${userId}/capa.jpg`;

  const bytes = await lerFoto(uri);
  const { error: erroUpload } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (erroUpload) throw erroUpload;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const urlComVersao = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: erroUpdate } = await supabase
    .from('profiles')
    .update({ capa_url: urlComVersao })
    .eq('id', userId);
  if (erroUpdate) throw erroUpdate;

  return urlComVersao;
}
