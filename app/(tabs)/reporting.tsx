import { View, Text, StyleSheet, ScrollView, RefreshControl, useWindowDimensions, TouchableOpacity, Platform } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// onPress n'est pas reconnu par les éléments SVG sur web — on utilise onClick à la place
const svgPress = (handler: () => void): Record<string, unknown> =>
  Platform.OS === 'web' ? { onClick: handler } : { onPress: handler };
import Svg, { Rect, Text as SvgText, Line, Path, G, Circle } from 'react-native-svg';
import { useTransactions } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { usePilotageData } from '../../hooks/usePilotageData';
import { useSharedContribution } from '../../hooks/useSharedContribution';
import { useProfile } from '../../hooks/useProfile';
import { usePlan } from '../../hooks/usePlan';
import { useNavBack } from '../../hooks/useNavBack';
import { ACCOUNT_COLORS } from '../../theme/colors';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL, convertAmount } from '../../lib/currency';
import { useCurrencyRates } from '../../hooks/useCurrencyRates';
import { todayISO } from '../../lib/dateUtils';
import { computeSecurityCushion } from '../../lib/securityCushion';
import { buildPerimeterCtx, transformFluxTransactions } from '../../lib/perimeter';
import {
  monthsWindow, buildMonthlyFlux, buildSavingsSeries, buildCategoryBreakdown,
  buildTopCategoriesCompare, buildBalanceSeries, buildInsights,
  type ReportTx, type InsightTone,
} from '../../lib/reportingEngine';

/* ── Palette catégorielle VALIDÉE (dataviz) — light/dark, ordre fixe (jamais cyclé). ── */
const CAT_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

/* ── Couleurs sémantiques (indépendantes du thème pour la lisibilité des graphes). ── */
const SEM = { income: '#1baf7a', incomeDark: '#199e70', expense: '#e34948', expenseDark: '#e66767', amber: '#eda100', violet: '#4a3aa7' };

function useReportingColors() {
  const t = useAppColors();
  const cat = t.mode === 'light' ? CAT_LIGHT : CAT_DARK;
  return {
    ...t,
    cat,
    catMuted: t.textSecondary,
    income: t.mode === 'light' ? SEM.income : SEM.incomeDark,
    expense: t.mode === 'light' ? SEM.expense : SEM.expenseDark,
    amber: t.mode === 'light' ? SEM.amber : '#c98500',
    violet: t.mode === 'light' ? SEM.violet : '#9085e9',
  };
}

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return n.toFixed(0);
};
const fmtFull = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
const fmtSigned = (n: number) => `${n >= 0 ? '+' : '−'}${fmtFull(Math.abs(n))}`;

/* ═══ Barres groupées Revenus vs Dépenses — colonne entière cliquable + bandeau détail.
   Les zones tapables sont des Views RN SUPERPOSÉES au SVG : les événements de clic sur les
   éléments SVG sont peu fiables selon la plateforme (web/natif) — les Views, elles, le sont. ═══ */
