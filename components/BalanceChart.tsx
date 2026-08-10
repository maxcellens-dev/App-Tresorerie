/**
 * BalanceChart — l'évolution du solde d'UN compte, depuis son ouverture.
 *
 * Une seule série (le solde), donc un seul langage : aire dégradée sous la courbe, ligne pleine,
 * trois repères d'axe. Ce qui la distingue de GrowthChart (projection de patrimoine) : un solde
 * peut être NÉGATIF. L'échelle part donc du minimum réel, et la ligne du ZÉRO est tracée quand la
 * courbe la traverse — sans elle, un compte passé dans le rouge se lit comme un compte qui monte.
 */
import React from 'react';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useAppColors } from '../hooks/useAppColors';
import type { BalancePoint } from '../lib/balanceHistory';

/** Montants d'axe abrégés (12 400 → « 12.4k »), même convention que les autres graphes de l'app. */
const fmtK = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1000) return `${(n / 1000).toFixed(a >= 100000 ? 0 : 1).replace('.0', '')}k`;
  return Math.round(n).toString();
};

export default function BalanceChart({ points, width, color, height = 176 }: {
  points: BalancePoint[];
  width: number;
  color: string;
  height?: number;
}) {
  const c = useAppColors();
  const padL = 42, padR = 14, padT = 20, padB = 22;
  const usableW = width - padL - padR;
  const usableH = height - padT - padB;
  if (points.length < 2 || usableW <= 0 || usableH <= 0) return null;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values, 0);           // le zéro est toujours dans le cadre
  const rawMax = Math.max(...values, 0);
  // Marge de 8 % pour que la courbe ne colle ni au plafond ni au plancher ; jamais d'échelle plate.
  const span = Math.max(rawMax - rawMin, 1);
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const x = (i: number) => padL + (i / (points.length - 1)) * usableW;
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * usableH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const baseY = y(Math.max(min, Math.min(0, max)));  // l'aire descend jusqu'au zéro
  const area = `${line} L ${x(points.length - 1)} ${baseY} L ${x(0)} ${baseY} Z`;

  // Repères : début, milieu, fin. Le dernier point (aujourd'hui) porte sa valeur — c'est le solde.
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const last = points[points.length - 1];
  const crossesZero = rawMin < 0 && rawMax > 0;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.32" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>

      {/* Grille : trois niveaux chiffrés, du bas vers le haut de l'échelle réelle. */}
      {[0, 0.5, 1].map((p, i) => {
        const value = min + (max - min) * p;
        const yy = y(value);
        return (
          <React.Fragment key={i}>
            <Line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke={c.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padL - 6} y={yy + 4} fill={c.textSecondary} fontSize={9} textAnchor="end">{fmtK(value)}</SvgText>
          </React.Fragment>
        );
      })}

      {/* Le ZÉRO, tracé plein, uniquement s'il est franchi : c'est la seule ligne qui change le sens
          de la courbe (au-dessus on a de l'argent, en dessous on en doit). */}
      {crossesZero && (
        <Line x1={padL} y1={y(0)} x2={width - padR} y2={y(0)} stroke={c.danger} strokeWidth={1} strokeOpacity={0.55} />
      )}

      <Path d={area} fill="url(#balanceGrad)" />
      <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" />

      {ticks.map((t, idx) => (
        <SvgText key={`lbl-${t}`} x={x(t)} y={height - 5} fill={c.textSecondary} fontSize={9}
          textAnchor={idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'middle'}>
          {points[t].label}
        </SvgText>
      ))}

      <Circle cx={x(points.length - 1)} cy={y(last.value)} r={4} fill={color} />
    </Svg>
  );
}
