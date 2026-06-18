/**
 * Petit émetteur pour ouvrir la checklist « Pour bien démarrer » depuis n'importe où
 * (ex. le bouton « Suivant » du coachmark d'étape validée), sans contexte global.
 * OnboardingChecklist s'abonne ; les appelants déclenchent open().
 */
type Listener = () => void;
let listeners: Listener[] = [];

/** Demande l'ouverture de la modale « Pour bien démarrer ». */
export function openOnboardingChecklist(): void {
  listeners.forEach((l) => l());
}

/** Abonne un listener (retourne la fonction de désabonnement). */
export function subscribeOpenChecklist(l: Listener): () => void {
  listeners.push(l);
  return () => { listeners = listeners.filter((x) => x !== l); };
}
