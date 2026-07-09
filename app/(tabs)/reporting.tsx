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
import Svg, { Rect, Text as SvgText, Line, Circle, Path, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTransactions } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { usePilotageData } from '../../hooks/usePilotageData';
import { useSharedContribution } from '../../hooks/useSharedContribution';
import { useProfile } from '../../hooks/useProfile';
import { usePlan } from '../../hooks/usePlan';
import { useNavBack } from '../../hooks/useNavBack';
import { useReportingPeriod } from '../../hooks/useUiPrefs';
import { ACCOUNT_COLORS } from '../../theme/colors';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL, convertAmount } from '../../lib/currency';
import { useCurrencyRates } from '../../hooks/useCurrencyRates';
import { todayISO } from '../../lib/dateUtils';
import { buildPerimeterCtx, transformFluxTransactions, splitPerimeterAccounts } from '../../lib/perimeter';
import {
  monthsWindow, buildMonthlyFlux, buildSavingsSeries, buildCategoryBreakdown,
  buildTopCategoriesCompare, buildBalanceSeries, buildInsights,
  type ReportingPeriod, type ReportTx, type InsightTone,
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

/* ═══ Tooltip SVG ═══ */
function ChartTooltip({ cx, cy, text, color, chartWidth, padR = 0 }: { cx: number; cy: number; text: string; color: string; chartWidth: number; padR?: number }) {
  const C = useReportingColors();
  const boxW = 92, boxH = 28, gap = 10;
  const fromRight = cx + gap + boxW > chartWidth - padR;
  const tx = fromRight ? cx - gap - boxW : cx + gap;
  const ty = Math.max(2, cy - boxH / 2);
  return (
    <G>
      <Line x1={cx} y1={cy} x2={fromRight ? cx - gap : cx + gap} y2={cy} stroke={color} strokeWidth={1} strokeOpacity={0.6} />
      <Rect x={tx} y={ty} width={boxW} height={boxH} rx={8} fill={C.card} stroke={color} strokeWidth={1.5} />
      <SvgText x={tx + boxW / 2} y={ty + boxH / 2 + 4} fill={C.text} fontSize={11} fontWeight="700" textAnchor="middle">{text}</SvgText>
    </G>
  );
}

/* ═══ Barres groupées Revenus vs Dépenses ═══ */
function IncomeExpenseBars({ data, width }: { data: { label: string; income: number; expense: number }[]; width: number }) {
  const C = useReportingColors();
  const [active, setActive] = useState<{ idx: number; type: 'income' | 'expense' } | null>(null);
  const chartH = 170;
  const groupW = (width - 52) / Math.max(1, data.length);
  const barW = Math.min(20, groupW * 0.32);
  const gap = 4;
  const maxVal = Math.max(...data.flatMap((d) => [d.income, d.expense]), 1);
  return (
    <Svg width={width} height={chartH + 30}>
      <Rect x={0} y={0} width={width} height={chartH + 30} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActive(null))} />
      {[0, 0.5, 1].map((pct, i) => {
        const y = chartH - pct * chartH;
        return (
          <G key={i}>
            <Line x1={44} y1={y} x2={width} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={40} y={y + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxVal * pct)}</SvgText>
          </G>
        );
      })}
      {data.map((d, i) => {
        const x = 48 + i * groupW + (groupW - barW * 2 - gap) / 2;
        const ih = (d.income / maxVal) * chartH;
        const eh = (d.expense / maxVal) * chartH;
        return (
          <G key={i}>
            <Rect x={x} y={chartH - ih} width={barW} height={Math.max(ih, 1)} rx={4} fill={C.income} opacity={active && !(active.idx === i && active.type === 'income') ? 0.4 : 1} {...svgPress(() => setActive({ idx: i, type: 'income' }))} />
            <Rect x={x + barW + gap} y={chartH - eh} width={barW} height={Math.max(eh, 1)} rx={4} fill={C.expense} opacity={active && !(active.idx === i && active.type === 'expense') ? 0.4 : 1} {...svgPress(() => setActive({ idx: i, type: 'expense' }))} />
            <SvgText x={x + barW + gap / 2} y={chartH + 14} fill={C.textSecondary} fontSize={10} textAnchor="middle">{d.label}</SvgText>
          </G>
        );
      })}
      {active ? (() => {
        const pt = data[active.idx];
        const v = active.type === 'income' ? pt.income : pt.expense;
        const x = 48 + active.idx * groupW + (groupW - barW * 2 - gap) / 2 + (active.type === 'income' ? barW / 2 : barW + gap + barW / 2);
        const cy = chartH - (v / maxVal) * chartH;
        return <ChartTooltip cx={x} cy={cy} text={fmtSigned(active.type === 'income' ? v : -v)} color={active.type === 'income' ? C.income : C.expense} chartWidth={width} />;
      })() : null}
    </Svg>
  );
}

