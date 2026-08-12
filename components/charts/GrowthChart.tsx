/**
 * GrowthChart — la courbe de projection du patrimoine.
 *
 * Extraite de l'écran Projection pour être RÉUTILISÉE telle quelle par les écrans de présentation :
 * la maquette d'accueil redessinait sa propre courbe et avait fini par diverger (pas d'axes, pas de
 * capital investi, épaisseurs et opacités différentes). Une seule implémentation = une seule allure,
 * quoi qu'on change ensuite.
 *
 * Langage graphique : aire dégradée sous la VALEUR, ligne pointillée pour le CAPITAL INVESTI (ce
 * qu'on a versé), trois repères chiffrés (début / milieu / fin) et trois lignes de grille.
 */
import React from 'react';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useAppColors } from '../../hooks/theme/useAppColors';

export interface GrowthPoint { label: string; value: number; contributed: number }

/** Montants d'axe abrégés (12 400 → « 12.4k »). Partagé avec les autres graphes de la Projection. */
export const fmtK = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.0', '')}k`;
  return Math.round(n).toString();
};

export default function GrowthChart({ points, width, color, height = 200, gradientId = 'growthGrad' }: {
  points: GrowthPoint[];
  width: number;
  color: string;
  /** Hauteur totale, marges d'axes comprises. Réduite dans les maquettes de présentation. */
  height?: number;
  /** Deux courbes affichées en même temps = deux dégradés, donc deux identifiants distincts. */
  gradientId?: string;
}) {
  const c = useAppColors();
  const h = height;
  const padL = 44, padR = 16, padT = 26, padB = 24;
  const usableW = width - padL - padR;
  const usableH = h - padT - padB;
  if (points.length < 2 || usableW <= 0 || usableH <= 0) return null;

  const maxVal = Math.max(...points.map(p => p.value), 1);
  const x = (i: number) => padL + (i / (points.length - 1)) * usableW;
  const y = (v: number) => padT + (1 - v / maxVal) * usableH;

  const valLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${valLine} L ${x(points.length - 1)} ${padT + usableH} L ${x(0)} ${padT + usableH} Z`;
  const contribLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.contributed)}`).join(' ');

  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <Svg width={width} height={h}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.35" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {[0, 0.5, 1].map((p, i) => {
        const yy = padT + (1 - p) * usableH;
        return (
          <React.Fragment key={i}>
            <Line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke={c.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padL - 6} y={yy + 4} fill={c.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxVal * p)}</SvgText>
          </React.Fragment>
        );
      })}
      <Path d={area} fill={`url(#${gradientId})`} />
      <Path d={contribLine} stroke={c.textSecondary} strokeWidth={1.5} strokeDasharray="5,4" fill="none" />
      <Path d={valLine} stroke={color} strokeWidth={2.5} fill="none" />
      {/* Points + valeurs sur 3 années (début, milieu, fin) */}
      {ticks.map((t, idx) => {
        const px = x(t), py = y(points[t].value);
        const anchor = idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'middle';
        const tx = idx === 0 ? px - 2 : idx === ticks.length - 1 ? px + 2 : px;
        return (
          <React.Fragment key={`pt-${t}`}>
            <Circle cx={px} cy={py} r={3.5} fill={color} />
            <SvgText x={tx} y={py - 8} fill={color} fontSize={10} fontWeight="700" textAnchor={anchor as any}>{fmtK(points[t].value)}</SvgText>
            <SvgText x={px} y={h - 6} fill={c.textSecondary} fontSize={9} textAnchor="middle">{points[t].label}</SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
