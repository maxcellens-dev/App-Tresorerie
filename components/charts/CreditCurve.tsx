/**
 * CreditCurve — courbes de remboursement d'un crédit, pur SVG (react-native-svg).
 * En haut : barres empilées par année civile — capital amorti (bleu) + intérêts payés (orange).
 * En bas : capital restant dû (ligne accent), même axe temporel.
 * (Deux panneaux séparés : les montants annuels et le CRD n'ont pas la même échelle — jamais de
 * double axe.) Touche une année pour afficher son détail chiffré. Recalculé en direct via props.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Rect, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { AmortRow } from '../../lib/finance/amortization';

interface Props {
  schedule: AmortRow[];
  colors: any;              // useAppColors (thème clair/sombre de l'app)
  /** Capital initial (point de départ de la courbe de CRD). */
  principal?: number;
}

interface YearAgg { year: number; interest: number; principal: number; crdEnd: number }

const BAR_H = 110;   // panneau barres
const CRD_H = 46;    // panneau CRD
const GAP_P = 14;    // espace entre panneaux
const AXIS_H = 16;   // libellés années
const PAD_L = 40;    // place des libellés d'axe Y
const PAD_R = 6;

function kfmt(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)} k€`;
  return `${Math.round(v)} €`;
}
function efmt(v: number): string {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

export default function CreditCurve({ schedule, colors, principal }: Props) {
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<number | null>(null);

  const years = useMemo<YearAgg[]>(() => {
    const by = new Map<number, YearAgg>();
    for (const r of schedule) {
      const y = Number(r.date.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      const a = by.get(y) ?? { year: y, interest: 0, principal: 0, crdEnd: r.crdAfter };
      a.interest += Math.max(0, r.interest);
      a.principal += Math.max(0, r.principalPart);
      a.crdEnd = r.crdAfter;
      by.set(y, a);
    }
    return [...by.values()].sort((a, b) => a.year - b.year);
  }, [schedule]);

  if (years.length === 0) return null;

  const cCap = colors.blue;            // capital amorti
  const cInt = colors.orange;          // intérêts payés
  const cCrd = colors.emerald;         // capital restant dû (accent)
  const cGrid = colors.cardBorder;
  const cMuted = colors.textSecondary;

  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const n = years.length;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(3, Math.min(26, slot * 0.68));
  const maxBar = Math.max(1, ...years.map((y) => y.interest + y.principal));
  const maxCrd = Math.max(1, principal ?? 0, ...years.map((y) => y.crdEnd));
  const crdTop = BAR_H + GAP_P;
  const totalH = BAR_H + GAP_P + CRD_H + AXIS_H;

  // Libellés d'années : premier, dernier, et un pas régulier entre les deux (≈ 5 ticks max).
  const step = Math.max(1, Math.ceil(n / 5));
  const showLabel = (i: number) => i === 0 || i === n - 1 || (i % step === 0 && i <= n - 1 - Math.ceil(step / 2));

  // Points de la courbe de CRD (départ = capital initial au bord gauche).
  const crdY = (v: number) => crdTop + (CRD_H - 4) * (1 - v / maxCrd) + 2;
  const pts: string[] = [];
  if (principal != null && principal > 0) pts.push(`${PAD_L},${crdY(principal)}`);
  years.forEach((y, i) => pts.push(`${PAD_L + i * slot + slot / 2},${crdY(y.crdEnd)}`));

  const selected = sel != null ? years.find((y) => y.year === sel) ?? null : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* Légende (l'identité n'est jamais portée par la couleur seule). */}
      <View style={st.legend}>
        <Dot c={cCap} /><Text style={[st.legendT, { color: cMuted }]}>Capital</Text>
        <Dot c={cInt} /><Text style={[st.legendT, { color: cMuted }]}>Intérêts</Text>
        <Dot c={cCrd} line /><Text style={[st.legendT, { color: cMuted }]}>Restant dû</Text>
      </View>
      {width > 0 && (
        <Svg width={width} height={totalH}>
          {/* Grille recessive du panneau barres (3 niveaux) + libellés k€. */}
          {[0.5, 1].map((f) => {
            const yy = BAR_H * (1 - f);
            return (
              <React.Fragment key={f}>
                <Line x1={PAD_L} y1={yy} x2={width - PAD_R} y2={yy} stroke={cGrid} strokeWidth={StyleSheet.hairlineWidth} />
                <SvgText x={PAD_L - 5} y={yy + 3.5} fontSize={9} fill={cMuted} textAnchor="end">{kfmt(maxBar * f)}</SvgText>
              </React.Fragment>
            );
          })}
          <Line x1={PAD_L} y1={BAR_H} x2={width - PAD_R} y2={BAR_H} stroke={cGrid} strokeWidth={1} />

          {/* Barres empilées : capital (bas) + intérêts (haut), séparés d'un gap de 2px, sommet arrondi. */}
          {years.map((y, i) => {
            const x = PAD_L + i * slot + (slot - barW) / 2;
            const hCap = (y.principal / maxBar) * (BAR_H - 6);
            const hInt = (y.interest / maxBar) * (BAR_H - 6);
            const dim = sel != null && sel !== y.year;
            return (
              <React.Fragment key={y.year}>
                {hCap > 0.5 && <Rect x={x} y={BAR_H - hCap} width={barW} height={hCap} rx={2} fill={cCap} opacity={dim ? 0.25 : 1} />}
                {hInt > 0.5 && <Rect x={x} y={BAR_H - hCap - (hCap > 0.5 ? 2 : 0) - hInt} width={barW} height={hInt} rx={2} fill={cInt} opacity={dim ? 0.25 : 1} />}
              </React.Fragment>
            );
          })}

          {/* Panneau CRD : ligne 2px. */}
          <Line x1={PAD_L} y1={crdTop + CRD_H} x2={width - PAD_R} y2={crdTop + CRD_H} stroke={cGrid} strokeWidth={1} />
          <SvgText x={PAD_L - 5} y={crdTop + 8} fontSize={9} fill={cMuted} textAnchor="end">{kfmt(maxCrd)}</SvgText>
          <Polyline points={pts.join(' ')} fill="none" stroke={cCrd} strokeWidth={2} strokeLinejoin="round" />

          {/* Libellés d'années. */}
          {years.map((y, i) => showLabel(i) ? (
            <SvgText key={`l${y.year}`} x={PAD_L + i * slot + slot / 2} y={totalH - 3} fontSize={9} fill={cMuted} textAnchor="middle">{y.year}</SvgText>
          ) : null)}
        </Svg>
      )}
      {/* Zones tactiles par année (au-dessus du SVG) : touche → détail chiffré. */}
      {width > 0 && (
        <View style={[StyleSheet.absoluteFill as any, { flexDirection: 'row', paddingLeft: PAD_L, paddingRight: PAD_R, top: 18 }]} pointerEvents="box-none">
          {years.map((y) => (
            <Pressable key={y.year} style={{ flex: 1 }} onPress={() => setSel(sel === y.year ? null : y.year)} />
          ))}
        </View>
      )}
      <Text style={[st.caption, { color: selected ? colors.text : cMuted }]}>
        {selected
          ? `${selected.year} · capital ${efmt(selected.principal)} · intérêts ${efmt(selected.interest)} · restant dû fin ${efmt(selected.crdEnd)}`
          : 'Touche une année pour le détail.'}
      </Text>
    </View>
  );
}

function Dot({ c, line }: { c: string; line?: boolean }) {
  return line
    ? <View style={{ width: 12, height: 2.5, borderRadius: 2, backgroundColor: c, marginRight: 4 }} />
    : <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c, marginRight: 4 }} />;
}

const st = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  legendT: { fontSize: 11, fontWeight: '600', marginRight: 10 },
  caption: { fontSize: 10.5, marginTop: 6 },
});
