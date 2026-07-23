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

/**
 * Horloge MONOTONE. `Date.now()` peut sauter (ajustement d'heure système, NTP) et n'a qu'une
 * résolution de l'ordre de la milliseconde ; `performance.now()` est monotone et sub-milliseconde.
 * Repli sur Date.now() si l'API est absente (anciens moteurs JS).
 */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

let lastTapAt = 0;
let lastDispatchedAt = 0;

/** À appeler sur le tap qui déclenche une navigation (avant router.push / navigate). */
export function markNavTap() {
  lastTapAt = nowMs();
  lastDispatchedAt = 0;
}

/**
 * À appeler JUSTE APRÈS l'appel de navigation (navigate/push), une fois qu'il a rendu la main.
 * Sépare le CALCUL synchrone du dispatch (réducteur React Navigation, résolution de route, synchro
 * d'URL sur web) de l'ATTENTE qui suit (planification React avant le premier rendu).
 * Distinction décisive : le calcul se reporte sur mobile, l'attente de planification non.
 */
export function markNavDispatched() {
  lastDispatchedAt = nowMs();
}

/** Consomme le dernier tap (horloge monotone) puis le réinitialise. 0 si aucun tap récent. */
export function consumeNavTap(): number {
  const t = lastTapAt;
  lastTapAt = 0;
  return t;
}

/** Consomme l'instant de fin de dispatch. 0 si non marqué (navigation non instrumentée). */
export function consumeNavDispatched(): number {
  const t = lastDispatchedAt;
  lastDispatchedAt = 0;
  return t;
}
