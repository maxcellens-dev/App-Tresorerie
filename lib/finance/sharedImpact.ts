// #5 — % d'impact d'un compte partagé/joint dans l'app de CHAQUE participant.
//
// Modèle : chaque participant (owner + chaque membre) a un `impact_pct` (0..100). NULL = « auto » =
// part égale = 100 / N où N = nombre total de participants (owner + tous les membres, users ou non).
// Une valeur explicite prime. N'importe quel membre RÉEL peut éditer le % de tout le monde.
//
// Le % détermine quelle FRACTION de l'activité (soldes, dépenses, virements, récurrences) de ce compte
// compte dans l'app du participant. Ex : 30% → 30% des montants du compte impactent son pilotage.

/** Part égale par défaut (auto) = 100 / nombre de participants, arrondie à l'entier. */
export function autoEqualPct(participantCount: number): number {
  if (!participantCount || participantCount < 1) return 0;
  return Math.round(100 / participantCount);
}

/**
 * % effectif d'un participant : sa valeur explicite si définie, sinon la part égale auto.
 * @param explicitPct valeur en base (NULL/undefined = auto)
 * @param participantCount owner + tous les membres
 */
export function effectiveImpactPct(explicitPct: number | null | undefined, participantCount: number): number {
  if (explicitPct != null) return Math.max(0, Math.min(100, explicitPct));
  return autoEqualPct(participantCount);
}

/** Facteur 0..1 à multiplier aux montants/soldes du compte partagé pour la vue d'un participant. */
export function impactFactor(explicitPct: number | null | undefined, participantCount: number): number {
  return effectiveImpactPct(explicitPct, participantCount) / 100;
}
