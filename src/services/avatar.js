import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

/** Envia a foto de perfil pro Storage (bucket "avatars", sempre no path
 * "<user_id>/avatar.jpg" — cada profissional só pode escrever no próprio,
 * ver migration 0028) e grava a URL pública em profiles.avatar_url.
 * Retorna a URL nova, já pronta pra usar em <Image source={{ uri }}>. */
export async function enviarFotoPerfil(uri) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session.user.id;
  const path = `${userId}/avatar.jpg`;

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const { error: erroUpload } = await supabase.storage
    .from('avatars')
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
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

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const { error: erroUpload } = await supabase.storage
    .from('avatars')
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
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
