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
import { View, Text, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
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

  // Le graphique représente la part de chaque reco RAPPORTÉE AU TOTAL du Relyka (montant central).
  // Donc le dénominateur = le Relyka, pas la somme des recos : si une reco est ignorée, sa portion
  // laisse un vide (track) au lieu d'être redistribuée, et l'ensemble ne se remplit jamais à plus de 100 %.
  const denom = Math.max(0, amount);
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
  // Taille adaptée à la longueur (montant élevé + devise longue type « CHF ») pour que TOUTE la
  // valeur + le signe restent visibles. adjustsFontSizeToFit étant peu fiable (Android), on calcule
  // une base selon le nombre de caractères ; le fit reste un filet de sécurité pour les cas extrêmes.
  const amountFontSize = (() => {
    const n = fmt.length;
    if (n <= 7) return 34;   // « 9 999 € »
    if (n <= 9) return 30;   // « 99 999 € »
    if (n <= 11) return 25;  // « 123 456 € » / « 12 500 CHF »
    if (n <= 13) return 21;  // « 1 234 567 € »
    return 18;
  })();

  // Détection du segment au tap : calcule l'angle depuis le centre (compatible web ET natif,
  // contrairement à onPress sur un <Path> SVG). N'agit que sur l'anneau (pas au centre).
  const handlePress = (e: GestureResponderEvent) => {
    if (!onSegmentPress || filled.length === 0) return;
    const ne: any = e.nativeEvent;
    const x = ne.locationX ?? ne.offsetX;
    const y = ne.locationY ?? ne.offsetY;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const dx = x - cx;
    const dy = y - cy;
    const radius = Math.sqrt(dx * dx + dy * dy);
    // Ignore le centre et l'extérieur : on ne réagit que sur la bande de l'anneau.
    if (radius < r - strokeWidth || radius > r + strokeWidth) return;
    // Angle : 0° = haut, sens horaire (même convention que pt()).
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (a < 0) a += 360;
    if (a < BASE) a += 360;            // ramène dans [BASE, BASE+360)
    if (a > BASE + SWEEP) return;       // dans le « trou » du bas → rien
    const hit = filled.find((seg) => a >= seg.a1 && a <= seg.a2);
    if (hit) onSegmentPress(hit.idx);
  };

  return (
    <Pressable style={{ alignItems: 'center', justifyContent: 'center' }} onPress={handlePress}>
      <Svg width={size} height={size} pointerEvents="none">
        {/* Track (partie vide / transparente) */}
        <Path
          d={arc(cx, cy, r, BASE, BASE + SWEEP)}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
        {/* Segments colorés (recos) */}
        {filled.map((seg, i) => (
          <Path
            key={i}
            d={arc(cx, cy, r, seg.a1, seg.a2)}
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </Svg>
      {/* Centre : montant + label — non cliquable (le clic ne doit agir que sur les segments). */}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Text
          style={[styles.amount, { color: amountColor, fontSize: amountFontSize }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {fmt}
        </Text>
        {!!label && <Text style={styles.label}>{label}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  label: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 4 },
});
