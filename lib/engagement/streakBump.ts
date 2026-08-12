/**
 * LA FLAMME QUI MONTE — le « +1 » de la série, une fois par semaine.
 *
 * Quand la première visite d'une nouvelle semaine incrémente la série (cf. useGamification.
 * validateWeek), on annonce ici le passage `from → to`. La pastille de l'en-tête (StreakChip)
 * l'écoute, affiche l'ANCIEN chiffre, attend son tour dans la file des sollicitations
 * (lib/interruptQueue : après la clôture et après les succès), puis anime la montée.
 *
 * Volontairement hors React et PERSISTANT en mémoire : le calcul se fait dans GamificationSync
 * (monté à la racine) alors que l'animation se joue dans l'en-tête, qui peut être démonté au
 * moment où l'événement tombe. On garde donc le dernier « +1 » en attente : la pastille le
 * récupère à son montage, au lieu de le rater.
 */

export interface StreakBump {
  /** À qui appartient ce « +1 » — un état de module survivrait à une déconnexion, la flamme du
   *  compte suivant ne doit pas rejouer la semaine du précédent. */
  userId: string;
  /** Série AVANT la validation de la semaine. */
  from: number;
  /** Série APRÈS (toujours `from + 1`). */
  to: number;
}

let pending: StreakBump | null = null;
const listeners = new Set<(bump: StreakBump) => void>();

/** Annonce le « +1 » de la semaine. */
export function emitStreakBump(bump: StreakBump): void {
  pending = bump;
  listeners.forEach((l) => l(bump));
}

/** Le « +1 » en attente pour CE compte (non encore joué), ou null. */
export function pendingStreakBump(userId: string | undefined): StreakBump | null {
  return pending && pending.userId === userId ? pending : null;
}

/** L'animation a été jouée (ou n'a plus lieu d'être : déconnexion, changement de compte). */
export function clearStreakBump(): void {
  pending = null;
}

export function subscribeStreakBump(cb: (bump: StreakBump) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