function IncomeExpenseBars({ data, width }: { data: { label: string; income: number; expense: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);
  const chartH = 170, padT = 12;
  const groupW = (width - 52) / Math.max(1, data.length);
  const barW = Math.min(20, groupW * 0.32);
  const gap = 4;
  const usableH = chartH - padT;
  const maxVal = Math.max(...data.flatMap((d) => [d.income, d.expense]), 1);
  // Toujours un mois sélectionné (le dernier par défaut) → le détail est visible d'emblée.
  const sel = active != null && active < data.length ? active : data.length - 1;
  const selData = data[sel];
  return (
    <View>
      <View>
        <Svg width={width} height={chartH + 30}>
          {[0, 0.5, 1].map((pct, i) => {
            const y = padT + (1 - pct) * usableH;
            return (
              <G key={i}>
                <Line x1={44} y1={y} x2={width} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
                <SvgText x={40} y={y + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxVal * pct)}</SvgText>
              </G>
            );
          })}
          {data.map((d, i) => {
            const gx = 48 + i * groupW;
            const x = gx + (groupW - barW * 2 - gap) / 2;
            const ih = (d.income / maxVal) * usableH;
            const eh = (d.expense / maxVal) * usableH;
            const on = sel === i;
            return (
              <G key={i}>
                {on && <Rect x={gx} y={0} width={groupW} height={chartH} rx={8} fill={C.violet + '14'} />}
                <Rect x={x} y={chartH - ih} width={barW} height={Math.max(ih, 1)} rx={4} fill={C.income} opacity={on ? 1 : 0.5} />
                <Rect x={x + barW + gap} y={chartH - eh} width={barW} height={Math.max(eh, 1)} rx={4} fill={C.expense} opacity={on ? 1 : 0.5} />
                <SvgText x={x + barW + gap / 2} y={chartH + 14} fill={on ? C.text : C.textSecondary} fontSize={10} fontWeight={on ? '700' : '400'} textAnchor="middle">{d.label}</SvgText>
              </G>
            );
          })}
        </Svg>
        {/* Zones tapables (une par mois), par-dessus le SVG. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 48, right: 0, flexDirection: 'row' }}>
          {data.map((_, i) => (
            <TouchableOpacity key={i} style={{ width: groupW, height: '100%' }} activeOpacity={0.55} onPress={() => setActive(i)} accessibilityRole="button" />
          ))}
        </View>
      </View>
      {/* Bandeau détail du mois sélectionné (revenus · dépenses · net). */}
      {selData ? (
        <View style={s.ieDetail}>
          <Text style={s.ieDetailMonth}>{selData.label}</Text>
          <View style={s.ieDetailVals}>
            <View style={s.ieDetailItem}><View style={[s.legendDot, { backgroundColor: C.income }]} /><Text style={s.ieDetailTxt}>{fmtFull(selData.income)}</Text></View>
            <View style={s.ieDetailItem}><View style={[s.legendDot, { backgroundColor: C.expense }]} /><Text style={s.ieDetailTxt}>{fmtFull(selData.expense)}</Text></View>
            <View style={s.ieDetailItem}><Text style={s.ieDetailNetLabel}>Net</Text><Text style={[s.ieDetailTxt, { color: selData.income - selData.expense >= 0 ? C.income : C.expense, fontWeight: '800' }]}>{fmtSigned(selData.income - selData.expense)}</Text></View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ═══ Barres « Mis de côté chaque mois » — virements réels vers épargne (vert) / invest (violet),
   EMPILÉS par mois. Même interaction que Revenus vs Dépenses : colonne tapable + bandeau détail. ═══ */
function SavingsBars({ data, width }: { data: { label: string; saved: number; savings: number; invest: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);
  if (!data.length) return <Text style={s.emptyChart}>Pas encore assez d'historique.</Text>;
  const total = data.reduce((a, d) => a + d.saved, 0);
  if (total <= 0) {
    return <Text style={s.emptyChart}>Aucun virement vers l'épargne ou l'investissement sur la période. Tes virements apparaîtront ici.</Text>;
  }
  const chartH = 150, padT = 12;
  const groupW = (width - 52) / data.length;
  const barW = Math.min(26, groupW * 0.45);
  const usableH = chartH - padT;
  const maxVal = Math.max(...data.map((d) => d.saved), 1);
  const sel = active != null && active < data.length ? active : data.length - 1;
  const selData = data[sel];
  const cSav = ACCOUNT_COLORS.savings;
  const cInv = ACCOUNT_COLORS.investment;
  return (
    <View>
      <View style={s.legendRow}>
        <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: cSav }]} /><Text style={s.legendSmall}>Épargne</Text></View>
        <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: cInv }]} /><Text style={s.legendSmall}>Investissement</Text></View>
      </View>
      <View>
        <Svg width={width} height={chartH + 30}>
          {[0, 0.5, 1].map((pct, i) => {
            const y = padT + (1 - pct) * usableH;
            return (
              <G key={i}>
                <Line x1={44} y1={y} x2={width} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
                <SvgText x={40} y={y + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxVal * pct)}</SvgText>
              </G>
            );
          })}
          {data.map((d, i) => {
            const gx = 48 + i * groupW;
            const bx = gx + (groupW - barW) / 2;
            const hSav = (d.savings / maxVal) * usableH;
            const hInv = (d.invest / maxVal) * usableH;
            const on = sel === i;
            const op = on ? 1 : 0.5;
            // Empilé : épargne en bas, invest au-dessus, 2 px d'écart entre segments.
            const gapSeg = hSav > 0.5 && hInv > 0.5 ? 2 : 0;
            const yInv = chartH - hSav - gapSeg - hInv;
            return (
              <G key={i}>
                {on && <Rect x={gx} y={0} width={groupW} height={chartH} rx={8} fill={cSav + '18'} />}
                {hSav > 0.5 && <Rect x={bx} y={chartH - hSav} width={barW} height={hSav} rx={3} fill={cSav} opacity={op} />}
                {hInv > 0.5 && <Rect x={bx} y={yInv} width={barW} height={hInv} rx={3} fill={cInv} opacity={op} />}
                {d.saved <= 0 && <Rect x={bx} y={chartH - 1} width={barW} height={1} fill={C.cardBorder} />}
                <SvgText x={gx + groupW / 2} y={chartH + 14} fill={on ? C.text : C.textSecondary} fontSize={10} fontWeight={on ? '700' : '400'} textAnchor="middle">{d.label}</SvgText>
              </G>
            );
          })}
        </Svg>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 48, right: 0, flexDirection: 'row' }}>
          {data.map((_, i) => (
            <TouchableOpacity key={i} style={{ width: groupW, height: '100%' }} activeOpacity={0.55} onPress={() => setActive(i)} accessibilityRole="button" />
          ))}
        </View>
      </View>
      {selData ? (
        <View style={s.ieDetail}>
          <Text style={s.ieDetailMonth}>{selData.label}</Text>
          <View style={s.ieDetailVals}>
            <View style={s.ieDetailItem}><View style={[s.legendDot, { backgroundColor: cSav }]} /><Text style={s.ieDetailTxt}>{fmtFull(selData.savings)}</Text></View>
            <View style={s.ieDetailItem}><View style={[s.legendDot, { backgroundColor: cInv }]} /><Text style={s.ieDetailTxt}>{fmtFull(selData.invest)}</Text></View>
            <View style={s.ieDetailItem}><Text style={s.ieDetailNetLabel}>Total</Text><Text style={[s.ieDetailTxt, { fontWeight: '800' }]}>{fmtFull(selData.saved)}</Text></View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ═══ Courbe « Valeur de tes investissements » — regard sur le PASSÉ (≠ page Projection, qui
   projette des années à venir). Un seul axe (€). Apports du mois affichés dans le bandeau détail. ═══ */
function InvestmentValueChart({ points, apports, width }: {
  points: { label: string; value: number }[]; apports: number[]; width: number;
}) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <Text style={s.emptyChart}>Pas encore assez d'historique.</Text>;

  const color = ACCOUNT_COLORS.investment;
  const chartH = 150, padT = 12, padL = 48, padR = 12;
  const usableW = width - padL - padR;
  const usableH = chartH - padT;
  const maxVal = Math.max(...points.map((p) => p.value), 1);
  const minVal = Math.min(...points.map((p) => p.value), 0);
  const range = maxVal - minVal || 1;
  const x = (i: number) => padL + (i / (points.length - 1)) * usableW;
  const y = (v: number) => padT + (1 - (v - minVal) / range) * usableH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${chartH} L ${x(0)} ${chartH} Z`;
  const sel = active != null && active < points.length ? active : points.length - 1;
  const zoneW = usableW / Math.max(1, points.length - 1);

  return (
    <View>
      <View>
        <Svg width={width} height={chartH + 26}>
          {[0, 0.5, 1].map((pct, i) => {
            const yy = padT + (1 - pct) * usableH;
            return (
              <G key={i}>
                <Line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
                <SvgText x={padL - 6} y={yy + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(minVal + pct * range)}</SvgText>
              </G>
            );
          })}
          <Path d={area} fill={color} fillOpacity={0.12} />
          <Path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
          {points.map((p, i) => (
            <Circle key={i} cx={x(i)} cy={y(p.value)} r={sel === i ? 5.5 : 3.5} fill={sel === i ? color : C.card} stroke={color} strokeWidth={2} />
          ))}
          {points.map((p, i) => (
            <SvgText key={`l${i}`} x={x(i)} y={chartH + 14} fill={sel === i ? C.text : C.textSecondary} fontSize={9} fontWeight={sel === i ? '700' : '400'} textAnchor="middle">{p.label}</SvgText>
          ))}
        </Svg>
        {/* Zones tapables centrées sur chaque point (Views RN : fiables web + natif). */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
          {points.map((_, i) => (
            <TouchableOpacity
              key={i}
              style={{ position: 'absolute', top: 0, bottom: 0, left: x(i) - zoneW / 2, width: zoneW }}
              activeOpacity={0.55}
              onPress={() => setActive(i)}
              accessibilityRole="button"
            />
          ))}
        </View>
      </View>
      <View style={s.ieDetail}>
        <Text style={s.ieDetailMonth}>{points[sel].label}</Text>
        <View style={s.ieDetailVals}>
          <View style={s.ieDetailItem}><View style={[s.legendDot, { backgroundColor: color }]} /><Text style={s.ieDetailTxt}>{fmtFull(points[sel].value)}</Text></View>
          <View style={s.ieDetailItem}><Text style={s.ieDetailNetLabel}>Apports</Text><Text style={s.ieDetailTxt}>{fmtFull(apports[sel] ?? 0)}</Text></View>
        </View>
      </View>
    </View>
  );
}

/* ═══ Donut « Où part mon argent » ═══ */
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, rO, a1), p1 = polar(cx, cy, rO, a0);
  const p2 = polar(cx, cy, rI, a0), p3 = polar(cx, cy, rI, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${rO} ${rO} 0 ${large} 0 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${rI} ${rI} 0 ${large} 1 ${p3.x} ${p3.y} Z`;
}
function CategoryDonut({ data, width }: { data: { label: string; amount: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s2, d) => s2 + d.amount, 0);
  if (!data.length || total <= 0) return <Text style={s.emptyChart}>Aucune dépense ce mois-ci.</Text>;
  const size = Math.min(width, 200);
  const cx = size / 2, cy = size / 2, rO = size / 2 - 4, rI = rO * 0.62;
  const colorOf = (i: number) => (data[i].label === 'Autres' ? C.catMuted : C.cat[i % C.cat.length]);
  let acc = 0;
  const segs = data.map((d, i) => { const a0 = (acc / total) * 360; acc += d.amount; const a1 = (acc / total) * 360; return { a0: Math.min(a0, 359.99), a1: Math.min(a1, 359.999), i }; });
  const sel = active !== null ? data[active] : null;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {segs.map((seg) => (
            <Path key={seg.i} d={arcPath(cx, cy, active === seg.i ? rO : rO - 2, rI, seg.a0, seg.a1)} fill={colorOf(seg.i)} opacity={active === null || active === seg.i ? 1 : 0.45} {...svgPress(() => setActive(active === seg.i ? null : seg.i))} />
          ))}
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <Text style={{ fontSize: 11, color: C.textSecondary }}>{sel ? sel.label : 'Dépenses'}</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>{fmtFull(sel ? sel.amount : total)}</Text>
          {sel ? <Text style={{ fontSize: 11, color: C.textSecondary, fontWeight: '700' }}>{Math.round((sel.amount / total) * 100)} %</Text> : null}
        </View>
      </View>
      <View style={{ width: '100%', marginTop: 12, gap: 7 }}>
        {data.map((d, i) => (
          <TouchableOpacity key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} activeOpacity={0.7} onPress={() => setActive(active === i ? null : i)}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colorOf(i) }} />
            <Text style={{ flex: 1, fontSize: 12.5, color: C.text }} numberOfLines={1}>{d.label}</Text>
            <Text style={{ fontSize: 12, color: C.textSecondary, fontWeight: '600', width: 40, textAlign: 'right' }}>{Math.round((d.amount / total) * 100)}%</Text>
            <Text style={{ fontSize: 12.5, color: C.text, fontWeight: '700', width: 70, textAlign: 'right' }}>{fmtFull(d.amount)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ═══ Top postes (barres horizontales, ce mois vs précédent) ═══ */
function HBarCompare({ rows, width }: { rows: { label: string; current: number; previous: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  if (!rows.length) return <Text style={s.emptyChart}>Aucune dépense ce mois-ci.</Text>;
  const maxVal = Math.max(...rows.flatMap((r) => [r.current, r.previous]), 1);
  const labelW = 84, valW = 82, trackW = Math.max(36, width - labelW - valW - 12);
  return (
    <View>
      {rows.map((r, i) => {
        const diff = r.current - r.previous;
        return (
          <View key={i} style={{ marginBottom: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ width: labelW, color: C.text, fontSize: 12, fontWeight: '500' }} numberOfLines={1}>{r.label}</Text>
              <View style={{ width: trackW }}>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: C.cardBorder, marginBottom: 3, width: `${Math.max((r.previous / maxVal) * 100, 1.5)}%` as any }} />
                <View style={{ height: 12, borderRadius: 4, backgroundColor: C.violet, width: `${Math.max((r.current / maxVal) * 100, 1.5)}%` as any }} />
              </View>
              <Text style={{ width: valW, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: '700', paddingLeft: 4 }} numberOfLines={1}>{fmtFull(r.current)}</Text>
            </View>
            <Text style={{ marginLeft: labelW, color: diff > 0 ? C.expense : C.income, fontSize: 10, marginTop: 2 }}>
              {r.previous === 0 ? 'nouveau ce mois' : diff === 0 ? '= stable' : `${diff > 0 ? '▲' : '▼'} ${fmtFull(Math.abs(diff))} vs mois préc.`}
            </Text>
          </View>
        );
      })}
      <View style={s.legendWrap}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.violet }]} /><Text style={s.legendLabel}>Ce mois</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.cardBorder, borderWidth: 1, borderColor: C.textSecondary }]} /><Text style={s.legendLabel}>Mois précédent</Text></View>
      </View>
    </View>
  );
}

