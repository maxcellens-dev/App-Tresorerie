/**
 * État PARTAGÉ d'ouverture de la checklist « Pour bien démarrer », sans contexte global.
 *
 * Pourquoi partagé et pas local à chaque instance ? Chaque onglet (tab) monte son propre header,
 * donc plusieurs OnboardingChecklist coexistent. Si chacune gardait son propre `open`, ouvrir la
 * checklist (événement global) les ouvrirait TOUTES : on en fermait une en tapant une étape, mais
 * l'instance de l'onglet de destination restait ouverte → « le guide reste ouvert ».
 * Ici l'état est unique : fermer depuis n'importe quelle instance ferme partout.
 */
type Listener = (open: boolean) => void;
let listeners: Listener[] = [];
let openState = false;

function emit() {
  listeners.forEach((l) => l(openState));
}

/** Ouvre la modale « Pour bien démarrer » (partout). */
export function openOnboardingChecklist(): void {
  openState = true;
  emit();
}

/** Ferme la modale « Pour bien démarrer » (partout). */
export function closeOnboardingChecklist(): void {
  openState = false;
  emit();
}

/** Abonne un listener à l'état d'ouverture ; l'appelle une fois avec l'état courant. */
export function subscribeChecklistOpen(l: Listener): () => void {
  listeners.push(l);
  l(openState);
  return () => { listeners = listeners.filter((x) => x !== l); };
}