/* ═══ Aire + ligne : patrimoine net TOTAL (une seule série, hero) ═══ */
function AreaLineChart({ points, width, color, height = 120, showAxis = true }: { points: { label: string; value: number }[]; width: number; color: string; height?: number; showAxis?: boolean }) {
  const C = useReportingColors();
  const [active, setActive] = useState<number | null>(null);
  const padL = showAxis ? 48 : 6, padR = 12;
  const usable = width - padL - padR;
  if (points.length < 2) return <Text style={{ color: C.textSecondary, padding: 16, fontSize: 12 }}>Pas encore assez d'historique.</Text>;
  const maxVal = Math.max(...points.map((p) => p.value), 1);
  const minVal = Math.min(...points.map((p) => p.value), 0);
  const range = maxVal - minVal || 1;
  const coords = points.map((p, i) => ({ x: padL + (i / (points.length - 1)) * usable, y: 8 + (1 - (p.value - minVal) / range) * (height - 16) }));
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath = linePath + ` L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;
  // id UNIQUE par couleur ET dimensions : sur web les <linearGradient> partagent le DOM → deux
  // sparklines de même taille mais couleur différente prendraient sinon le même dégradé.
  const gid = `ar${color.replace('#', '')}${Math.round(width)}${height}`;
  return (
    <Svg width={width} height={height + (showAxis ? 26 : 6)}>
      <Rect x={0} y={0} width={width} height={height + 26} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActive(null))} />
      <Defs><LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity="0.28" /><Stop offset="1" stopColor={color} stopOpacity="0.02" /></LinearGradient></Defs>
      {showAxis && [0, 0.5, 1].map((pct, i) => {
        const y = 8 + (1 - pct) * (height - 16);
        return <G key={i}><Line x1={padL} y1={y} x2={width - padR} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" /><SvgText x={padL - 6} y={y + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(minVal + pct * range)}</SvgText></G>;
      })}
      <Path d={areaPath} fill={`url(#${gid})`} {...svgPress(() => setActive(null))} />
      <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" {...svgPress(() => setActive(null))} />
      {coords.map((c, i) => <Circle key={i} cx={c.x} cy={c.y} r={showAxis ? 4 : 3} fill={C.card} stroke={color} strokeWidth={2} {...svgPress(() => setActive(i === active ? null : i))} />)}
      {active !== null ? <ChartTooltip cx={coords[active].x} cy={coords[active].y} text={fmtFull(points[active].value)} color={color} chartWidth={width} padR={padR} /> : null}
      {showAxis && points.map((p, i) => {
        const step = Math.max(1, Math.ceil(points.length / 6));
        if (i % step !== 0 && i !== points.length - 1) return null;
        return <SvgText key={i} x={coords[i].x} y={height + 14} fill={C.textSecondary} fontSize={9} textAnchor="middle">{p.label}</SvgText>;
      })}
    </Svg>
  );
}

