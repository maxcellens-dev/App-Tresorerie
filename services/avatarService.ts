/**
 * Service avatar : upload, suppression, URL publique.
 * Bucket Supabase "avatars", chemin : {user_id}/avatar.webp ou avatar.jpg
 */

import { supabase } from '../lib/supabase';

const BUCKET = 'avatars';

function getAvatarPath(userId: string, ext: 'webp' | 'jpg' = 'webp'): string {
  return `${userId}/avatar.${ext}`;
}

/**
 * Upload d'un avatar compressé. Remplace l'ancien s'il existe.
 */
export async function uploadAvatar(
  userId: string,
  data: Blob | ArrayBuffer,
  mime: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase non configuré');
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  const path = getAvatarPath(userId, ext);

  const { error: deleteOld } = await supabase.storage.from(BUCKET).remove([
    getAvatarPath(userId, 'webp'),
    getAvatarPath(userId, 'jpg'),
  ]);
  if (deleteOld) {
    // Ignorer si aucun fichier à supprimer
  }

  const body = data instanceof Blob ? data : new Uint8Array(data);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Supprime l'avatar de l'utilisateur du bucket.
 */
export async function deleteAvatar(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré');
  const { error } = await supabase.storage.from(BUCKET).remove([
    getAvatarPath(userId, 'webp'),
    getAvatarPath(userId, 'jpg'),
  ]);
  if (error) throw error;
}

/**
 * Retourne l'URL publique de l'avatar (sans vérifier l'existence).
 */
export function getAvatarPublicUrl(userId: string, ext: 'webp' | 'jpg' = 'webp'): string {
  if (!supabase) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(getAvatarPath(userId, ext));
  return data.publicUrl;
}
