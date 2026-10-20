/**
 * UNE icône par sens, partout dans le Jardin (gestes de Pépin, comptes, remarques, menus, fiches).
 *
 * Avant : le même sens avait plusieurs visages selon l'écran (les placements étaient une pomme
 * orange sur les gestes du Jardin, une flèche montante verte sur Mon argent et dans les remarques ;
 * les comptes avaient les pictos de l'ancienne app, sans lien avec l'arbre). Désormais :
 *   - l'icône et ses deux couleurs viennent d'ICI ;
 *   - un compte prend l'icône de sa partie de l'arbre (courant = arrosoir, épargne = racines,
 *     placements = fruits) : on reconnaît la même chose qu'on voit dans la scène ;
 *   - le rendu passe par components/garden/GardenIcon (une seule pastille : ronde, 36 px).
 *
 * Icônes : Ionicons « outline » (même trait), ou 'garden-roots' (dessin maison, ChoiceIcon).
 */
import { live } from './live';
import { GARDEN_COLORS as G } from './theme';

export interface GardenIconLook {
  icon: string;
  /** Couleur de l'icône (et du texte posé à côté). */
  fg: string;
  /** Fond doux de la pastille. */
  bg: string;
  /** Couleur pleine de la partie (barres, liserés). */
  fill: string;
}

export type GardenIconKey =
  | 'roots' | 'fruits' | 'flowers' | 'water' | 'cabin' | 'brambles'
  | 'shared' | 'recurring' | 'setAside' | 'done' | 'otherAccount'
  | 'trough' | 'budget' | 'warn' | 'main' | 'info' | 'tip';

export const GARDEN_ICONS: Record<GardenIconKey, GardenIconLook> = live(() => ({
  // les parties de l'arbre
  roots: { icon: 'garden-roots', fg: G.rootsText, bg: G.rootsBg, fill: G.roots },
  fruits: { icon: 'nutrition-outline', fg: G.fruitsText, bg: G.fruitsBg, fill: G.fruits },
  flowers: { icon: 'flower-outline', fg: G.flowersText, bg: G.flowersBg, fill: G.flowers },
  water: { icon: 'water-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  cabin: { icon: 'home-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
  brambles: { icon: 'git-network-outline', fg: G.bramblesText, bg: G.bramblesBg, fill: G.brambles },
  // le reste de l'argent
  shared: { icon: 'people-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  recurring: { icon: 'repeat-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
  setAside: { icon: 'leaf-outline', fg: G.rootsText, bg: G.rootsBg, fill: G.roots },
  done: { icon: 'checkmark-circle-outline', fg: G.branchesText, bg: G.branchesBg, fill: G.branches },
  otherAccount: { icon: 'wallet-outline', fg: G.inkSoft, bg: G.field, fill: G.inkSoft },
  // les remarques de Pépin
  trough: { icon: 'trending-down-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  budget: { icon: 'wallet-outline', fg: G.fruitsText, bg: G.fruitsBg, fill: G.fruits },
  warn: { icon: 'alert-circle-outline', fg: G.noticeText, bg: G.notice, fill: G.roots },
  main: { icon: 'sparkles-outline', fg: G.branchesText, bg: G.branchesBg, fill: G.branches },
  info: { icon: 'information-circle-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
  tip: { icon: 'bulb-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
}));

/** Les quatre gestes de Pépin (types de recommandation) → leur partie de l'arbre. */
export const RECO_ICON: Record<'save' | 'invest' | 'enjoy' | 'keep', GardenIconKey> = { save: 'roots', invest: 'fruits', enjoy: 'flowers', keep: 'water' };

/** Type de compte → sa partie de l'arbre. */
export function accountIcon(type: string): GardenIconKey {
  return type === 'checking' ? 'water' : type === 'savings' ? 'roots' : type === 'investment' ? 'fruits' : 'otherAccount';
}
