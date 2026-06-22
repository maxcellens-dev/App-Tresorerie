/**
 * Service avatar : upload, suppression, URL publique.
 * Bucket Supabase "avatars", dossier par utilisateur : {user_id}/...
 *
 * Invariant : à tout instant, le dossier {user_id}/ ne contient AU PLUS qu'un seul
 * fichier (l'avatar courant). Avant chaque upload ET à la suppression, on vide
 * intégralement le dossier (liste + remove) pour ne jamais laisser d'orphelin —
 * y compris d'anciens fichiers à extension différente (avatar.webp / avatar.jpg) ou
 * issus d'un nommage historique.
 */

import { supabase } from '../lib/supabase';

const BUCKET = 'avatars';

function getAvatarPath(userId: string, ext: 'webp' | 'jpg' = 'webp'): string {
  return `${userId}/avatar.${ext}`;
}

/**
 * Liste tous les chemins de fichiers présents dans le dossier de l'utilisateur.
 * Sert à purger l'intégralité du dossier (et pas seulement les noms attendus).
 */
async function listUserFiles(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 });
  if (error || !data) return [];
  // On ignore les éventuels « placeholders » de dossier (name vide).
  return data.filter((f) => f.name).map((f) => `${userId}/${f.name}`);
}

/**
 * Vide le dossier de l'utilisateur (tous fichiers). Best-effort : on combine la liste
 * réelle ET les deux noms canoniques au cas où la liste échouerait (RLS/latence).
 */
async function purgeUserFolder(userId: string): Promise<void> {
  if (!supabase) return;
  const listed = await listUserFiles(userId);
  const paths = Array.from(new Set([
    ...listed,
    getAvatarPath(userId, 'webp'),
    getAvatarPath(userId, 'jpg'),
  ]));
  if (paths.length === 0) return;
  await supabase.storage.from(BUCKET).remove(paths);
}

/**
 * Upload d'un avatar compressé. Purge d'abord TOUT l'ancien contenu du dossier de
 * l'utilisateur, puis téléverse le nouveau fichier. Renvoie une URL publique
 * « anti-cache » (le chemin de stockage étant stable, on force le rafraîchissement
 * côté client/CDN à chaque changement d'image).
 */
export async function uploadAvatar(
  userId: string,
  data: Blob | ArrayBuffer,
  mime: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase non configuré');
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  const path = getAvatarPath(userId, ext);

  // Purge complète du dossier avant le nouvel upload → aucun orphelin.
  await purgeUserFolder(userId);

  const body = data instanceof Blob ? data : new Uint8Array(data);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const base = urlData.publicUrl;
  return base + (base.includes('?') ? '&' : '?') + 'v=' + Date.now();
}

/**
 * Supprime l'avatar de l'utilisateur du bucket (vide tout le dossier).
 */
export async function deleteAvatar(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré');
  await purgeUserFolder(userId);
}

/**
 * Retourne l'URL publique de l'avatar (sans vérifier l'existence).
 */
export function getAvatarPublicUrl(userId: string, ext: 'webp' | 'jpg' = 'webp'): string {
  if (!supabase) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(getAvatarPath(userId, ext));
  return data.publicUrl;
}
