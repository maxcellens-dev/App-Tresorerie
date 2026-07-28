/**
 * TroughChart — le schéma du POINT BAS DE TRÉSORERIE, avec les chiffres RÉELS de l'utilisateur.
 *
 * Pourquoi un schéma : « le solde le plus bas qu'atteindront tes comptes d'ici ta prochaine
 * rentrée d'argent » se comprend en une seconde quand on le voit descendre puis remonter, et
 * beaucoup moins en trois paragraphes. C'est aussi ce qui explique un Relyka bas un 24 du mois.
 *
 * HONNÊTETÉ DU TRACÉ : on ne dessine PAS une courbe jour par jour — le détail des opérations n'est
 * pas disponible ici, et une courbe inventée serait un mensonge graphique. On trace la ligne qui
 * relie les trois points que le moteur connaît vraiment :
 *      aujourd'hui (solde réel) → le point bas (à sa date) → après la prochaine rentrée d'argent.
 * Chaque sommet porte sa date et son montant : rien n'est illustratif, tout est mesuré.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';

export interface TroughPoint {
  /** Libellé court sous le point (« Aujourd'hui », « 24 juil. »). */
  label: string;
  amount: number;
}

interface Props {
  today: TroughPoint;
  trough: TroughPoint;
  /** Remontée après la prochaine rentrée d'argent — absente si aucune n'est connue. */
  recovery?: TroughPoint;
  /** Marge de sécurité : trait horizontal pointillé. 0 → non tracée. */
  margin?: number;
}

const H = 116;              // hauteur de la zone de courbe
const PAD_T = 14;           // air au-dessus du point le plus haut
const PAD_B = 22;           // air sous le point le plus bas (place pour la pastille)

export default function TroughChart({ today, trough, recovery, margin = 0 }: Props) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const points = [today, trough, ...(recovery ? [recovery] : [])];
  const values = [...points.map((p) => p.amount), ...(margin > 0 ? [margin] : []), 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);

  // Coordonnées en pourcentage : le SVG s'étire à la largeur disponible (viewBox 100 × H).
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.amount)}`).join(' ');
  const area = `${line} L 100 ${H - PAD_B + 6} L 0 ${H - PAD_B + 6} Z`;
  const troughIdx = 1;

  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

  return (
    <View style={styles.wrap}>
      <View style={styles.chart}>
        <Svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="troughFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.emerald} stopOpacity="0.20" />
              <Stop offset="1" stopColor={c.emerald} stopOpacity="0" />
            </LinearGradient>
          </Defs>

          {/* Marge de sécurité : le plancher qu'on ne veut pas franchir. */}
          {margin > 0 && (
            <Line
              x1="0" y1={y(margin)} x2="100" y2={y(margin)}
              stroke={c.blue} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
          )}

          <Path d={area} fill="url(#troughFill)" />
          <Path
            d={line}
            stroke={c.emerald} strokeWidth="2" fill="none"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          />

          {/* Verticale de repère sur le point bas : c'est LUI la référence du Relyka. */}
          <Line
            x1={x(troughIdx)} y1={y(trough.amount)} x2={x(troughIdx)} y2={H - PAD_B + 6}
            stroke={c.orange} strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke"
          />

          {points.map((p, i) => (
            <Circle
              key={p.label}
              cx={x(i)} cy={y(p.amount)} r={i === troughIdx ? 3.6 : 2.6}
              fill={i === troughIdx ? c.orange : c.emerald}
              stroke={c.cardSolid} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
            />
          ))}
        </Svg>

        {/* Étiquette du point bas, posée en HTML au-dessus du SVG (le texte d'un SVG étiré
            `preserveAspectRatio="none"` serait déformé horizontalement). */}
        <View
          style={[
            styles.troughTag,
            { left: `${x(troughIdx)}%`, top: y(trough.amount) - 26 },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.troughTagText}>{fmt(trough.amount)}</Text>
        </View>
      </View>

      {/* Axe : une colonne par point, montant + date. */}
      <View style={styles.axis}>
        {points.map((p, i) => (
          <View key={p.label} style={[styles.axisCell, i === 0 && { alignItems: 'flex-start' }, i === points.length - 1 && { alignItems: 'flex-end' }]}>
            <Text style={[styles.axisValue, i === troughIdx && { color: c.orange }]} numberOfLines={1}>
              {fmt(p.amount)}
            </Text>
            <Text style={styles.axisLabel} numberOfLines={1}>{p.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: c.orange }]} />
          <Text style={styles.legendText}>ton point bas — c’est de là que part ton Relyka</Text>
        </View>
        {margin > 0 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDash, { backgroundColor: c.blue }]} />
            <Text style={styles.legendText}>ta marge de sécurité ({fmt(margin)})</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { gap: 8, marginTop: 4, marginBottom: 10 },
    chart: {
      height: H, borderRadius: 14, overflow: 'hidden',
      backgroundColor: c.mode === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.045)',
      paddingHorizontal: 2,
    },
    troughTag: {
      position: 'absolute', transform: [{ translateX: -30 }],
      width: 60, alignItems: 'center',
    },
    troughTagText: {
      fontSize: 11, fontWeight: '800', color: c.orange,
      backgroundColor: c.cardSolid, borderRadius: 6,
      paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden',
    },
    axis: { flexDirection: 'row' },
    axisCell: { flex: 1, alignItems: 'center', gap: 1 },
    axisValue: { fontSize: 12, fontWeight: '800', color: c.text },
    axisLabel: { fontSize: 10.5, color: c.textSecondary },
    legend: { gap: 3 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 7, height: 7, borderRadius: 4 },
    legendDash: { width: 10, height: 2, borderRadius: 1 },
    legendText: { flex: 1, fontSize: 10.5, color: c.textSecondary, lineHeight: 15 },
  });
}
