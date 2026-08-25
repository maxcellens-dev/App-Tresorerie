/**
 * Résultat CALCULÉ d'un état de confiance, en clair — partagé par l'aperçu des bandeaux et le
 * simulateur de fiabilité.
 *
 * Pourquoi l'afficher : les écrans d'administration décrivaient leurs cas par un texte figé
 * (« vérif il y a 10 j → fourchette »). Le jour où le calcul change, ces intitulés deviennent faux
 * sans que rien ne le signale — c'est arrivé. En montrant ce que le moteur vient réellement de
 * produire, un exemple périmé se voit immédiatement.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RelykaConfidence } from '../../hooks/pilotage/useReliability';
import { CURRENCY_SYMBOL, floorToTen } from '../../lib/finance/currency';
import { useAppColors } from '../../hooks/theme/useAppColors';

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
const pct = (n: number) => `${Math.round(n * 100)} %`;

const LEVEL_LABEL: Record<string, string> = {
  high: 'HAUTE — chiffres nets',
  medium: 'MOYENNE — fourchette',
  low: 'BASSE — fourchette + alerte',
};

export default function ConfidenceSummary({ conf }: { conf: RelykaConfidence }) {
  const COLORS = useAppColors();
  const s = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  const r = conf.result;
  const tone = r.level === 'high' ? (COLORS.green ?? COLORS.emerald) : r.level === 'medium' ? COLORS.orange : COLORS.danger;

  const rows: [string, string][] = [
    ['Niveau', LEVEL_LABEL[r.level] ?? r.level],
    ['Doute retenu', `${eur(r.uncertaintyEur)} · ratio ${r.doubtRatio.toFixed(3)}`],
    ['Dérive', `${eur(r.dailyDrift)}/jour × ${r.daysSinceVerification} j comptés${r.coldStart ? ' (cold start)' : ''}`],
    [
      'Effacé par les saisies',
      r.observedRelief == null
        ? 'sans objet (jamais vérifié, ou enveloppe inconnue)'
        : `${eur(r.observedRelief)} — enveloppe honorée`,
    ],
    ['Assiduité', `${pct(r.activityCoverage)} des jours${r.activityDamped ? ' · doute amorti' : ''}`],
    [
      'Affichage',
      conf.relykaRange.isRange
        ? `fourchette ${eur(floorToTen(conf.relykaRange.low))} → ${eur(floorToTen(conf.relykaRange.high))}`
        : `un seul chiffre (${eur(floorToTen(conf.relykaRange.high))})`,
    ],
  ];

  return (
    <View style={[s.card, { borderColor: tone + '55' }]}>
      {rows.map(([k, v]) => (
        <View key={k} style={s.row}>
          <Text style={s.key}>{k}</Text>
          <Text style={[s.val, k === 'Niveau' && { color: tone, fontWeight: '800' }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    card: {
      borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
      marginBottom: 8, gap: 3, backgroundColor: c.card,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    key: { fontSize: 11.5, fontWeight: '700', width: 132, color: c.textSecondary },
    val: { fontSize: 11.5, flex: 1, color: c.text },
  });
}
