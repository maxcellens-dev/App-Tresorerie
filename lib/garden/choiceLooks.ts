/**
 * Ce que devient l'eau de l'arrosoir (le Relyka) : un geste par recommandation de Pico, avec la
 * partie de l'arbre qu'il fait pousser, son vrai sens et sa couleur. Une seule source pour la carte
 * du Jardin et la feuille des choix de Pico.
 */
import { live } from './live';
import type { RecoType } from '../finance/recommendationEngine';
import { GARDEN_COLORS as G } from './theme';

export interface ChoiceLook {
  /** Le geste, en mots du jardin (« Arrose tes racines »). */
  verb: string;
  /** Le vrai sens, toujours à côté (« épargne de secours »). */
  meaning: string;
  /** Nom Ionicons, ou 'garden-roots' (dessin maison, cf. components/garden/ChoiceIcon). */
  icon: string;
  fill: string;
  bg: string;
  fg: string;
}

export const CHOICE_LOOKS: Record<RecoType, ChoiceLook> = live(() => ({
  save: { verb: 'Arrose tes racines', meaning: 'épargne de secours', icon: 'garden-roots', fill: G.roots, bg: G.rootsBg, fg: G.rootsText },
  invest: { verb: 'Fais grossir tes fruits', meaning: 'placements', icon: 'nutrition-outline', fill: G.fruits, bg: G.fruitsBg, fg: G.fruitsText },
  enjoy: { verb: 'Fais fleurir ton jardin', meaning: 'pour te faire plaisir', icon: 'flower-outline', fill: G.flowers, bg: G.flowersBg, fg: G.flowersText },
  keep: { verb: "Garde dans l'arrosoir", meaning: 'reste sur ton compte courant', icon: 'water-outline', fill: G.water, bg: G.waterBg, fg: G.waterText },
}));