/* ═══ Jauge « épargne de sécurité » — langage simple, orientée objectif ═══ */
function SafetyGauge({ value, min, optimal, comfort, monthsCovered }: { value: number; min: number; optimal: number; comfort: number; monthsCovered: number | null }) {
  const C = useReportingColors();
  const status = value < min ? { label: 'Épargne faible', color: C.expense }
    : value < optimal ? { label: 'À renforcer', color: C.amber }
    : value < comfort ? { label: 'Bien', color: C.cat[0] }
    : { label: 'Confortable', color: C.income };
  const target = optimal > 0 ? optimal : comfort > 0 ? comfort : Math.max(value, 1);
  const pct = Math.min(100, Math.max(3, (value / target) * 100));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5, color: C.textSecondary, fontWeight: '600' }}>Épargne de sécurité</Text>
          <Text style={{ fontSize: 26, fontWeight: '800', color: status.color, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{fmtFull(value)}</Text>
        </View>
        <View style={{ backgroundColor: status.color + '1F', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: status.color }}>{status.label}</Text>
        </View>
      </View>
      <View style={{ height: 12, backgroundColor: C.cardBorder, borderRadius: 6, overflow: 'hidden', marginTop: 12 }}>
        <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: status.color, borderRadius: 6 }} />
      </View>
      <Text style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 9, lineHeight: 18 }}>
        {monthsCovered != null && monthsCovered > 0
          ? (monthsCovered < 0.75
              ? 'Tu tiendrais moins d’1 mois sans rentrée d’argent. '
              : `Tu peux tenir environ ${Math.round(monthsCovered)} mois sans rentrée d’argent. `)
          : ''}
        {target > value ? `Objectif conseillé : ${fmtFull(target)} — encore ${fmtFull(target - value)}.` : 'Objectif atteint 🎉'}
      </Text>
    </View>
  );
}

