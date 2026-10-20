/**
 * Saison du jardin. Par défaut, c'est la VRAIE saison (hémisphère nord, dates astronomiques
 * arrondies) : le jardin change tout seul au fil de l'année. Une saison achetée en boutique pourra
 * la forcer (`forced`), à tout moment.
 *
 * Règle du Jardin : aucune saison n'abîme l'arbre. L'automne le colore, l'hiver le couvre de neige,
 * il ne perd jamais ses feuilles.
 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_LABELS: Record<Season, string> = {
  spring: 'Printemps', summer: 'Été', autumn: 'Automne', winter: 'Hiver',
};

/** Saison réelle à une date : printemps 20 mars, été 21 juin, automne 23 septembre, hiver 21 décembre. */
export function seasonFor(date: Date): Season {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  if (md >= 320 && md < 621) return 'spring';
  if (md >= 621 && md < 923) return 'summer';
  if (md >= 923 && md < 1221) return 'autumn';
  return 'winter';
}

/** Saison affichée : celle choisie (achetée) si elle existe, sinon la vraie. */
export function effectiveSeason(forced: Season | null | undefined, date: Date = new Date()): Season {
  return forced ?? seasonFor(date);
}
