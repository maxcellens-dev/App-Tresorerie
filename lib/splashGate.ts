/**
 * splashGate — signal « app prête à être révélée », émis UNE FOIS par le premier écran de
 * destination réel (pilotage chargé, accueil, questionnaire…). Le splash animé attend ce signal
 * avant de s'effacer → on ne révèle jamais une page encore en chargement (cercle de chargement).
 */
let ready = false;
const listeners = new Set<() => void>();

/** Émis par l'écran de destination quand son contenu est réellement prêt. */
export function signalAppReady(): void {
  if (ready) return;
  ready = true;
  listeners.forEach((l) => l());
  listeners.clear();
}

export function isAppReady(): boolean {
  return ready;
}

/** S'abonne ; rappelle immédiatement si déjà prêt. Renvoie une fonction de désabonnement. */
export function onAppReady(cb: () => void): () => void {
  if (ready) { cb(); return () => {}; }
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
