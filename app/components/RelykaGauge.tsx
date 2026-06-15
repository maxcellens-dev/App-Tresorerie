/**
 * RelykaGauge — jauge circulaire (speedomètre 270°, ouverte en bas) représentant
 * « Ton Relyka » (reste à vivre). Les segments colorés reprennent les couleurs des
 * recommandations, proportionnellement à leur montant rapporté au Relyka :
 *  - Si le total des recos < Relyka → une partie reste vide (track transparent).
 *  - Si Relyka = 0 → jauge entièrement vide.
 *  - Si le total des recos dépasse le Relyka → on clampe le remplissage à 100 %.
 * Dynamique : passez la liste des recos visibles, le visuel suit.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CURRENCY_SYMBOL } from '../lib/currency';

export interface GaugeSegment { amount: number; color: string }

interface Props {
  amount: number;                // Montant du Relyka (reste à vivre) au centre
  segments: GaugeSegment[];      // Recos visibles (montant + couleur)
  amountColor: string;           // Couleur du montant central
  label?: string;                // Sous-titre optionnel sous le montant (vide = rien)
  size?: number;
  strokeWidth?: number;
  trackColor?: string;           // Couleur de la partie « vide »
  /** Clic sur un segment → renvoie l'index de la reco (dans `segments`). */
  onSegmentPress?: (index: number) => void;
}

const BASE = 225;   // angle de départ (bas-gauche) en degrés, sens horaire depuis le haut
const SWEEP = 270;  // amplitude totale de la jauge

// Coordonnée d'un point sur le cercle (0° = haut, sens horaire). Périodique → tolère a > 360.
function pt(cx: number, cy: number, r: number, a: number) {
  const rad = (a * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}
function arc(cx: number, cy: number, r: number, a1: number, a2: number) {
  const p1 = pt(cx, cy, r, a1);
  const p2 = pt(cx, cy, r, a2);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
}

export default function RelykaGauge({
  amount,
  segments,
  amountColor,
  label,
  size = 200,
  strokeWidth = 18,
  trackColor = 'rgba(255,255,255,0.07)',
  onSegmentPress,
}: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2 - 2;

  // Le graphique représente la RÉPARTITION des recos entre elles (Investir / Épargne /
  // Conserver / Se faire plaisir) : le total = somme des montants des recos, chaque segment
  // proportionnel à sa part. La jauge se remplit donc entièrement, répartie « à la hauteur des montants ».
  const denom = segments.reduce((sum, s) => sum + Math.max(0, s.amount), 0);
  let cum = 0;
  const filled: { a1: number; a2: number; color: string; idx: number }[] = [];
  if (denom > 0) {
    segments.forEach((s, i) => {
      if (s.amount <= 0) return;
      const start = cum;
      cum = Math.min(1, cum + s.amount / denom);
      if (cum <= start) return;
      filled.push({ a1: BASE + start * SWEEP, a2: BASE + cum * SWEEP, color: s.color, idx: i });
    });
  }

  const fmt = Math.round(amount).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {/* Track (partie vide / transparente) */}
        <Path
          d={arc(cx, cy, r, BASE, BASE + SWEEP)}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
        {/* Segments colorés (recos) — cliquables pour aller à la reco concernée. */}
        {filled.map((seg, i) => (
          <Path
            key={i}
            d={arc(cx, cy, r, seg.a1, seg.a2)}
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            onPress={onSegmentPress ? () => onSegmentPress(seg.idx) : undefined}
          />
        ))}
      </Svg>
      {/* Centre : montant + label — non cliquable (le clic ne doit agir que sur les segments). */}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {fmt}
        </Text>
        {!!label && <Text style={styles.label}>{label}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  label: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 4 },
});
