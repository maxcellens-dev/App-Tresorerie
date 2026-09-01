/**
 * QUI EST ADMINISTRATEUR — la liste que le périmètre des statistiques applique.
 *
 * Séparé de `lib/admin/statsScope` (la grammaire du filtre, pure et testée) parce que ce fichier-ci
 * touche le réseau : il ne peut pas vivre dans le projet de tests rapide.
 *
 * ⚠️ L'ERREUR N'EST PAS AVALÉE. Sans la liste, on ne sait pas ce qu'on exclut — et des statistiques
 * polluées présentées comme propres sont pires que pas de statistiques du tout. L'écran appelant
 * affiche le message ; il n'affiche pas des chiffres faux.
 */
import { supabase } from '../platform/supabase';

/** Mise en cache courte : un même écran enchaîne une dizaine de requêtes sur la même liste. */
const TTL_MS = 5 * 60 * 1000;
let cached: { ids: string[]; at: number } | null = null;

/**
 * Les identifiants des comptes administrateurs. `force` = rechargement explicite (bouton
 * « Actualiser ») : un compte promu ou rétrogradé doit être pris en compte sans attendre le cache.
 *
 * Lisible par un administrateur uniquement — les policies `profiles` d'un inscrit ordinaire ne
 * rendent que sa propre ligne, ce qui donnerait une liste vide, donc aucune exclusion. Ce n'est pas
 * un problème : ces écrans sont derrière la garde d'admin.
 */
export async function fetchAdminProfileIds(force = false): Promise<string[]> {
  if (!supabase) return [];
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.ids;
  const { data, error } = await supabase.from('profiles').select('id').eq('is_admin', true);
  if (error) throw error;
  const ids = (data ?? [])
    .map((r: any) => r?.id)
    .filter((id: unknown): id is string => typeof id === 'string');
  cached = { ids, at: Date.now() };
  return ids;
}