/* ═══ Barres « reste chaque mois » (net) — un seul axe, signe coloré, taux en libellé direct ═══ */
function NetBars({ data, width }: { data: { label: string; net: number; rate: number }[]; width: number }) {
  const C = useReportingColors();
  const [active, setActive] = useState<number | null>(null);
  if (data.length < 2) return <Text style={s0(C).empty}>Pas encore assez d'historique.</Text>;
  const chartH = 158, padL = 44, padR = 14, padT = 18, padB = 20;
  const usableW = width - padL - padR, usableH = chartH - padT - padB;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.net)), 1);
  const range = 2 * maxAbs || 1;
  const y = (v: number) => padT + (1 - (v + maxAbs) / range) * usableH;
  const slot = usableW / data.length, barW = Math.min(24, slot * 0.5);
  const cx = (i: number) => padL + slot * i + slot / 2;
  const zeroY = y(0);
  return (
    <Svg width={width} height={chartH + 22}>
      <Rect x={0} y={0} width={width} height={chartH + 22} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActive(null))} />
      <SvgText x={padL - 6} y={padT + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(maxAbs)}</SvgText>
      <SvgText x={padL - 6} y={padT + usableH + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmtK(-maxAbs)}</SvgText>
      <Line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke={C.text} strokeWidth={1} opacity={0.28} />
      {data.map((d, i) => {
        const yy = y(d.net);
        const color = d.net >= 0 ? C.income : C.expense;
        return (
          <G key={i}>
            <Rect x={cx(i) - barW / 2} y={Math.min(yy, zeroY)} width={barW} height={Math.max(Math.abs(yy - zeroY), 1)} rx={4} fill={color} opacity={active === null || active === i ? 0.95 : 0.4} {...svgPress(() => setActive(active === i ? null : i))} />
            {/* Taux d'épargne en libellé direct (un seul axe : pas de 2ᵉ échelle). */}
            <SvgText x={cx(i)} y={d.net >= 0 ? yy - 5 : yy + 12} fill={C.textSecondary} fontSize={8.5} fontWeight="700" textAnchor="middle">{d.rate.toFixed(0)}%</SvgText>
            <SvgText x={cx(i)} y={chartH + 12} fill={C.textSecondary} fontSize={9} textAnchor="middle">{d.label}</SvgText>
          </G>
        );
      })}
      {active !== null ? <ChartTooltip cx={cx(active)} cy={y(data[active].net)} text={fmtSigned(data[active].net)} color={data[active].net >= 0 ? C.income : C.expense} chartWidth={width} padR={padR} /> : null}
    </Svg>
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
  const labelW = 92, valW = 64, trackW = Math.max(40, width - labelW - valW - 8);
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
              <Text style={{ width: valW, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: '700' }}>{fmtFull(r.current)}</Text>
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

/* ═══ Indicateur santé (épargne de sécurité) ═══ */
function HealthIndicator({ label, value, thresholds }: { label: string; value: number; thresholds: { level: number; label: string; color: string }[] }) {
  const C = useReportingColors();
  const maxLevel = Math.max(...thresholds.map((t) => t.level), value) * 1.2 || 1;
  const pct = Math.min((value / maxLevel) * 100, 100);
  const valueColor = (() => { for (let i = thresholds.length - 1; i >= 0; i--) if (value >= thresholds[i].level) return thresholds[i].color; return C.expense; })();
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
        <Text style={{ color: valueColor, fontSize: 13, fontWeight: '700' }}>{fmtFull(value)}</Text>
      </View>
      <View style={{ height: 10, backgroundColor: C.cardBorder, borderRadius: 5, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: valueColor, borderRadius: 5 }} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4, height: 16 }}>
        {thresholds.map((t, i) => (
          <View key={i} style={{ position: 'absolute', left: `${(t.level / maxLevel) * 100}%` as any }}>
            <View style={{ width: 1, height: 6, backgroundColor: t.color, marginBottom: 2 }} />
            <Text style={{ color: t.color, fontSize: 8 }}>{t.label}</Text>
          </View>
        ))}
      </View>
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

