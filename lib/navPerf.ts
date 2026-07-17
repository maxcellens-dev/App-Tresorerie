/**
 * navPerf — mesure GLOBALE de réactivité de navigation (sonde admin).
 *
 * `markTap()` est appelé au moment PRÉCIS où l'utilisateur tape un élément qui va naviguer (onglet,
 * item de menu, bouton retour…). Le composant racine NavPerfProbe observe ensuite le changement de
 * route et mesure tap → frame peinte. Là où aucun tap n'a été marqué (deep-link, redirection), il
 * mesure le coût de rendu de la destination (changement de route → peinture).
 *
 * Volontairement ultra-léger (une variable module) : aucun état React, aucun re-render induit.
 */

let lastTapAt = 0;

/** À appeler sur le tap qui déclenche une navigation (avant router.push / navigate). */
export function markNavTap() {
  lastTapAt = Date.now();
}

/** Consomme le dernier tap (ms depuis l'epoch) puis le réinitialise. 0 si aucun tap récent. */
export function consumeNavTap(): number {
  const t = lastTapAt;
  lastTapAt = 0;
  return t;
}
