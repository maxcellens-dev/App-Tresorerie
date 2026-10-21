/**
 * « Prochain pas » du Jardin : UN seul geste proposé, le plus utile d'abord. Fonction PURE, sur ce
 * que l'arbre montre déjà (TreeState) — elle ne calcule aucune notion financière nouvelle.
 *
 * Ordre :
 *   1. des ronces (crédit cher : renouvelable, découvert) → le rembourser d'abord : il coûte plus
 *      que ce qu'un placement rapporte ;
 *   2. des racines sous 6 mois de dépenses → le trait suivant (1, 3, puis 6 mois) ;
 *   3. 6 mois atteints, aucun placement → planter un premier fruit (ce qui dépasse peut y aller) ;
 *   4. des placements, sans versement chaque mois → arroser ses fruits régulièrement ;
 *   5. tout est en place → faire grossir ses fruits : 6, 12 puis 24 mois de dépenses placés
 *      (24 mois = l'arbre à son plus grand, cf. BRANCHES_FULL_MONTHS de treeState).
 *
 * Ton du Jardin : jamais d'alarme, jamais de jugement — on propose le pas suivant, c'est tout.
 */
import type { TreeState } from './treeState';
import { rootsGoal } from './lexicon';

export type NextStepKind = 'brambles' | 'roots' | 'firstFruit' | 'dripFruits' | 'growFruits' | 'grand';

export interface NextStep {
  kind: NextStepKind;
  /** Couleur de la carte : la partie de l'arbre concernée. */
  part: 'brambles' | 'roots' | 'fruits';
  title: string;
  text: string;
  /** Barre de progression, en mois de dépenses. */
  progress?: { value: number; target: number };
}

const FRUIT_MARKS = [6, 12, 24];
const fmtMonths = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const fmtEur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

export function computeNextStep(tree: TreeState, monthlyReference: number, investedValue: number, investMonthly = 0): NextStep {
  const ref = monthlyReference > 0 ? monthlyReference : 0;
  const m = tree.roots.months;

  if (tree.brambles > 0) {
    return {
      kind: 'brambles', part: 'brambles',
      title: 'Arrache tes ronces : rembourse ton crédit cher',
      text: "Un crédit renouvelable ou un découvert coûte plus cher que ce qu'un placement rapporte. Le rembourser en premier, c'est le placement le plus rentable.",
    };
  }

  if (m < 6) {
    const target = m < 1 ? 1 : m < 3 ? 3 : 6;
    return {
      kind: 'roots', part: 'roots',
      title: rootsGoal(target),
      text: m > 0
        ? `Aujourd'hui, ton épargne de secours paierait ${fmtMonths(m)} mois de tes dépenses si tes revenus s'arrêtaient.`
        : "Ton épargne de secours, c'est ce qui paierait tes dépenses si tes revenus s'arrêtaient.",
      progress: { value: m, target },
    };
  }

  if (tree.investments === 0) {
    const extra = ref > 0 ? (m - 6) * ref : 0;
    return {
      kind: 'firstFruit', part: 'fruits',
      title: 'Plante ton premier fruit : ouvre un placement',
      text: extra >= 50
        ? `Tes racines tiennent ${fmtMonths(m)} mois, c'est solide. Les ${fmtEur(extra)} au-delà de 6 mois peuvent commencer à travailler dans un placement.`
        : `Tes racines tiennent ${fmtMonths(m)} mois, c'est solide. La suite de ton argent peut commencer à travailler dans un placement.`,
    };
  }

  if (!(investMonthly > 0)) {
    return {
      kind: 'dripFruits', part: 'fruits',
      title: 'Arrose tes fruits chaque mois',
      text: 'Un petit virement programmé vers tes placements, chaque mois : c\'est la régularité qui les fait grossir, bien plus que le montant.',
    };
  }

  const placed = ref > 0 ? Math.max(0, investedValue) / ref : 0;
  const target = FRUIT_MARKS.find((t) => placed < t);
  if (target == null) {
    return {
      kind: 'grand', part: 'fruits',
      title: 'Ton arbre est à son plus grand',
      text: `Tes placements représentent ${fmtMonths(placed)} mois de dépenses. Continue d'arroser : Pépin te dit chaque mois quoi faire de ce qui reste.`,
    };
  }
  return {
    kind: 'growFruits', part: 'fruits',
    title: `Fais grossir tes fruits : ${target} mois de dépenses placés`,
    text: `Tes placements représentent aujourd'hui ${fmtMonths(placed)} mois de tes dépenses. Ton arrosage régulier les fait grandir.`,
    progress: { value: placed, target },
  };
}