/* ═══ KPI ═══ */
function KpiCard({ icon, label, value, color, sub }: { icon: string; label: string; value: string; color: string; sub?: string }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  return (
    <View style={[s.kpiCard, { borderLeftColor: color }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <Ionicons name={icon as any} size={15} color={color} />
        <Text style={s.kpiLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[s.kpiValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={s.kpiSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/* ═══ Fade-in ═══ */
function FadeIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(anim, { toValue: 1, duration: 480, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  return <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>{children}</Animated.View>;
}

function GroupHeader({ icon, title, color }: { icon: string; title: string; color: string }) {
  const C = useReportingColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 32, marginBottom: 2 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon as any} size={19} color={color} />
      </View>
      <Text style={{ fontSize: 19, fontWeight: '800', color: C.text, letterSpacing: -0.3 }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.cardBorder, marginLeft: 4 }} />
    </View>
  );
}

/* ═══════════════════  MAIN SCREEN  ═══════════════════ */
export default function ReportingScreen() {
  const C = useReportingColors();
  const s = makeStyles(C);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const { width: screenW } = useWindowDimensions();
  // Largeur INTÉRIEURE des cartes : écran − padding page (20×2) − padding carte (16×2).
  // Sans ça, les graphes débordaient à droite (colonnes collées au bord, marge invisible).
  const chartWidth = Math.min(screenW - 72, 460);

  const { data: profile } = useProfile(user?.id);
  const { isPremium } = usePlan(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const reportingAllowed = isPremium || isAdmin;

  const { data: rawTxPerso, refetch: rTx } = useTransactions(user?.id);
  const { data: rawAccPerso, refetch: rAcc } = useAccounts(user?.id);
  const { data: categories } = useCategories(user?.id);
  const { data: pilotage, refetch: rPil } = usePilotageData(user?.id);
  const { data: sharedContrib } = useSharedContribution(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();

  const refCode = (profile as any)?.currency_code ?? 'EUR';

  // ── Fusion perso + parts partagées (déjà ×facteur), puis conversion en devise de référence. ──
  const allAccounts = useMemo(() => {
    const merged = [...(rawAccPerso ?? []), ...((sharedContrib?.accounts ?? []) as any[])];
    return merged.map((a) => ({ ...a, balance: convertAmount(Number(a.balance), (a as any).currency || 'EUR', refCode, rates) ?? Number(a.balance) }));
  }, [rawAccPerso, sharedContrib, rates, refCode]);
  const allTx = useMemo(() => {
    const merged = [...(rawTxPerso ?? []), ...((sharedContrib?.transactions ?? []) as any[])];
    return merged.map((t) => ({ ...t, amount: convertAmount(Number(t.amount), (t as any).account?.currency || refCode, refCode, rates) ?? Number(t.amount) }));
  }, [rawTxPerso, sharedContrib, rates, refCode]);

  // ── Périmètre (vue FLUX) — même logique que Pilotage/Projection. ──
  const perimeterCtx = useMemo(() => buildPerimeterCtx(allAccounts.map((a: any) => ({
    id: a.id,
    isShared: !!(sharedContrib?.factorByAccount && a.id in sharedContrib.factorByAccount),
    shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
    factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
    type: a.type,
  }))), [allAccounts, sharedContrib]);
  const fluxTx = useMemo(() => transformFluxTransactions(allTx as any[], perimeterCtx) as ReportTx[], [allTx, perimeterCtx]);

  const typeById = useMemo(() => { const m: Record<string, string> = {}; for (const a of allAccounts) m[a.id] = (a as any).type; return m; }, [allAccounts]);

  const handleRefresh = async () => { setRefreshing(true); await Promise.all([rTx(), rAcc(), rPil()]); setRefreshing(false); };

  // ── Catégorie « parent » ── */
  const catById = useMemo(() => { const m = new Map<string, { name: string; parent_id?: string | null }>(); for (const c of categories ?? []) m.set(c.id, { name: c.name, parent_id: c.parent_id }); return m; }, [categories]);
  const grandCategoryName = (categoryId: string | null | undefined): string => {
    if (!categoryId) return 'Sans catégorie';
    const c = catById.get(categoryId);
    if (!c) return 'Sans catégorie';
    if (c.parent_id) return catById.get(c.parent_id)?.name ?? c.name;
    return c.name;
  };
  // Type de catégorie (recette vs dépense) : REVENUS = seulement les vraies recettes.
  const catTypeById = useMemo(() => { const m = new Map<string, 'income' | 'expense'>(); for (const c of categories ?? []) { const ty = (c as any).type; if (ty === 'income' || ty === 'expense') m.set(c.id, ty); } return m; }, [categories]);
  const categoryType = (categoryId: string | null | undefined): 'income' | 'expense' | null => (categoryId ? (catTypeById.get(categoryId) ?? null) : null);

  // ── Fenêtre de mois (période choisie, bornée à la 1ʳᵉ donnée). ──
  const dataStartYM = useMemo(() => {
    let earliest: string | null = null;
    for (const a of allAccounts) { const ym = ((a as any).created_at ?? '').substring(0, 7); if (ym && (!earliest || ym < earliest)) earliest = ym; }
    for (const t of allTx as any[]) { const ym = (t.date ?? '').substring(0, 7); if (ym && (!earliest || ym < earliest)) earliest = ym; }
    return earliest;
  }, [allAccounts, allTx]);
  // Fenêtre fixe unique : 6 mois (plus de sélecteur). Bornée à la 1ʳᵉ donnée.
  const months = useMemo(() => monthsWindow(6, dataStartYM), [dataStartYM]);
  const monthsBars = months;

  // ── Séries. ──
  const monthlyFlux = useMemo(() => buildMonthlyFlux(fluxTx, months, categoryType), [fluxTx, months, catTypeById]);
  const monthlyFluxBars = useMemo(() => buildMonthlyFlux(fluxTx, monthsBars, categoryType), [fluxTx, monthsBars, catTypeById]);
  const savingsSeries = useMemo(() => buildSavingsSeries(allTx as ReportTx[], months, typeById), [allTx, months, typeById]);
  const savingsBarsSeries = useMemo(() => buildSavingsSeries(allTx as ReportTx[], monthsBars, typeById), [allTx, monthsBars, typeById]);
  const allIds = useMemo(() => new Set(allAccounts.map((a: any) => a.id)), [allAccounts]);
  const today = todayISO();
  // Série de patrimoine : plus de graphe dédié, mais elle alimente le KPI « Patrimoine net » et le bilan.
  const netWorthTotal = useMemo(() => buildBalanceSeries(allIds, allAccounts as any, allTx as ReportTx[], months, today), [allIds, allAccounts, allTx, months, today]);

  // ── Investissements : valeur du portefeuille dans le temps + apports mensuels. ──
  const hasInvestAccounts = useMemo(() => (allAccounts as any[]).some((a) => a.type === 'investment'), [allAccounts]);
  const investIds = useMemo(() => new Set((allAccounts as any[]).filter((a) => a.type === 'investment').map((a) => a.id)), [allAccounts]);
  const investSeries = useMemo(() => buildBalanceSeries(investIds, allAccounts as any, allTx as ReportTx[], months, today), [investIds, allAccounts, allTx, months, today]);

  const curYm = today.substring(0, 7);
  const prevYm = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  const categoryBreakdown = useMemo(() => buildCategoryBreakdown(fluxTx, curYm, grandCategoryName, categoryType, 7), [fluxTx, curYm, catById, catTypeById]);
  const topCategories = useMemo(() => buildTopCategoriesCompare(fluxTx, curYm, prevYm, grandCategoryName, categoryType, 5), [fluxTx, curYm, prevYm, catById, catTypeById]);

  // ── KPIs. ──
  const patrimoineTotal = useMemo(() => allAccounts.reduce((sum: number, a: any) => sum + Number(a.balance), 0), [allAccounts]);
  const lastFlux = monthlyFlux[monthlyFlux.length - 1];
  const prevFlux = monthlyFlux[monthlyFlux.length - 2];
  const monthSaved = savingsSeries[savingsSeries.length - 1]?.saved ?? 0;
  const monthIncome = lastFlux?.income ?? 0;
  const savingsRate = monthIncome > 0 ? Math.round((monthSaved / monthIncome) * 100) : 0;
  // Écart de dépenses vs mois précédent : en € (toujours affichable, même si M-1 = 0 €) + % si calculable.
  const expenseDiff = lastFlux && prevFlux ? lastFlux.expense - prevFlux.expense : null;
  const expensePct = lastFlux && prevFlux && prevFlux.expense > 0 ? Math.round(((lastFlux.expense - prevFlux.expense) / prevFlux.expense) * 100) : null;

  // Apports (virements entrants) par mois, et « gain hors apports » : la variation de valeur qui
  // n'est PAS due à de l'argent ajouté. `buildBalanceSeries` renvoie le solde de FIN de mois, donc
  // les apports du 1ᵉʳ mois sont déjà inclus dans le point de départ → on ne compte que les suivants.
  const investApports = useMemo(() => savingsSeries.map((m) => m.invest), [savingsSeries]);
  const investValue = investSeries[investSeries.length - 1]?.value ?? 0;
  const investApportsPeriod = useMemo(() => investApports.slice(1).reduce((a, b) => a + b, 0), [investApports]);
  const investGain = investSeries.length >= 2 ? investValue - investSeries[0].value - investApportsPeriod : 0;

  // ── Bilan intelligent. ──
  const insights = useMemo(() => buildInsights({
    monthlyFlux, savingsSeries, netWorthTotal, categoryBreakdown, monthIncome, monthSaved,
    variableTrendPct: pilotage?.variable_trend_percentage ?? null,
    hasVariableBaseline: (pilotage?.avg_variable_expenses_3m ?? 0) > 0,
  }), [monthlyFlux, savingsSeries, netWorthTotal, categoryBreakdown, monthIncome, monthSaved, pilotage]);

  const toneMeta: Record<InsightTone, { color: string; label: string }> = {
    alert: { color: C.expense, label: 'À surveiller' }, win: { color: C.income, label: 'Bravo' }, tip: { color: C.violet, label: 'Opportunité' },
  };

  if (!user) return <Gate C={C} s={s} icon="lock-closed-outline" text="Connectez-vous pour accéder au reporting." />;
  if (!reportingAllowed) return (
    <View style={s.root}>
      <StatusBar style={C.mode === 'light' ? 'dark' : 'light'} /><ScreenGradient />
      <SafeAreaView style={s.safe} edges={['left', 'right']}>
        <BackRow C={C} onPress={goBack} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="star-outline" size={48} color={C.amber} />
          <Text style={{ color: C.text, marginTop: 14, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>Reporting réservé aux abonnés Premium</Text>
          <Text style={{ color: C.textSecondary, marginTop: 8, fontSize: 13.5, textAlign: 'center', lineHeight: 19 }}>Patrimoine, répartition des dépenses et bilan intelligent : passez Premium pour y accéder.</Text>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.amber, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 20 }} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
            <Ionicons name="star" size={16} color="#0f172a" /><Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>Passer Premium</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style={C.mode === 'light' ? 'dark' : 'light'} /><ScreenGradient />
      <SafeAreaView style={s.safe} edges={['left', 'right']}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.income} progressBackgroundColor={C.card} />}>

          <FadeIn><BackRow C={C} onPress={goBack} /></FadeIn>

          {/* KPIs */}
          <FadeIn delay={100}>
            <View style={s.kpiRow}>
              <KpiCard icon="layers-outline" label="Patrimoine net" value={fmtFull(patrimoineTotal)} color={ACCOUNT_COLORS.checking} sub={netWorthTotal.length >= 2 ? `${fmtSigned(netWorthTotal[netWorthTotal.length - 1].value - netWorthTotal[0].value)} sur ${months.length} mois` : undefined} />
              <KpiCard icon="wallet-outline" label="Net du mois" value={lastFlux ? fmtSigned(lastFlux.net) : '—'} color={lastFlux && lastFlux.net >= 0 ? C.income : C.expense} sub={lastFlux ? `${fmtFull(lastFlux.income)} − ${fmtFull(lastFlux.expense)}` : undefined} />
              <KpiCard icon="shield-checkmark-outline" label="Taux d'épargne" value={`${savingsRate} %`} color={C.income} sub={`${fmtFull(monthSaved)} mis de côté`} />
              <KpiCard
                icon="swap-vertical-outline"
                label="Dépenses vs M-1"
                value={expenseDiff == null ? '—' : fmtSigned(expenseDiff)}
                color={expenseDiff != null && expenseDiff > 0 ? C.expense : C.income}
                sub={lastFlux ? `${fmtFull(lastFlux.expense)} ce mois${expensePct != null ? ` · ${expensePct > 0 ? '+' : ''}${expensePct} %` : ''}` : undefined}
              />
            </View>
          </FadeIn>

          {/* Bilan intelligent */}
          {insights.length > 0 && (
            <FadeIn delay={140}>
              <View style={[s.section, { borderColor: C.violet + '55', borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 22 }]}>
                <View style={s.sectionHeader}><Ionicons name="sparkles" size={20} color={C.violet} /><Text style={s.sectionTitle}>Bilan intelligent</Text></View>
                <Text style={s.sectionSub}>Constats générés automatiquement, du plus important au moins</Text>
                {insights.slice(0, 5).map((ins, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 11 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: toneMeta[ins.tone].color + '1F', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                      <Ionicons name={ins.icon as any} size={15} color={toneMeta[ins.tone].color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: toneMeta[ins.tone].color, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>{toneMeta[ins.tone].label}</Text>
                      <Text style={{ fontSize: 13, color: C.text, lineHeight: 19 }}>{ins.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </FadeIn>
          )}

          {/* ══ RÉCAPITULATIF ══ */}
          <FadeIn delay={180}><GroupHeader icon="grid-outline" title="Récapitulatif" color={C.violet} /></FadeIn>
          {/* Un seul titre pour les deux vues d'une MÊME donnée : le tableau (détail chiffré) et
              les barres (lecture rapide). D'où l'en-tête unique posé au-dessus du tableau. */}
          <FadeIn delay={210}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="bar-chart-outline" size={20} color={C.income} /><Text style={s.sectionTitle}>Revenus vs Dépenses</Text></View>
              <Text style={s.sectionSub}>Revenus, dépenses et net par mois · {months.length} mois</Text>
              <View style={s.tableCard}>
                <View style={s.tableHeaderRow}>
                  <Text style={[s.tableHeaderCell, { flex: 2 }]}>Mois</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Revenus</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Dépenses</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Net</Text>
                </View>
                {monthlyFlux.map((row, i) => (
                  <View key={i} style={[s.tableRow, i % 2 === 0 && s.tableRowAlt]}>
                    <Text style={[s.tableCell, { flex: 2 }]}>{row.label}</Text>
                    <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.income }]}>{fmtFull(row.income)}</Text>
                    <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.expense }]}>{fmtFull(row.expense)}</Text>
                    <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: row.net >= 0 ? C.income : C.expense }]}>{fmtSigned(row.net)}</Text>
                  </View>
                ))}
                {monthlyFlux.length > 0 && (() => {
                  const ti = monthlyFlux.reduce((a, r) => a + r.income, 0), te = monthlyFlux.reduce((a, r) => a + r.expense, 0);
                  return (
                    <View style={[s.tableRow, { borderTopWidth: 1, borderTopColor: C.cardBorder }]}>
                      <Text style={[s.tableCell, { flex: 2, fontWeight: '800' }]}>Total</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.income, fontWeight: '800' }]}>{fmtFull(ti)}</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.expense, fontWeight: '800' }]}>{fmtFull(te)}</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: ti - te >= 0 ? C.income : C.expense, fontWeight: '800' }]}>{fmtSigned(ti - te)}</Text>
                    </View>
                  );
                })()}
              </View>
            </View>
          </FadeIn>
          <FadeIn delay={250}>
            <View style={[s.section, { marginTop: 12 }]}>
              <Text style={[s.sectionSub, { marginTop: 0 }]}>{monthsBars.length} derniers mois · touche un mois pour le détail</Text>
              <View style={s.chartCard}>
                <View style={s.legendRow}>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.income }]} /><Text style={s.legendSmall}>Revenus</Text></View>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.expense }]} /><Text style={s.legendSmall}>Dépenses</Text></View>
                </View>
                {monthlyFluxBars.length > 0 ? <IncomeExpenseBars data={monthlyFluxBars} width={chartWidth} /> : <Text style={s.emptyChart}>Aucune transaction</Text>}
              </View>
            </View>
          </FadeIn>

          {/* ══ DÉPENSES ══ */}
          <FadeIn delay={300}><GroupHeader icon="card-outline" title="Dépenses" color={C.expense} /></FadeIn>
          <FadeIn delay={330}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="pie-chart-outline" size={20} color={C.cat[0]} /><Text style={s.sectionTitle}>Où part mon argent</Text></View>
              <Text style={s.sectionSub}>Répartition des dépenses du mois en cours</Text>
              <View style={s.chartCard}><CategoryDonut data={categoryBreakdown} width={chartWidth} /></View>
            </View>
          </FadeIn>
          <FadeIn delay={370}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="podium-outline" size={20} color={C.violet} /><Text style={s.sectionTitle}>Top postes de dépense</Text></View>
              <Text style={s.sectionSub}>Par grande catégorie · ce mois vs précédent</Text>
              <View style={s.chartCard}><HBarCompare rows={topCategories} width={chartWidth} /></View>
            </View>
          </FadeIn>

          {/* ══ ÉPARGNE & INVESTISSEMENT ══ */}
          <FadeIn delay={410}><GroupHeader icon="leaf-outline" title="Épargne et Investissement" color={ACCOUNT_COLORS.savings} /></FadeIn>
          {pilotage ? (
            <FadeIn delay={440}>
              <View style={s.section}>
                <View style={s.sectionHeader}><Ionicons name="shield-checkmark-outline" size={20} color={C.income} /><Text style={s.sectionTitle}>Épargne de sécurité</Text></View>
                <Text style={s.sectionSub}>Ton matelas en cas de coup dur</Text>
                <View style={s.chartCard}>
                  {/* « Mois de sécurité » : UNE seule définition dans toute l'app (lib/securityCushion) —
                      épargne ÷ revenu mensuel moyen. Partagée avec le Pouls, les recommandations et le
                      moteur de profils P1–P5. */}
                  <SafetyGauge
                    value={pilotage.current_savings}
                    min={pilotage.safety_threshold_min}
                    optimal={pilotage.safety_threshold_optimal}
                    comfort={pilotage.safety_threshold_comfort}
                    monthsCovered={computeSecurityCushion({
                      availableSavings: pilotage.current_savings,
                      avgMonthlyIncome: pilotage.avg_monthly_income,
                    }).months}
                  />
                </View>
              </View>
            </FadeIn>
          ) : null}
          <FadeIn delay={480}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="wallet-outline" size={20} color={ACCOUNT_COLORS.savings} /><Text style={s.sectionTitle}>Mis de côté chaque mois</Text></View>
              <Text style={s.sectionSub}>Virements vers l'épargne et l'investissement · {monthsBars.length} mois · touche un mois pour le détail</Text>
              <View style={s.chartCard}><SavingsBars data={savingsBarsSeries} width={chartWidth} /></View>
            </View>
          </FadeIn>
          {hasInvestAccounts && (
            <FadeIn delay={520}>
              <View style={s.section}>
                <View style={s.sectionHeader}><Ionicons name="trending-up-outline" size={20} color={ACCOUNT_COLORS.investment} /><Text style={s.sectionTitle}>Tes investissements</Text></View>
                <Text style={s.sectionSub}>Valeur du portefeuille sur {months.length} mois · touche un mois pour le détail</Text>
                <View style={s.chartCard}>
                  <Text style={{ fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5 }} numberOfLines={1} adjustsFontSizeToFit>{fmtFull(investValue)}</Text>
                  <InvestmentValueChart points={investSeries} apports={investApports} width={chartWidth} />
                  {/* Ce que la Projection ne dit pas : ce qui, dans la hausse, vient de TES apports
                      et ce qui vient de la performance. */}
                  <View style={s.investStatRow}>
                    <View style={s.investStat}>
                      <Text style={s.investStatLabel}>Apports sur la période</Text>
                      <Text style={[s.investStatValue, { color: ACCOUNT_COLORS.investment }]}>{fmtFull(investApportsPeriod)}</Text>
                    </View>
                    <View style={s.investStatDivider} />
                    <View style={s.investStat}>
                      <Text style={s.investStatLabel}>Gain hors apports</Text>
                      <Text style={[s.investStatValue, { color: investGain >= 0 ? C.income : C.expense }]}>{fmtSigned(investGain)}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </FadeIn>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function BackRow({ C, onPress }: { C: any; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingTop: 4 }}>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={onPress} accessibilityRole="button">
        <Ionicons name="arrow-back" size={22} color={C.text} /><Text style={{ fontSize: 14, fontWeight: '600', color: C.text }}>Retour</Text>
      </TouchableOpacity>
    </View>
  );
}
function Gate({ C, s, icon, text }: { C: any; s: any; icon: string; text: string }) {
  return (
    <View style={s.root}>
      <StatusBar style={C.mode === 'light' ? 'dark' : 'light'} /><ScreenGradient />
      <SafeAreaView style={s.safe} edges={['left', 'right']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name={icon as any} size={48} color={C.textSecondary} />
          <Text style={{ color: C.textSecondary, marginTop: 12, fontSize: 15 }}>{text}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

/* ═══════════════════  STYLES  ═══════════════════ */
function makeStyles(C: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 120 },

    kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    kpiCard: { flexGrow: 1, flexBasis: '46%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, borderLeftWidth: 3, paddingVertical: 12, paddingHorizontal: 14 },
    kpiLabel: { fontSize: 11.5, color: C.textSecondary, fontWeight: '600', flex: 1 },
    kpiValue: { fontSize: 20, fontWeight: '800', marginTop: 1 },
    kpiSub: { fontSize: 10.5, color: C.textSecondary, marginTop: 1 },

    section: { marginTop: 20 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
    sectionSub: { fontSize: 12, color: C.textSecondary, marginTop: 2, marginBottom: 12 },

    chartCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 16, overflow: 'hidden' },
    emptyChart: { color: C.textSecondary, textAlign: 'center', padding: 24, fontSize: 13 },

    legendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: { fontSize: 11, color: C.text },
    legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 12 },
    legendInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSmall: { fontSize: 11, color: C.textSecondary },

    ieDetail: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.cardBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
    ieDetailMonth: { fontSize: 13, fontWeight: '800', color: C.text, textTransform: 'capitalize' },
    ieDetailVals: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
    ieDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    ieDetailTxt: { fontSize: 13, fontWeight: '700', color: C.text },
    ieDetailNetLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '600' },

    investStatRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.cardBorder },
    investStat: { flex: 1, alignItems: 'center' },
    investStatDivider: { width: 1, alignSelf: 'stretch', backgroundColor: C.cardBorder, marginHorizontal: 10 },
    investStatLabel: { fontSize: 11, color: C.textSecondary, marginBottom: 3, textAlign: 'center' },
    investStatValue: { fontSize: 16, fontWeight: '800' },

    healthRow: { flexDirection: 'row' },
    healthItem: { flex: 1, alignItems: 'center' },
    healthDivider: { width: 1, backgroundColor: C.cardBorder, marginHorizontal: 12 },
    healthLabel: { fontSize: 12, color: C.textSecondary, marginBottom: 4 },
    healthValue: { fontSize: 20, fontWeight: '800' },
    healthHint: { fontSize: 11, color: C.textSecondary, marginTop: 2, textAlign: 'center' },

    tableCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
    tableHeaderRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: C.cardBorder },
    tableHeaderCell: { fontSize: 11, color: C.textSecondary, fontWeight: '700', textTransform: 'uppercase' },
    tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 14 },
    tableRowAlt: { backgroundColor: C.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)' },
    tableCell: { fontSize: 13, color: C.text },
  });
}
