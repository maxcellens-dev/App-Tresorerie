/**
 * DÉPENSÉ vs BUDGET — barres + trait repère.
 *
 * La barre est le dépensé, le TRAIT est le budget. Deux barres côte à côte auraient obligé à
 * comparer deux hauteurs ; un trait posé en travers rend le dépassement immédiat — on voit ce qui
 * dépasse, littéralement.
 *
 * LE TRAIT SUIT L'HISTORIQUE. Si le budget est passé de 950 à 1 000 € en juillet, le repère change
 * de hauteur à ce mois-là. Un trait plat sur six mois mentirait sur ce qui s'est réellement passé —
 * et c'est justement l'information qu'on vient chercher dans un reporting.
 *
 * COULEUR : ambre au-dessus du trait (c'est la couleur des dépenses variables dans le thème),
 * jamais le rouge, réservé au danger réel. Un mois SANS budget n'a pas de trait du tout : pas de
 * repère à zéro, donc pas de dépassement fantôme.
 */
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Rect, Line, G, Text as SvgText } from 'react-native-svg';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { BudgetMonthPoint } from '../../lib/finance/budgetEngine';

const fmtFull = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

interface Props {
  data: BudgetMonthPoint[];
  width: number;
  /** Index sélectionné piloté par le parent (le détail par catégorie suit le mois choisi). */
  selected?: number;
  onSelect?: (index: number) => void;
}

export default function BudgetBars({ data, width, selected, onSelect }: Props) {
  const C = useAppColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);

  const sel = selected != null ? selected : (active != null && active < data.length ? active : data.length - 1);
  useEffect(() => { if (selected == null && active != null && active >= data.length) setActive(null); }, [data.length, active, selected]);

  if (!data.length) return <Text style={s.empty}>Pas encore assez d'historique.</Text>;

  const chartH = 150, padT = 14, axisW = 44;
  const groupW = (width - axisW - 4) / data.length;
  const barW = Math.min(26, groupW * 0.46);
  const usableH = chartH - padT;
  // L'échelle englobe le budget ET le dépensé : sinon un dépassement sortirait du cadre, ou un
  // budget très supérieur au dépensé écraserait toutes les barres en bas du graphe.
  const maxVal = Math.max(...data.map((d) => Math.max(d.spent, d.budget)), 1);
  const selData = data[sel];

  const pick = (i: number) => { setActive(i); onSelect?.(i); };

  return (
    <View>
      <View style={s.legendRow}>
        <View style={s.legendItem}><View style={[s.dot, { backgroundColor: C.primary }]} /><Text style={s.legendText}>Dépensé</Text></View>
        <View style={s.legendItem}><View style={[s.dash, { backgroundColor: C.text }]} /><Text style={s.legendText}>Budget</Text></View>
      </View>

      <View>
        <Svg width={width} height={chartH + 30}>
          {[0, 0.5, 1].map((pct, i) => {
            const y = padT + (1 - pct) * usableH;
            return (
              <G key={i}>
                <Line x1={axisW} y1={y} x2={width} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
                <SvgText x={axisW - 4} y={y + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxVal * pct)}</SvgText>
              </G>
            );
          })}
          {data.map((d, i) => {
            const gx = axisW + 4 + i * groupW;
            const bx = gx + (groupW - barW) / 2;
            const h = (Math.max(0, d.spent) / maxVal) * usableH;
            const over = d.hasBudget && d.spent > d.budget;
            const color = over ? C.warning : C.primary;
            const on = sel === i;
            const yBudget = d.hasBudget ? chartH - (d.budget / maxVal) * usableH : null;
            return (
              <G key={d.monthKey}>
                {on && <Rect x={gx} y={0} width={groupW} height={chartH} rx={8} fill={color + '18'} />}
                {h > 0.5 && <Rect x={bx} y={chartH - h} width={barW} height={h} rx={3} fill={color} opacity={on ? 1 : 0.55} />}
                {d.spent <= 0 && <Rect x={bx} y={chartH - 1} width={barW} height={1} fill={C.cardBorder} />}
                {/* Le repère déborde de la barre : il se lit comme un niveau, pas comme un chapeau. */}
                {yBudget != null && (
                  <Line
                    x1={bx - 5} y1={yBudget} x2={bx + barW + 5} y2={yBudget}
                    stroke={C.text} strokeWidth={2} strokeLinecap="round" opacity={on ? 1 : 0.55}
                  />
                )}
                <SvgText
                  x={gx + groupW / 2} y={chartH + 14}
                  fill={on ? C.text : C.textSecondary} fontSize={10} fontWeight={on ? '700' : '400'} textAnchor="middle"
                >
                  {d.label.split(' ')[0].slice(0, 4)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: axisW + 4, right: 0, flexDirection: 'row' }}>
          {data.map((d, i) => (
            <TouchableOpacity
              key={d.monthKey}
              style={{ width: groupW, height: '100%' }}
              activeOpacity={0.55}
              onPress={() => pick(i)}
              accessibilityRole="button"
              accessibilityLabel={`${d.label} — ${fmtFull(d.spent)} dépensés${d.hasBudget ? ` sur ${fmtFull(d.budget)} de budget` : ', sans budget'}`}
              accessibilityState={{ selected: sel === i }}
            />
          ))}
        </View>
      </View>

      {/* LES TROIS CHIFFRES DE LA COLONNE CHOISIE — budget, dépensé, écart.
          Un graphe sans ses valeurs oblige à estimer une hauteur à l'œil ; c'est acceptable pour
          une tendance, pas quand la question est « de combien ai-je dépassé ». */}
      {selData && (
        <View style={s.detail}>
          <Text style={s.detailMonth}>{selData.label}</Text>
          {selData.hasBudget ? (
            <View style={s.detailVals}>
              <View style={s.detailItem}>
                <Text style={s.detailLabel}>Budget</Text>
                <Text style={s.detailValue}>{fmtFull(selData.budget)}</Text>
              </View>
              <View style={s.detailItem}>
                <Text style={s.detailLabel}>Dépensé</Text>
                <Text style={s.detailValue}>{fmtFull(selData.spent)}</Text>
              </View>
              <View style={s.detailItem}>
                <Text style={s.detailLabel}>Écart</Text>
                <Text style={[s.detailValue, { color: (selData.gap ?? 0) >= 0 ? C.success : C.warning, fontWeight: '800' }]}>
                  {(selData.gap ?? 0) >= 0 ? `−${fmtFull(selData.gap ?? 0)}` : `+${fmtFull(-(selData.gap ?? 0))}`}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={s.detailNone}>{fmtFull(selData.spent)} dépensés · aucun budget fixé ce mois-là</Text>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    dash: { width: 12, height: 2, borderRadius: 1 },
    legendText: { fontSize: 11, color: c.textSecondary },
    empty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 28 },
    detail: {
      marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    detailMonth: { fontSize: 12, fontWeight: '700', color: c.text, textTransform: 'capitalize', marginBottom: 8 },
    detailVals: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    detailItem: { flex: 1 },
    detailLabel: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700', color: c.textSecondary, marginBottom: 3 },
    detailValue: { fontSize: 13.5, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
    detailNone: { fontSize: 12, color: c.textSecondary },
  });
}
