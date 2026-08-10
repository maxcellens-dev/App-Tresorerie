/**
 * SQUELETTES — les briques d'une page qui s'ouvre AVANT d'avoir son contenu.
 *
 * Un rond de chargement dit « l'app travaille » ; un squelette dit « la page est là, elle se
 * remplit ». C'est toute la différence entre une navigation qui paraît lente et une navigation
 * instantanée, alors que le délai est le MÊME. On dessine donc la FORME de la page — ses cartes,
 * ses lignes, ses colonnes — pendant qu'elle se monte.
 *
 * ⚠️ UN SEUL MOTEUR D'ANIMATION, au niveau du module. Une page de squelette, c'est vingt à trente
 * blocs : leur donner chacun son `Animated.Value` et sa boucle ferait payer au squelette exactement
 * le travail qu'il est censé masquer — et la scintillation serait désynchronisée d'un bloc à
 * l'autre. Ici tous les blocs lisent la même valeur, animée tant qu'au moins un est monté.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View, StyleSheet, type StyleProp, type ViewStyle, type DimensionValue } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';

// ── Moteur partagé ────────────────────────────────────────────────────────────────────────────
const shimmer = new Animated.Value(0);
let mountedCount = 0;
let loop: Animated.CompositeAnimation | null = null;

function acquireShimmer(): () => void {
  if (++mountedCount === 1) {
    loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(shimmer, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    loop.start();
  }
  return () => {
    if (--mountedCount === 0) { loop?.stop(); loop = null; shimmer.setValue(0); }
  };
}

/** Opacité respirante partagée par tous les blocs montés. */
const breath = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

/** Bloc gris qui respire — la brique de base de tous les squelettes. */
export function SkeletonBlock({ w = '100%', h = 14, r = 8, style }: {
  w?: DimensionValue;
  h?: number;
  /** Rayon des coins. 999 pour une pastille. */
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useAppColors();
  useEffect(() => acquireShimmer(), []);
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.cardBorder, opacity: breath }, style]}
    />
  );
}

/** Carte vide aux dimensions d'une vraie carte de l'app (même fond, même bordure, même rayon). */
export function SkeletonCard({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Rangée de lignes de liste, dans une carte — la forme la plus fréquente de l'app. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  // Largeurs LÉGÈREMENT variables : des lignes toutes identiques se lisent comme un motif, pas
  // comme du contenu. Déterministes (pas de Math.random) → aucun scintillement entre deux rendus.
  const widths: DimensionValue[] = ['62%', '48%', '70%', '55%', '66%', '44%', '58%'];
  return (
    <View style={styles.listCard}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[styles.row, i === rows - 1 && styles.rowLast]}>
          <SkeletonBlock w={26} h={26} r={999} />
          <View style={styles.rowText}>
            <SkeletonBlock w="34%" h={9} />
            <SkeletonBlock w={widths[i % widths.length]} h={12} style={{ marginTop: 7 }} />
          </View>
          <SkeletonBlock w={62} h={13} />
        </View>
      ))}
    </View>
  );
}

/** Rangée de tuiles de largeur égale (actions, statistiques). */
export function SkeletonTiles({ count = 4, height = 74 }: { count?: number; height?: number }) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.tileRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.tile, { height }]}>
          <SkeletonBlock w={30} h={30} r={999} />
          <SkeletonBlock w="70%" h={8} style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

/** Emplacement d'un graphique : cadre + une silhouette de courbe en barres dégressives. */
export function SkeletonChart({ height = 150 }: { height?: number }) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const bars = [0.45, 0.7, 0.55, 0.85, 0.65, 0.95, 0.75];
  return (
    <View style={[styles.chart, { height }]}>
      {bars.map((f, i) => (
        <SkeletonBlock key={i} w={16} h={Math.round((height - 34) * f)} r={5} />
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 16, padding: 16,
    },
    listCard: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, overflow: 'hidden',
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 14, paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: c.cardBorder,
    },
    rowLast: { borderBottomWidth: 0 },
    rowText: { flex: 1 },
    tileRow: { flexDirection: 'row', gap: 8 },
    tile: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14,
    },
    chart: {
      flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16,
    },
  });
}
