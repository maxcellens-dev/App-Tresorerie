/**
 * CategoryDonut — anneau (donut) de répartition par catégorie (§N2).
 * Segments proportionnels (Ionicons-free, pur SVG). La sélection/filtrage se fait via la légende
 * côté appelant ; ici on met en évidence le segment actif (opacité réduite des autres).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export interface DonutSegment { key: string; value: number; color: string }

interface Props {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  activeKey?: string | null;
  centerLabel?: string;
  centerSub?: string;
  centerColor?: string;
  /** Couleur du sous-libellé central. Défaut : couleur du libellé (lisible clair/sombre). */
  centerSubColor?: string;
}

export default function CategoryDonut({ segments, size = 150, strokeWidth = 20, activeKey, centerLabel, centerSub, centerColor = '#fff', centerSubColor }: Props) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * r;

  // Longueur d'arc par segment : une tranche non nulle a une longueur MINIMALE visible (sinon une
  // toute petite part — ex. 9 € sur 1400 € — apparaît comme un trait/glitch). Le surplus ajouté aux
  // petites tranches est repris sur la plus grande, pour que Σ(longueurs) reste = circonférence.
  const lens: number[] = [];
  if (total > 0) {
    const MIN_LEN = Math.min(C * 0.03, 8); // ~3 % de l'anneau, plafonné
    let extra = 0;
    let maxIdx = 0;
    segments.forEach((s, i) => {
      const v = Math.max(0, s.value);
      let len = (v / total) * C;
      if (v > 0 && len < MIN_LEN) { extra += MIN_LEN - len; len = MIN_LEN; }
      lens[i] = len;
      if ((segments[maxIdx]?.value ?? 0) < s.value) maxIdx = i;
    });
    if (extra > 0) lens[maxIdx] = Math.max(0, lens[maxIdx] - extra); // compense sur la plus grande part
  }

  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {/* Piste de fond */}
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
        {total > 0 && segments.map((s, i) => {
          const len = lens[i] ?? 0;
          if (len <= 0) return null;
          const dash = `${len} ${C - len}`;
          const el = (
            <Circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              opacity={!activeKey || activeKey === s.key ? 1 : 0.25}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += len;
          return el;
        })}
      </Svg>
      {!!centerLabel && (
        <View style={StyleSheet.absoluteFillObject as any} pointerEvents="none">
          <View style={styles.center}>
            <Text style={[styles.label, { color: centerColor }]} numberOfLines={1}>{centerLabel}</Text>
            {!!centerSub && <Text style={[styles.sub, { color: centerSubColor ?? centerColor }]}>{centerSub}</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 10, opacity: 0.6, marginTop: 1 },
});
