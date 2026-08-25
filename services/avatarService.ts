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

import { supabase } from '../lib/platform/supabase';

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
 * Vide le dossier de l'utilisateur. Best-effort : on combine la liste réelle ET les deux noms
 * canoniques au cas où la liste échouerait (RLS/latence).
 *
 * `keepPath` — chemin à ÉPARGNER : sert au remplacement d'avatar, où l'on vient d'écrire le
 * nouveau fichier et où seuls les restes doivent partir (cf. uploadAvatar).
 */
async function purgeUserFolder(userId: string, keepPath?: string): Promise<void> {
  if (!supabase) return;
  const listed = await listUserFiles(userId);
  const paths = Array.from(new Set([
    ...listed,
    getAvatarPath(userId, 'webp'),
    getAvatarPath(userId, 'jpg'),
  ])).filter((p) => p !== keepPath);
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

  /* ── ON ÉCRIT LA NOUVELLE PHOTO AVANT D'EFFACER L'ANCIENNE ─────────────────────────────────
     La purge se faisait EN PREMIER. Entre les deux, l'utilisateur n'avait plus de photo du tout :
     un envoi qui échouait (réseau coupé, fichier refusé) laissait `profiles.avatar_url` pointant
     vers un fichier supprimé — avatar cassé dans l'en-tête, le menu et le profil, et l'ancienne
     image définitivement perdue alors qu'on voulait seulement la remplacer.
     `upsert: true` écrase le fichier de MÊME extension, donc l'ordre inverse ne laisse aucun
     doublon ; le ménage ci-dessous ne concerne que les restes d'une autre extension ou d'un
     nommage plus ancien. */
  const body = data instanceof Blob ? data : new Uint8Array(data);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;

  // Ménage APRÈS coup : tout ce qui n'est pas le fichier qu'on vient d'écrire.
  await purgeUserFolder(userId, path);

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
 * Vrai si l'URL d'avatar correspond à une image TÉLÉVERSÉE MANUELLEMENT (bucket Supabase « avatars »),
 * et non à l'avatar Google importé par défaut à la création du compte (googleusercontent…).
 * Sert au succès « photo de profil » : il ne doit se débloquer que sur une vraie photo choisie.
 */
export function isUploadedAvatar(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.includes(`/${BUCKET}/`);
}

/**
 * Retourne l'URL publique de l'avatar (sans vérifier l'existence).
 */
export function getAvatarPublicUrl(userId: string, ext: 'webp' | 'jpg' = 'webp'): string {
  if (!supabase) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(getAvatarPath(userId, ext));
  return data.publicUrl;
}
