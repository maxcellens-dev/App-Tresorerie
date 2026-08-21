/**
 * BACKSTOP GLOBAL DES ÉCHECS D'ÉCRITURE.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────────────────────────
 * Le seul gestionnaire global d'erreur de mutation ne traitait que les limites d'usage
 * (`USAGE_LIMIT_*`). Tout le reste — réseau coupé, refus RLS, session expirée, colonne manquante —
 * ne produisait AUCUN signal dès lors que l'appelant faisait un simple `.mutate()` sans `onError` :
 * la modale se refermait, l'écran revenait à son état normal, et l'utilisateur repartait convaincu
 * que son montant était enregistré. Il ne le découvrait qu'en revoyant, plus tard, un chiffre
 * inchangé — sans jamais pouvoir relier les deux.
 *
 * Une écriture qui échoue doit se voir. C'est la règle que `saveVariableMode` (Pilotage) portait
 * déjà seule, avec ce commentaire : « Un échec silencieux laisserait l'utilisateur croire que son
 * choix est enregistré alors que le Relyka ne bouge pas ».
 *
 * ── COMMENT ÇA S'ARTICULE ───────────────────────────────────────────────────────────────────────
 * react-query appelle les gestionnaires dans cet ordre :
 *     MutationCache.onError (celui-ci)  →  useMutation({ onError })  →  mutate(v, { onError })
 * Le dialogue in-app n'en affiche qu'un à la fois et le dernier remplace le précédent : un appelant
 * qui SAIT quoi dire écrase donc naturellement ce message générique par le sien, plus précis.
 * L'ordre joue en notre faveur — le filet ne masque jamais un meilleur message.
 *
 * ── SILENCE VOLONTAIRE ──────────────────────────────────────────────────────────────────────────
 * Certaines mutations sont des effets de bord qu'on ne veut PAS commenter : drapeaux d'onboarding,
 * statistiques, recalibrage de fiabilité, synchro de gamification. Elles se déclarent avec
 * `meta: { silentError: true }` — un opt-out explicite, lisible à l'endroit qui le décide.
 */
import type { Mutation } from '@tanstack/react-query';

/** Vrai si la mutation a demandé le silence (effet de bord non commentable). */
function isSilent(mutation?: Mutation<any, any, any, any>): boolean {
  return (mutation?.meta as { silentError?: boolean } | undefined)?.silentError === true;
}

/**
 * Message montrable à l'utilisateur, à partir d'une erreur brute.
 * On privilégie TOUJOURS une phrase compréhensible : un code Postgres ou une pile d'appels
 * n'apprend rien à quelqu'un qui voulait juste mettre 200 € de côté.
 */
export function describeWriteError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  if (!raw) return 'Vérifie ta connexion et réessaie.';
  if (/network|fetch|timeout|failed to fetch|econn/i.test(lower)) {
    return 'La connexion a été interrompue. Ton dernier changement n’a pas été enregistré — réessaie.';
  }
  if (/jwt|token|session|not authenticated|non connecté/i.test(lower)) {
    return 'Ta session a expiré. Reconnecte-toi, puis recommence.';
  }
  if (/row-level security|violates row-level|permission denied|403/i.test(lower)) {
    return "Cette modification n'est pas autorisée sur ce compte.";
  }
  // Message serveur déjà rédigé en français par l'app (garde-fous métier) → on le garde tel quel.
  if (/^[A-ZÀ-Ý]/.test(raw) && raw.length < 200) return raw;
  return 'Ton dernier changement n’a pas pu être enregistré. Réessaie.';
}

/**
 * Filet à brancher sur `MutationCache.onError`, APRÈS le traitement des limites d'usage.
 * `alreadyHandled` = ce que rend `handleUsageLimitError` : on ne double pas son message.
 */
export function reportUnhandledWriteError(
  error: unknown,
  alreadyHandled: boolean,
  mutation: Mutation<any, any, any, any> | undefined,
  show: (title: string, message: string) => void,
): void {
  if (alreadyHandled || isSilent(mutation)) return;
  // Trace technique pour le diagnostic : le message montré, lui, reste compréhensible.
  console.warn('[écriture] échec non traité par l’appelant :', error);
  show('Changement non enregistré', describeWriteError(error));
}
