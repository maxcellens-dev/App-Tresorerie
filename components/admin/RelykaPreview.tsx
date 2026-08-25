/**
 * Aperçu de la carte « Ton Relyka » — le COMPOSANT DE PRODUCTION (`PilotageSimple`), monté avec des
 * chiffres simulés et des actions inertes.
 *
 * ⚠️ Les écrans d'administration rendaient jusqu'ici `RecommendationCard`, le carrousel en colonnes
 * qui a quitté le tableau de bord : on y jugeait des réglages sur un écran que plus personne ne
 * voit. Un aperçu qui ne montre pas l'écran réel ne vaut pas mieux qu'une capture d'écran périmée.
 *
 * Tout ce qui s'affiche ici passe par les mêmes fonctions que le Pilotage (confiance, fourchette,
 * recommandations, messages) — rien n'est reformulé sur place.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import PilotageSimple from '../pilotage/PilotageSimple';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { buildRelykaMessages, buildRecoMessages, composeGuardMessage, unverifiedRelykaMessage } from '../../lib/finance/recoMessages';
import { floorToTen } from '../../lib/finance/currency';
import type { SmartRecommendation } from '../../lib/finance/recommendationEngine';
import type { RelykaConfidence } from '../../hooks/pilotage/useReliability';

export interface RelykaPreviewProps {
  conf: RelykaConfidence;
  recommendations: SmartRecommendation[];
  /** Relyka NON arrondi — l'aperçu applique la dizaine inférieure comme le tableau de bord. */
  relyka: number;
  checkingBalance: number;
  /** Chiffres du bloc « Ce mois-ci » (facultatifs : des valeurs plausibles sinon). */
  spentThisMonth?: number;
  variableRemaining?: number;
  recurringUpcoming?: number;
  safetyMargin?: number;
}

const noop = () => {};

export default function RelykaPreview({
  conf, recommendations, relyka, checkingBalance,
  spentThisMonth = 0, variableRemaining = 0, recurringUpcoming = 0, safetyMargin = 0,
}: RelykaPreviewProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const relykaColor = relyka > 0 ? COLORS.emerald : COLORS.orange;

  // Mêmes constructeurs de messages que le tableau de bord : c'est ce qui fait apparaître (ou non)
  // la consigne « solde non vérifié » selon le niveau de confiance simulé.
  const relykaMessages = useMemo(() => buildRelykaMessages({
    baseMessage: 'Voici ce qu’il devrait te rester à la fin du mois. Utilise ton Relyka librement, idéalement en suivant les recommandations.',
    baseIsGeneric: true,
    guardMessage: composeGuardMessage(recommendations.filter((r) => r.amount > 0)),
    unverifiedMessage: unverifiedRelykaMessage(conf.result),
    relykaColor,
    warnColor: COLORS.orange,
  }), [recommendations, conf, relykaColor, COLORS.orange]);

  const recoMessages = useMemo(() => buildRecoMessages({
    recommendations,
    financials: { currentChecking: checkingBalance, projectedEndChecking: checkingBalance },
  }), [recommendations, checkingBalance]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <PilotageSimple
        relykaAmount={floorToTen(relyka)}
        relykaColor={relykaColor}
        confidenceLevel={conf.result.level}
        // Ancienneté RÉELLE, comme le Pilotage : celle du calcul sature et ferait mentir le badge.
        daysSinceVerification={conf.result.rawDaysSinceVerification}
        neverVerified={conf.result.neverVerified}
        recommendations={recommendations}
        recoMessages={recoMessages}
        relykaMessages={relykaMessages}
        relykaRange={conf.relykaRange}
        checkingBalance={checkingBalance}
        spentThisMonth={spentThisMonth}
        variableRemaining={variableRemaining}
        recurringUpcoming={recurringUpcoming}
        recurringUpcomingCount={recurringUpcoming > 0 ? 1 : 0}
        safetyMargin={safetyMargin}
        marginSet={safetyMargin > 0}
        reservedTotal={0}
        savedTotal={0}
        investedTotal={0}
        // Aperçu : aucune action n'écrit ni ne navigue.
        onOpenRelyka={noop}
        onOpenDetail={noop}
        onOpenMargin={noop}
        onOpenReserved={noop}
        onUpdateBalance={noop}
        onEpargner={noop}
        onInvestir={noop}
        onReserver={noop}
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    /* La carte de production suppose la largeur du tableau de bord : on lui rend la même, avec un
       liseré discret pour la distinguer du reste de la page d'administration. */
    wrap: {
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16,
      padding: 10, marginTop: 8, backgroundColor: c.bg,
    },
  });
}
