/**
 * FILE D'ATTENTE DES SOLLICITATIONS — une seule à l'écran, dans un ordre décidé.
 *
 * À l'ouverture après quelques jours d'absence, plusieurs choses veulent parler en même temps : la
 * clôture du mois, l'état des lieux mensuel, un changement de profil financier, un succès débloqué.
 * Chacune était juste, mais empilées elles donnaient un empilement de fenêtres — l'inverse d'une
 * app qu'on ouvre pour être rassuré.
 *
 * Règle : UNE seule à la fois, et la suivante n'apparaît qu'une fois la précédente RÉELLEMENT
 * traitée (fermée par l'utilisateur), pas simplement affichée.
 *
 * L'ordre suit la logique de lecture :
 *   1. la CLÔTURE — sans elle, tout ce qui suit s'appuie sur des chiffres non vérifiés ;
 *   2. l'ÉTAT DES LIEUX du mois — le bilan de ce qu'on vient de clôturer ;
 *   3. le CHANGEMENT DE PROFIL — conséquence des chiffres consolidés ;
 *   4. les SUCCÈS — la récompense arrive en dernier, jamais avant l'information.
 *
 * Volontairement hors React (module simple + abonnement) : ces écrans vivent dans des composants
 * différents montés à la racine, sans parent commun où poser un état partagé.
 */

export type InterruptId = 'closure' | 'pulse_month' | 'profile_change' | 'achievement';

/** Du plus prioritaire au moins prioritaire. */
export const INTERRUPT_ORDER: InterruptId[] = [
  'closure', 'pulse_month', 'profile_change', 'achievement',
];

const waiting = new Set<InterruptId>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/**
 * « J'ai quelque chose à montrer » / « je n'ai plus rien ».
 * À appeler à CHAQUE rendu du candidat : c'est ce qui permet de recalculer qui a la main quand une
 * condition disparaît (clôture faite, succès déjà vu…).
 */
export function setInterruptPending(id: InterruptId, pending: boolean): void {
  const had = waiting.has(id);
  if (pending === had) return;
  if (pending) waiting.add(id); else waiting.delete(id);
  notify();
}

/** Qui a la main en ce moment ? `null` si personne n'attend. */
export function currentInterrupt(): InterruptId | null {
  for (const id of INTERRUPT_ORDER) if (waiting.has(id)) return id;
  return null;
}

/** Ce candidat peut-il s'afficher ? (= il attend ET personne de plus prioritaire n'attend) */
export function canShowInterrupt(id: InterruptId): boolean {
  return currentInterrupt() === id;
}

export function subscribeInterrupts(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Remise à zéro (changement de compte / déconnexion). */
export function resetInterrupts(): void {
  waiting.clear();
  notify();
}
