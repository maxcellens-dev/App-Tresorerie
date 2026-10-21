/**
 * Ce que la scène du Jardin partage avec le reste de l'app, hors dessin (le dessin : scene3dLayout).
 * Fonctions PURES.
 */
import type { TreeState } from './treeState';

/** Les parties touchables de la scène. */
export type HotspotPart = 'can' | 'roots' | 'tree' | 'cabin' | 'brambles' | 'flowers' | 'pico';

/** Ce que la boutique ajoute à la scène. */
export interface SceneExtras {
  /** Décor équipé : 'lantern' | 'birdhouse' | 'bench' | 'mushrooms' | 'fence' | 'pond'. */
  decor?: string[];
  /** Garde-robe de Pépin. */
  outfit?: { neck?: string; head?: string; eyes?: string; feet?: string };
}

/** La scène dite en français, pour les lecteurs d'écran. */
export function describeScene(state: TreeState): string {
  const parts: string[] = [];
  parts.push({ sprout: 'Une jeune pousse', young: 'Un jeune arbre', tree: 'Un arbre', fruiting: 'Un arbre en fruits', grand: 'Un grand arbre' }[state.stage]);
  const m = state.roots.months;
  parts.push(m > 6 ? `racines au-delà de 6 mois (${Math.round(m)} mois)` : `racines à ${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`);
  if (state.investments) parts.push(`${state.investments} placement${state.investments > 1 ? 's' : ''} en fruits${state.ripe ? ' mûrs' : ''}`);
  if (state.flowers) parts.push(`${state.flowers} fleurs`);
  if (state.drip.roots || state.drip.branches) parts.push('arrosage régulier');
  if (state.cabin) parts.push(`une cabane construite à ${Math.round(state.cabin.progress * 100)} %${state.cabin.count > 1 ? ` (${state.cabin.count} crédits)` : ''}`);
  if (state.brambles > 0) parts.push('des ronces autour du tronc');
  return parts.join(', ') + '.';
}
