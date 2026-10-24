/**
 * UNE icône par sens, partout dans l'app (plan de Pépin, comptes, remarques, menus, fiches) : l'icône
 * et ses deux couleurs viennent d'ICI ; un compte prend celle de son type (courant = portefeuille,
 * épargne = bouclier, placements = courbe). Rendu : components/garden/GardenIcon (pastille ronde, 36 px).
 * (Les clés gardent leurs anciens noms du Jardin — roots, fruits… — pour ne pas tout renommer.)
 *
 * Icônes : Ionicons « outline » (même trait), qui évoquent la réalité (portefeuille, bouclier, courbe…).
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
  roots: { icon: 'shield-checkmark-outline', fg: G.rootsText, bg: G.rootsBg, fill: G.roots },
  fruits: { icon: 'trending-up-outline', fg: G.fruitsText, bg: G.fruitsBg, fill: G.fruits },
  flowers: { icon: 'gift-outline', fg: G.flowersText, bg: G.flowersBg, fill: G.flowers },
  water: { icon: 'wallet-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  cabin: { icon: 'cash-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
  brambles: { icon: 'card-outline', fg: G.bramblesText, bg: G.bramblesBg, fill: G.brambles },
  // le reste de l'argent
  shared: { icon: 'people-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  recurring: { icon: 'repeat-outline', fg: G.picoText, bg: G.pico, fill: '#E9B872' },
  setAside: { icon: 'lock-closed-outline', fg: G.rootsText, bg: G.rootsBg, fill: G.roots },
  done: { icon: 'checkmark-circle-outline', fg: G.branchesText, bg: G.branchesBg, fill: G.branches },
  otherAccount: { icon: 'albums-outline', fg: G.inkSoft, bg: G.field, fill: G.inkSoft },
  // les remarques de Pépin
  trough: { icon: 'trending-down-outline', fg: G.waterText, bg: G.waterBg, fill: G.water },
  budget: { icon: 'pie-chart-outline', fg: G.fruitsText, bg: G.fruitsBg, fill: G.fruits },
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
