/**
 * Règles d'accès à la couleur d'accent personnalisée (Apparence).
 *
 * Extraites de l'écran parce qu'elles décident d'un EFFACEMENT en base : remettre l'accent par
 * défaut supprime la couleur que l'utilisateur avait choisie, sans possibilité de la retrouver.
 * Une règle qui détruit une donnée doit pouvoir être lue et testée seule, pas déduite d'un
 * enchaînement de conditions au milieu d'un composant.
 */

/** Une couleur personnalisée est un hex direct stocké dans `profiles.theme_preset`. */
export function isCustomAccent(preset: string | null | undefined): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(preset ?? '');
}

export interface AccentResetInput {
  /** Le profil a réellement répondu (pas une valeur par défaut en attendant). */
  profileLoaded: boolean;
  /** L'offre Premium ET le profil ont répondu — cf. usePlan().isResolved. */
  planResolved: boolean;
  /** CE compte a-t-il le droit Premium ? (indépendant de l'activation globale de l'offre) */
  hasEntitlement: boolean;
  /** Valeur actuelle de `profiles.theme_preset`. */
  preset: string | null | undefined;
  /** Consultation d'un autre compte : on ne modifie jamais ses données. */
  readOnly: boolean;
  /** Déjà fait pendant cette visite : la règle ne se rejoue pas. */
  alreadyDone: boolean;
}

/**
 * Faut-il remettre l'accent par défaut parce que l'abonnement a pris fin ?
 *
 * Le piège que ça corrige : répondre « oui » tant que les réponses ne sont pas arrivées. Le droit
 * Premium vaut `false` par défaut, et le profil vient souvent du cache local — il est donc présent
 * bien avant les réglages d'offre. Un abonné ouvrant Apparence se faisait alors effacer sa couleur
 * personnalisée EN BASE avant même que la page ait fini de s'afficher.
 *
 * On exige donc que TOUT ait répondu, et on se fonde sur le droit du compte plutôt que sur l'offre :
 * une offre Premium désactivée globalement (décision d'administration, réversible) n'a aucune raison
 * de détruire le réglage de tous les abonnés.
 */
export function shouldResetCustomAccent(i: AccentResetInput): boolean {
  if (i.readOnly || i.alreadyDone) return false;
  if (!i.profileLoaded || !i.planResolved) return false;
  if (i.hasEntitlement) return false;
  return isCustomAccent(i.preset);
}