/* ═══ Tuile composition patrimoine (mini sparkline) ═══ */
function CompositionTile({ label, value, color, points, width }: { label: string; value: number; color: string; points: { label: string; value: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  return (
    <View style={[s.chartCard, { flex: 1, padding: 11, minWidth: 0 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={{ color: C.textSecondary, fontSize: 11, fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>{fmtFull(value)}</Text>
      <AreaLineChart points={points} width={width} color={color} height={38} showAxis={false} />
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

const s0 = (C: any) => ({ empty: { color: C.textSecondary, textAlign: 'center' as const, padding: 24, fontSize: 13 } });

/* ═══════════════════  MAIN SCREEN  ═══════════════════ */
export default function ReportingScreen() {
  const C = useReportingColors();
  const s = makeStyles(C);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const { width: screenW } = useWindowDimensions();
  const chartWidth = Math.min(screenW - 48, 500);

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
  const { period, setPeriod } = useReportingPeriod(user?.id);

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

  // ── Fenêtre de mois (période choisie, bornée à la 1ʳᵉ donnée). ──
  const dataStartYM = useMemo(() => {
    let earliest: string | null = null;
    for (const a of allAccounts) { const ym = ((a as any).created_at ?? '').substring(0, 7); if (ym && (!earliest || ym < earliest)) earliest = ym; }
    for (const t of allTx as any[]) { const ym = (t.date ?? '').substring(0, 7); if (ym && (!earliest || ym < earliest)) earliest = ym; }
    return earliest;
  }, [allAccounts, allTx]);
  const months = useMemo(() => monthsWindow(period, dataStartYM), [period, dataStartYM]);

  // ── Séries. ──
  const monthlyFlux = useMemo(() => buildMonthlyFlux(fluxTx, months), [fluxTx, months]);
  const savingsSeries = useMemo(() => buildSavingsSeries(allTx as ReportTx[], months, typeById), [allTx, months, typeById]);
  const idsOfType = (t: string) => new Set(allAccounts.filter((a: any) => a.type === t).map((a: any) => a.id));
  const allIds = useMemo(() => new Set(allAccounts.map((a: any) => a.id)), [allAccounts]);
  const today = todayISO();
  const netWorthTotal = useMemo(() => buildBalanceSeries(allIds, allAccounts as any, allTx as ReportTx[], months, today), [allIds, allAccounts, allTx, months, today]);
  const checkingSeries = useMemo(() => buildBalanceSeries(idsOfType('checking'), allAccounts as any, allTx as ReportTx[], months, today), [allAccounts, allTx, months, today]);
  const savingsBalSeries = useMemo(() => buildBalanceSeries(idsOfType('savings'), allAccounts as any, allTx as ReportTx[], months, today), [allAccounts, allTx, months, today]);
  const investSeries = useMemo(() => buildBalanceSeries(idsOfType('investment'), allAccounts as any, allTx as ReportTx[], months, today), [allAccounts, allTx, months, today]);

  const curYm = today.substring(0, 7);
  const prevYm = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  const categoryBreakdown = useMemo(() => buildCategoryBreakdown(fluxTx, curYm, grandCategoryName, 7), [fluxTx, curYm, catById]);
  const topCategories = useMemo(() => buildTopCategoriesCompare(fluxTx, curYm, prevYm, grandCategoryName, 5), [fluxTx, curYm, prevYm, catById]);

  // ── KPIs. ──
  const patrimoineTotal = useMemo(() => allAccounts.reduce((sum: number, a: any) => sum + Number(a.balance), 0), [allAccounts]);
  const lastFlux = monthlyFlux[monthlyFlux.length - 1];
  const prevFlux = monthlyFlux[monthlyFlux.length - 2];
  const monthSaved = savingsSeries[savingsSeries.length - 1]?.saved ?? 0;
  const monthIncome = lastFlux?.income ?? 0;
  const savingsRate = monthIncome > 0 ? Math.round((monthSaved / monthIncome) * 100) : 0;
  const expenseDelta = lastFlux && prevFlux && prevFlux.expense > 0 ? Math.round(((lastFlux.expense - prevFlux.expense) / prevFlux.expense) * 100) : null;

  const balanceByType = { checking: (allAccounts as any[]).filter((a) => a.type === 'checking').reduce((s2, a) => s2 + Number(a.balance), 0), savings: (allAccounts as any[]).filter((a) => a.type === 'savings').reduce((s2, a) => s2 + Number(a.balance), 0), investment: (allAccounts as any[]).filter((a) => a.type === 'investment').reduce((s2, a) => s2 + Number(a.balance), 0) };

  // ── Bilan intelligent. ──
  const insights = useMemo(() => buildInsights({
    monthlyFlux, savingsSeries, netWorthTotal, categoryBreakdown, monthIncome, monthSaved,
    variableTrendPct: pilotage?.variable_trend_percentage ?? null,
    hasVariableBaseline: (pilotage?.avg_variable_expenses_3m ?? 0) > 0,
    daysSinceVerification: (() => { const lv = pilotage?.confidence_inputs?.lastVerifiedAt; if (!lv) return null; return Math.floor((Date.now() - new Date(lv + 'T00:00:00').getTime()) / 86400000); })(),
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

          {/* Sélecteur de période */}
          <FadeIn delay={60}>
            <View style={s.periodRow}>
              {([3, 6, 12] as ReportingPeriod[]).map((p) => {
                const on = period === p;
                return (
                  <TouchableOpacity key={p} style={[s.periodBtn, on && { backgroundColor: C.violet, borderColor: C.violet }]} onPress={() => setPeriod(p)} activeOpacity={0.85}>
                    <Text style={[s.periodTxt, { color: on ? '#fff' : C.textSecondary }]}>{p} mois</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </FadeIn>

          {/* KPIs */}
          <FadeIn delay={100}>
            <View style={s.kpiRow}>
              <KpiCard icon="layers-outline" label="Patrimoine net" value={fmtFull(patrimoineTotal)} color={ACCOUNT_COLORS.checking} sub={netWorthTotal.length >= 2 ? `${fmtSigned(netWorthTotal[netWorthTotal.length - 1].value - netWorthTotal[0].value)} sur ${months.length} mois` : undefined} />
              <KpiCard icon="wallet-outline" label="Net du mois" value={lastFlux ? fmtSigned(lastFlux.net) : '—'} color={lastFlux && lastFlux.net >= 0 ? C.income : C.expense} sub={lastFlux ? `${fmtFull(lastFlux.income)} − ${fmtFull(lastFlux.expense)}` : undefined} />
              <KpiCard icon="shield-checkmark-outline" label="Taux d'épargne" value={`${savingsRate} %`} color={C.income} sub={`${fmtFull(monthSaved)} mis de côté`} />
              <KpiCard icon="swap-vertical-outline" label="Dépenses vs M-1" value={expenseDelta == null ? '—' : `${expenseDelta > 0 ? '+' : ''}${expenseDelta} %`} color={expenseDelta != null && expenseDelta > 0 ? C.expense : C.income} sub={lastFlux ? fmtFull(lastFlux.expense) : undefined} />
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

          {/* ══ PATRIMOINE ══ */}
          <FadeIn delay={180}><GroupHeader icon="layers-outline" title="Patrimoine" color={ACCOUNT_COLORS.checking} /></FadeIn>
          <FadeIn delay={210}>
            <View style={s.section}>
              <Text style={[s.sectionSub, { marginTop: 2 }]}>Patrimoine net total · {months.length} mois</Text>
              <View style={s.chartCard}>
                <Text style={{ fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5 }}>{fmtFull(patrimoineTotal)}</Text>
                <AreaLineChart points={netWorthTotal} width={chartWidth} color={ACCOUNT_COLORS.checking} height={120} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <CompositionTile label="Courant" value={balanceByType.checking} color={ACCOUNT_COLORS.checking} points={checkingSeries} width={(chartWidth - 20) / 3 - 22} />
                <CompositionTile label="Épargne" value={balanceByType.savings} color={ACCOUNT_COLORS.savings} points={savingsBalSeries} width={(chartWidth - 20) / 3 - 22} />
                <CompositionTile label="Invest." value={balanceByType.investment} color={ACCOUNT_COLORS.investment} points={investSeries} width={(chartWidth - 20) / 3 - 22} />
              </View>
            </View>
          </FadeIn>

          {/* ══ DÉPENSES ══ */}
          <FadeIn delay={260}><GroupHeader icon="card-outline" title="Dépenses" color={C.expense} /></FadeIn>
          <FadeIn delay={290}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="pie-chart-outline" size={20} color={C.cat[0]} /><Text style={s.sectionTitle}>Où part mon argent</Text></View>
              <Text style={s.sectionSub}>Répartition des dépenses du mois en cours</Text>
              <View style={s.chartCard}><CategoryDonut data={categoryBreakdown} width={chartWidth - 32} /></View>
            </View>
          </FadeIn>
          <FadeIn delay={330}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="bar-chart-outline" size={20} color={C.income} /><Text style={s.sectionTitle}>Revenus vs Dépenses</Text></View>
              <Text style={s.sectionSub}>{months.length} mois</Text>
              <View style={s.chartCard}>
                <View style={s.legendRow}>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.income }]} /><Text style={s.legendSmall}>Revenus</Text></View>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.expense }]} /><Text style={s.legendSmall}>Dépenses</Text></View>
                </View>
                {monthlyFlux.length > 0 ? <IncomeExpenseBars data={monthlyFlux} width={chartWidth} /> : <Text style={s.emptyChart}>Aucune transaction</Text>}
              </View>
            </View>
          </FadeIn>
          <FadeIn delay={370}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="podium-outline" size={20} color={C.violet} /><Text style={s.sectionTitle}>Top postes de dépense</Text></View>
              <Text style={s.sectionSub}>Par grande catégorie · ce mois vs précédent</Text>
              <View style={s.chartCard}><HBarCompare rows={topCategories} width={chartWidth} /></View>
            </View>
          </FadeIn>

          {/* ══ ÉPARGNE ══ */}
          <FadeIn delay={410}><GroupHeader icon="leaf-outline" title="Épargne" color={ACCOUNT_COLORS.savings} /></FadeIn>
          {pilotage ? (
            <FadeIn delay={440}>
              <View style={s.section}>
                <View style={s.sectionHeader}><Ionicons name="pulse-outline" size={20} color={C.income} /><Text style={s.sectionTitle}>Santé financière</Text></View>
                <Text style={s.sectionSub}>Épargne de sécurité & tendances</Text>
                <View style={s.chartCard}>
                  <HealthIndicator label="Épargne de sécurité" value={pilotage.current_savings} thresholds={[{ level: pilotage.safety_threshold_min, label: 'Min', color: C.expense }, { level: pilotage.safety_threshold_optimal, label: 'Optimal', color: C.amber }, { level: pilotage.safety_threshold_comfort, label: 'Confort', color: C.income }]} />
                  <View style={{ height: 10 }} />
                  <View style={s.healthRow}>
                    <View style={s.healthItem}>
                      <Text style={s.healthLabel}>Tendance variables</Text>
                      <Text style={[s.healthValue, { color: pilotage.variable_trend_percentage <= 100 ? C.income : C.expense }]}>{pilotage.variable_trend_percentage.toFixed(0)}%</Text>
                      <Text style={s.healthHint}>{pilotage.variable_trend_percentage <= 100 ? 'Sous contrôle' : 'Attention'}</Text>
                    </View>
                    <View style={s.healthDivider} />
                    <View style={s.healthItem}>
                      <Text style={s.healthLabel}>Surplus projeté</Text>
                      <Text style={[s.healthValue, { color: pilotage.projected_surplus > 0 ? C.income : C.textSecondary }]}>{fmtFull(pilotage.projected_surplus)}</Text>
                      <Text style={s.healthHint}>{pilotage.recommendation}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </FadeIn>
          ) : null}
          <FadeIn delay={480}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="wallet-outline" size={20} color={C.amber} /><Text style={s.sectionTitle}>Reste chaque mois</Text></View>
              <Text style={s.sectionSub}>Revenus − dépenses, avec le taux d'épargne · {months.length} mois</Text>
              <View style={s.chartCard}><NetBars data={monthlyFlux} width={chartWidth} /></View>
            </View>
          </FadeIn>

          {/* ══ RÉCAPITULATIF ══ */}
          <FadeIn delay={540}><GroupHeader icon="grid-outline" title="Récapitulatif" color={C.violet} /></FadeIn>
          <FadeIn delay={570}>
            <View style={s.section}>
              <View style={s.sectionHeader}><Ionicons name="calendar-outline" size={20} color={C.violet} /><Text style={s.sectionTitle}>Récapitulatif mensuel</Text></View>
              <Text style={s.sectionSub}>Revenus, dépenses et net par mois</Text>
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

    periodRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    periodBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card },
    periodTxt: { fontSize: 13, fontWeight: '700' },

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
