/**
 * Ce que devient l'eau de l'arrosoir (le Relyka) : un geste par recommandation de Pico, avec la
 * partie de l'arbre qu'il fait pousser, son vrai sens et sa couleur. Une seule source pour la carte
 * du Jardin et la feuille des choix de Pico. Icône et couleurs : lib/garden/icons (UNE par sens).
 */
import { live } from './live';
import type { RecoType } from '../finance/recommendationEngine';
import { GARDEN_ICONS, RECO_ICON } from './icons';

export interface ChoiceLook {
  /** Le geste, en mots du jardin (« Arrose tes racines »). */
  verb: string;
  /** Le vrai sens, toujours à côté (« épargne »). */
  meaning: string;
  /** Nom Ionicons, ou 'garden-roots' (dessin maison, cf. components/garden/ChoiceIcon). */
  icon: string;
  fill: string;
  bg: string;
  fg: string;
}

const look = (type: RecoType, verb: string, meaning: string): ChoiceLook => {
  const i = GARDEN_ICONS[RECO_ICON[type]];
  return { verb, meaning, icon: i.icon, fill: i.fill, bg: i.bg, fg: i.fg };
};

export const CHOICE_LOOKS: Record<RecoType, ChoiceLook> = live(() => ({
  save: look('save', 'Arrose tes racines', 'épargne'),
  invest: look('invest', 'Fais grossir tes fruits', 'placements'),
  // Les fleurs = la part que tu peux dépenser pour toi : on les CUEILLE (on en profite), on ne les fait pas pousser.
  enjoy: look('enjoy', 'Cueille tes fleurs', 'pour te faire plaisir'),
  keep: look('keep', "Garde dans l'arrosoir", 'reste sur ton compte courant'),
}));
