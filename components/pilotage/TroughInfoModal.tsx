/**
 * « Point bas de trésorerie » — l'explication du chiffre sur lequel repose le Relyka.
 *
 * Extraite de `app/(tabs)/pilotage.tsx` à l'identique : aucun texte ni calcul n'a changé au passage.
 * Le point de fond qu'elle porte : le point bas est une info À UNE DATE, pas un jugement sur le
 * mois. Un point bas faible la veille de la paie est normal — et le Relyka avec lui.
 */
import { Text, StyleSheet } from 'react-native';
import TroughChart from '../charts/TroughChart';
import PilotageModalShell from './PilotageModalShell';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: AppColors;
  /** Solde courant d'aujourd'hui (départ de la simulation). */
  currentBalance: number;
  /** Point bas simulé et sa date (ISO), telle que calculée par le moteur. */
  trough: number;
  troughDate: string | null;
  /** Prochaine rentrée d'argent prise en compte — c'est elle qui fait remonter la courbe. */
  nextIncomeDate: string | null;
  nextIncomeAmount: number;
  safetyMargin: number;
  /** Formatteurs de l'écran, passés tels quels pour garder un rendu identique. */
  shortDay: (iso: string | null | undefined) => string;
  eur: (n: number) => string;
}

export default function TroughInfoModal({
  visible, onClose, colors, currentBalance, trough, troughDate,
  nextIncomeDate, nextIncomeAmount, safetyMargin, shortDay, eur,
}: Props) {
  const styles = makeStyles(colors);
  return (
    <PilotageModalShell visible={visible} title="Point bas de trésorerie" onClose={onClose} colors={colors}>
      {/* Schéma avec TES chiffres : solde d'aujourd'hui → point bas (daté) → remontée après
          ta prochaine rentrée d'argent. Trois points réellement calculés, aucun décor. */}
      <TroughChart
        today={{ label: 'Aujourd’hui', amount: currentBalance }}
        trough={{ label: troughDate ? shortDay(troughDate) : 'Point bas', amount: trough }}
        recovery={nextIncomeDate && nextIncomeAmount > 0
          ? { label: shortDay(nextIncomeDate), amount: trough + nextIncomeAmount }
          : undefined}
        margin={safetyMargin}
      />
      <Text style={styles.troughInfoText}>
        C'est le solde le plus bas qu'atteindront tes comptes courants d'ici ta prochaine rentrée d'argent, en simulant tes revenus et tes dépenses à venir jour après jour.
        {troughDate ? ` D'après tes opérations, ce sera le ${shortDay(troughDate)}.` : ''}{'\n\n'}
        C'est une info à une DATE, pas un jugement sur ton mois : si tu es payé le 25, ton point bas du 24 est normalement bas — et ton Relyka avec lui. Il ne dit qu'une chose : voilà ce que tu peux dépenser d'ici là.
        {nextIncomeDate && nextIncomeAmount > 0 ? ` Ta rentrée d'argent du ${shortDay(nextIncomeDate)} (+${eur(nextIncomeAmount)}) le fera remonter.` : ''}{'\n\n'}
        On se base dessus plutôt que sur ton solde actuel pour ne jamais te laisser dépenser de l'argent que tu n'as pas encore reçu.
      </Text>
    </PilotageModalShell>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    troughInfoText: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  });
}
