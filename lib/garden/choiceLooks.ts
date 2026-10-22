/**
 * Ce que Pépin propose de faire du Relyka : une ligne par recommandation, avec son nom en mot
 * courant, ce qu'elle veut dire et sa couleur. Une seule source pour la carte d'accueil et la feuille
 * des choix de Pépin. Icône et couleurs : lib/garden/icons (UNE par sens).
 */
import { live } from './live';
import type { RecoType } from '../finance/recommendationEngine';
import { GARDEN_ICONS, RECO_ICON } from './icons';

export interface ChoiceLook {
  /** Le nom, en mot courant (« Épargne »). */
  verb: string;
  /** Ce qu'il veut dire, en clair (« mettre de côté pour plus tard »). */
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
  save: look('save', 'Épargne', 'mettre de côté pour plus tard'),
  invest: look('invest', 'Investissements', 'faire travailler ton argent'),
  enjoy: look('enjoy', 'Plaisir', 'pour te faire plaisir'),
  keep: look('keep', 'À garder', 'reste sur ton compte courant'),
}));
