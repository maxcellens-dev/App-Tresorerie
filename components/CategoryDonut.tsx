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
}

export default function CategoryDonut({ segments, size = 150, strokeWidth = 20, activeKey, centerLabel, centerSub, centerColor = '#fff' }: Props) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {/* Piste de fond */}
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
        {total > 0 && segments.map((s) => {
          const frac = Math.max(0, s.value) / total;
          const len = frac * C;
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
            {!!centerSub && <Text style={styles.sub}>{centerSub}</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
});
