/**
 * Règles d'ACCÈS et de COMPTEUR des Conseils Intelligents — fonction pure, testée.
 *
 * Ces règles étaient éparpillées dans la page (huit expressions booléennes enchevêtrées), alors
 * qu'elles doivent coïncider AU MOT PRÈS avec ce que fait le serveur (Edge Function `ai-advice`) :
 *   • l'accès est ouvert à un abonné, à un admin, quand l'admin ouvre la fonctionnalité à tous,
 *     ET à quiconque détient des crédits achetés/offerts (le serveur lit le solde AVANT le mur
 *     Premium : refuser côté client rendait inutilisables des requêtes déjà payées) ;
 *   • le quota mensuel épuisé n'est un MUR que si l'éditeur n'a pas activé la bascule payante ;
 *   • la recharge à l'unité ne se propose que si elle est activée ET qu'il existe des offres ;
 *   • tant que le quota n'a pas répondu, on n'affiche AUCUN chiffre et on ne bloque PAS l'envoi
 *     (sinon chaque ouverture de page montrait « 0 / 0 » et un compte faussement épuisé).
 *
 * Tout est borné à des valeurs positives : une limite négative en base (faute de frappe admin) ne
 * doit pas produire un compteur négatif à l'écran.
 */

/** Ce que renvoie la RPC `ai_my_quota`. */
export interface AiQuotaLike {
  used: number;
  limit: number;
  remaining: number;
  is_premium: boolean;
  extra_credits: number;
}

export interface AiAccessInput {
  /** Droit Premium ACTIF (abonnement + offre Premium activée globalement). */
  isPremium: boolean;
  /**
   * Le PLAN a répondu — cf. `usePlan().isResolved` (drapeaux d'offre ET profil).
   *
   * `isPremium` vaut `false` par DÉFAUT tant que les drapeaux globaux ne sont pas revenus, et
   * DÉFINITIVEMENT si leur lecture échoue (coupure réseau). Sans cette entrée, la page n'attendait
   * que le profil et la config IA : un abonné pouvait donc se voir opposer le mur « réservé aux
   * abonnés Premium » sur une fonctionnalité qu'il paye. Le Reporting attendait déjà cette réponse,
   * pas les Conseils Intelligents — deux pages, une même règle, deux comportements.
   */
  planResolved: boolean;
  isAdmin: boolean;
  /** Consultation admin « connecté en tant que » → lecture seule. */
  isImpersonating: boolean;
  /** Le profil a répondu. */
  profileReady: boolean;
  /** La config IA a répondu. */
  cfgReady: boolean;
  /** La lecture du quota est retombée (succès OU échec) : sans elle, le solde de crédits est inconnu. */
  quotaSettled: boolean;
  openToAll: boolean;
  payToUseEnabled: boolean;
  paidFallbackEnabled: boolean;
  packsCount: number;
  quota: AiQuotaLike | null | undefined;
}

export interface AiAccessState {
  /** On peut trancher l'affichage (sinon : cercle d'attente). */
  accessReady: boolean;
  allowed: boolean;
  readOnly: boolean;
  /** Le compteur a une valeur à montrer. */
  quotaLoaded: boolean;
  available: number;
  totalRequests: number;
  extraCredits: number;
  canSend: boolean;
  canRecharge: boolean;
  /** Plus de requêtes, aucune recharge possible → message d'explication (pas une feuille d'achat). */
  outOfRequests: boolean;
}

const pos = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

export function resolveAiAccess(i: AiAccessInput): AiAccessState {
  const quotaLoaded = !!i.quota;
  const extraCredits = pos(i.quota?.extra_credits);
  const remaining = pos(i.quota?.remaining);
  const limit = pos(i.quota?.limit);

  const baseAllowed = i.isPremium || i.isAdmin || i.openToAll;
  const allowed = baseAllowed || extraCredits > 0;
  /* On ne tranche que sur des RÉPONSES :
     • sans le solde de crédits, impossible de statuer sur qui n'a QUE des requêtes achetées ;
     • sans la réponse du PLAN, « pas abonné » n'est qu'une valeur par défaut — d'où le mur opposé
       à des abonnés au premier chargement (ou durablement, si les drapeaux ne répondent pas).
     Un accès déjà acquis par une autre voie (admin, ouverture à tous) n'attend rien : `baseAllowed`
     court-circuite les deux conditions. */
  const accessReady = i.profileReady && i.cfgReady && (baseAllowed || (i.planResolved && i.quotaSettled));
  const readOnly = i.isImpersonating || !allowed;

  const available = remaining + extraCredits;
  const totalRequests = limit + extraCredits;
  const canRecharge = !readOnly && i.payToUseEnabled && i.packsCount > 0;
  const canSend = !readOnly && (!quotaLoaded || available > 0 || i.paidFallbackEnabled);
  const outOfRequests = !readOnly && quotaLoaded && available <= 0 && !i.paidFallbackEnabled;

  return { accessReady, allowed, readOnly, quotaLoaded, available, totalRequests, extraCredits, canSend, canRecharge, outOfRequests };
}
