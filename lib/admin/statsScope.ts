/**
 * LE PÉRIMÈTRE DES STATISTIQUES — qui est mesuré, et qui ne l'est pas.
 *
 * POURQUOI
 * ────────
 * Les comptes administrateurs vivent DANS la base de production. On y crée des comptes bidons pour
 * reproduire un bug, on ouvre l'app dix fois dans la journée pour vérifier qu'une OTA est bien
 * passée, on déclenche un état des lieux pour en relire la formulation, on clique sur ses propres
 * bannières pour vérifier qu'elles pointent au bon endroit. Tout cela est du TRAVAIL, pas de
 * l'usage — mais l'analytique ne fait pas la différence : elle enregistre des ouvertures, des vues
 * de page, des impressions et des clics comme pour n'importe qui.
 *
 * Sur une population de quelques centaines d'inscrits, deux ou trois administrateurs suffisent à
 * faire bouger un DAU, un CTR ou un taux de conversion de plusieurs points. On lit alors ses
 * propres allées et venues en croyant lire celles des utilisateurs — et on décide dessus.
 *
 * CE QUE FAIT CE MODULE
 * ─────────────────────
 * La GRAMMAIRE de l'exclusion, sans aucun accès réseau : de quoi filtrer une requête PostgREST ou
 * un tableau déjà chargé. La liste des identifiants, elle, se lit dans `lib/admin/adminProfiles`.
 * Les agrégats faits EN BASE (`admin_app_version_stats`, `admin_profile_distribution`) appliquent
 * la même exclusion côté serveur (migration 222).
 *
 * LE PIÈGE, ET POURQUOI CE FICHIER EST TESTÉ
 * ──────────────────────────────────────────
 * `profile_id` est NULLABLE sur plusieurs tables (un crash sur l'écran de connexion, un évènement
 * anonyme). Un simple `not.in.(…)` les ferait disparaître : en SQL, `NULL NOT IN (…)` ne vaut pas
 * « vrai », il vaut NULL, et la ligne est écartée. On écrit donc explicitement « nul OU pas un
 * admin » — une donnée anonyme n'est pas une donnée d'administrateur. Et une erreur de syntaxe dans
 * un `or` PostgREST ne se voit pas à l'écran : elle rend simplement TOUT, exclusion comprise.
 */

/**
 * Le filtre PostgREST « cette ligne n'appartient pas à un administrateur ».
 * Rendu à part pour être vérifiable sans base : c'est la pièce où une erreur ne se remarque pas.
 */
export function adminExclusionFilter(adminIds: string[], column = 'profile_id'): string {
  return `${column}.is.null,${column}.not.in.(${adminIds.join(',')})`;
}

/**
 * Applique « sauf les administrateurs » à une requête PostgREST.
 * Liste vide (aucun admin) = requête inchangée : on ne fabrique pas un `in.()` vide, que PostgREST
 * refuse.
 */
export function withoutAdmins<Q>(query: Q, adminIds: string[], column = 'profile_id'): Q {
  if (adminIds.length === 0) return query;
  return (query as any).or(adminExclusionFilter(adminIds, column));
}

/**
 * Même exclusion, sur des lignes DÉJÀ chargées (repli d'un agrégat serveur non déployé).
 * Une ligne sans identifiant est conservée : elle n'est à personne, donc à aucun administrateur.
 */
export function withoutAdminRows<T extends Record<string, any>>(
  rows: T[],
  adminIds: string[],
  column = 'profile_id',
): T[] {
  if (adminIds.length === 0) return rows;
  const set = new Set(adminIds);
  return rows.filter((r) => !r?.[column] || !set.has(r[column]));
}
