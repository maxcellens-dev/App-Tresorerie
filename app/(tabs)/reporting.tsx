import { View, Text, StyleSheet, ScrollView, RefreshControl, Dimensions, useWindowDimensions, TouchableOpacity, Platform } from 'react-native';
import ScreenGradient from '../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// onPress n'est pas reconnu par les éléments SVG sur web — on utilise onClick à la place
const svgPress = (handler: () => void): Record<string, unknown> =>
  Platform.OS === 'web' ? { onClick: handler } : { onPress: handler };
import Svg, { Rect, Text as SvgText, Line, Circle, Path, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTransactions } from '../hooks/useTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { usePilotageData } from '../hooks/usePilotageData';
import { useProfile } from '../hooks/useProfile';
import { usePlan } from '../hooks/usePlan';
import { useNavBack } from '../hooks/useNavBack';
import { ACCOUNT_COLORS, SEMANTIC, accountColor } from '../theme/colors';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';

/* ── Couleurs fixes des graphiques (sémantique indépendante du thème) ── */
const CHART = {
  emerald: '#34d399',
  emeraldDark: '#059669',
  rose: '#fb7185',
  roseDark: '#e11d48',
  amber: '#fbbf24',
  violet: '#a78bfa',
  sky: '#38bdf8',
  indigo: '#818cf8',
  teal: '#2dd4bf',
  orange: '#fb923c',
  pink: '#f472b6',
  lime: '#a3e635',
  cyan: '#22d3ee',
};

const CHART_PALETTE = [CHART.emerald, CHART.rose, CHART.violet, CHART.sky, CHART.amber, CHART.orange, CHART.pink, CHART.teal, CHART.lime, CHART.cyan, CHART.indigo];

/** Couleurs du Reporting : thème (bg/card/text…) + palette de graphiques fixe.
 *  `emerald` est ramené au VERT sémantique (Style Editor) pour respecter le thème clair. */
function useReportingColors() {
  const t = useAppColors();
  return { ...t, ...CHART, emerald: t.green, emeraldDark: t.green };
}

const fmt = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return n.toFixed(0);
};

const fmtFull = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ' + CURRENCY_SYMBOL;

const formatTooltipValue = (n: number) => `${n >= 0 ? '+' : '−'}${fmtFull(Math.abs(n))}`;

// Tooltip SVG positionné à côté du point (droite ou gauche selon l'espace)
function ChartTooltip({ cx, cy, value, color, chartWidth, padL = 0, padR = 0 }: {
  cx: number; cy: number; value: number; color: string;
  chartWidth: number; padL?: number; padR?: number;
}) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const text = formatTooltipValue(value);
  const boxW = 88;
  const boxH = 28;
  const gap = 10;
  const rightEdge = chartWidth - padR;
  const fromRight = cx + gap + boxW > rightEdge;
  const tx = fromRight ? cx - gap - boxW : cx + gap;
  const ty = Math.max(2, cy - boxH / 2);
  const lineEndX = fromRight ? cx - gap : cx + gap;
  return (
    <G>
      <Line x1={cx} y1={cy} x2={lineEndX} y2={cy} stroke={color} strokeWidth={1} strokeOpacity="0.6" />
      <Rect x={tx} y={ty} width={boxW} height={boxH} rx={8} fill={C.bg} stroke={color} strokeWidth={1.5} />
      <SvgText x={tx + boxW / 2} y={ty + boxH / 2 + 4} fill={C.text} fontSize={11} fontWeight="700" textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

function BarChart({ data, width }: { data: { label: string; income: number; expense: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<{ idx: number; type: 'income' | 'expense' } | null>(null);
  const chartW = width - 52;
  const chartH = 170;
  const barGroupW = chartW / data.length;
  const barW = barGroupW * 0.3;
  const gap = 4;
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);

  return (
    <View>
      <Svg width={width} height={chartH + 56}>
        <Rect x={0} y={0} width={width} height={chartH + 56} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActive(null))} />
        <Defs>
          <LinearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.emerald} stopOpacity="0.9" />
            <Stop offset="1" stopColor={C.emeraldDark} stopOpacity="0.6" />
          </LinearGradient>
          <LinearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.rose} stopOpacity="0.9" />
            <Stop offset="1" stopColor={C.roseDark} stopOpacity="0.6" />
          </LinearGradient>
        </Defs>
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = chartH - pct * chartH;
          return (
            <G key={i}>
              <Line x1={44} y1={y} x2={width} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
              <SvgText x={40} y={y + 4} fill={C.textSecondary} fontSize={10} textAnchor="end">
                {fmt(maxVal * pct)}
              </SvgText>
            </G>
          );
        })}
        {data.map((d, i) => {
          const x = 48 + i * barGroupW + (barGroupW - barW * 2 - gap) / 2;
          const incomeH = (d.income / maxVal) * chartH;
          const expenseH = (d.expense / maxVal) * chartH;
          return (
            <G key={i}>
              <Rect
                x={x}
                y={chartH - incomeH}
                width={barW}
                height={incomeH}
                rx={3}
                fill="url(#gi)"
                {...svgPress(() => setActive({ idx: i, type: 'income' }))}
              />
              <Rect
                x={x + barW + gap}
                y={chartH - expenseH}
                width={barW}
                height={expenseH}
                rx={3}
                fill="url(#ge)"
                {...svgPress(() => setActive({ idx: i, type: 'expense' }))}
              />
            </G>
          );
        })}
        {active ? (() => {
          const point = data[active.idx];
          const value = active.type === 'income' ? point.income : point.expense;
          const cx = 48 + active.idx * barGroupW + (barGroupW - barW * 2 - gap) / 2 + (active.type === 'income' ? barW / 2 : barW + gap + barW / 2);
          const cy = chartH - (value / maxVal) * chartH;
          const tipColor = active.type === 'income' ? C.emerald : C.rose;
          return <ChartTooltip cx={cx} cy={cy} value={value} color={tipColor} chartWidth={width} padL={48} padR={0} />;
        })() : null}
        {data.map((d, i) => {
          const x = 48 + i * barGroupW + (barGroupW - barW * 2 - gap) / 2;
          return (
            <SvgText key={`label-${i}`} x={x + barW + gap / 2} y={chartH + 14} fill={C.textSecondary} fontSize={10} textAnchor="middle">
              {d.label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

function AreaLineChart({ points, width, color, height = 120 }: { points: { label: string; value: number }[]; width: number; color: string; height?: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartH = height;
  const padL = 48;
  const padR = 12;
  const usable = width - padL - padR;
  if (points.length < 2) return <Text style={{ color: C.textSecondary, padding: 20 }}>Données insuffisantes</Text>;

  const maxVal = Math.max(...points.map(p => p.value), 1);
  const minVal = Math.min(...points.map(p => p.value), 0);
  const range = maxVal - minVal || 1;

  const coords = points.map((p, i) => ({
    x: padL + (i / (points.length - 1)) * usable,
    y: 8 + (1 - (p.value - minVal) / range) * (chartH - 16),
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath = linePath + ` L ${coords[coords.length - 1].x} ${chartH} L ${coords[0].x} ${chartH} Z`;

  return (
    <Svg width={width} height={chartH + 42}>
      <Rect x={0} y={0} width={width} height={chartH + 42} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActiveIndex(null))} />
      <Defs>
        <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.3" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {[0, 0.5, 1].map((pct, i) => {
        const y = 8 + (1 - pct) * (chartH - 16);
        const val = minVal + pct * range;
        return (
          <G key={i}>
            <Line x1={padL} y1={y} x2={width - padR} y2={y} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padL - 6} y={y + 4} fill={C.textSecondary} fontSize={10} textAnchor="end">{fmt(val)}</SvgText>
          </G>
        );
      })}
      <Path d={areaPath} fill="url(#areaGrad)" {...svgPress(() => setActiveIndex(null))} />
      <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" {...svgPress(() => setActiveIndex(null))} />
      {coords.map((c, i) => (
        <Circle
          key={`dot-${i}`}
          cx={c.x}
          cy={c.y}
          r={4}
          fill={C.bg}
          stroke={color}
          strokeWidth={2}
          {...svgPress(() => setActiveIndex(i === activeIndex ? null : i))}
        />
      ))}
      {activeIndex !== null ? (
        <ChartTooltip
          cx={coords[activeIndex].x}
          cy={coords[activeIndex].y}
          value={points[activeIndex].value}
          color={color}
          chartWidth={width}
          padL={padL}
          padR={padR}
        />
      ) : null}
      {points.map((p, i) => {
        const step = Math.max(1, Math.ceil(points.length / 6));
        if (i % step !== 0 && i !== points.length - 1) return null;
        return (
          <SvgText key={`label-${i}`} x={coords[i].x} y={chartH + 14} fill={C.textSecondary} fontSize={9} textAnchor="middle">
            {p.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

/* ── Combo : barres d'épargne nette + courbe du taux d'épargne ── */
function NetSavingsChart({ data, width }: { data: { label: string; net: number; rate: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const [active, setActive] = useState<number | null>(null);
  if (data.length < 2) return <Text style={{ color: C.textSecondary, padding: 20, textAlign: 'center' }}>Données insuffisantes</Text>;
  const chartH = 160;
  const padL = 44, padR = 32, padT = 14, padB = 22;
  const usableW = width - padL - padR;
  const usableH = chartH - padT - padB;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.net)), 1);
  const minV = Math.min(0, -maxAbs);
  const maxV = Math.max(0, maxAbs);
  const range = maxV - minV || 1;
  const y = (v: number) => padT + (1 - (v - minV) / range) * usableH;
  const slot = usableW / data.length;
  const barW = Math.min(22, slot * 0.5);
  const cx = (i: number) => padL + slot * i + slot / 2;
  const zeroY = y(0);
  // taux d'épargne borné [−20, 80] pour la lisibilité de la courbe
  const rateMin = -20, rateMax = 80;
  const ry = (r: number) => padT + (1 - (Math.max(rateMin, Math.min(rateMax, r)) - rateMin) / (rateMax - rateMin)) * usableH;
  const ratePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${cx(i)} ${ry(d.rate)}`).join(' ');
  return (
    <View>
      <Svg width={width} height={chartH + 24}>
        <Rect x={0} y={0} width={width} height={chartH + 24} fill="rgba(0,0,0,0.001)" {...svgPress(() => setActive(null))} />
        {[0, 0.5, 1].map((pct, i) => {
          const yy = padT + pct * usableH;
          return <Line key={i} x1={padL} y1={yy} x2={width - padR} y2={yy} stroke={C.cardBorder} strokeWidth={1} strokeDasharray="4,4" />;
        })}
        <SvgText x={padL - 6} y={padT + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmt(maxV)}</SvgText>
        <SvgText x={padL - 6} y={padT + usableH + 4} fill={C.textSecondary} fontSize={9} textAnchor="end">{fmt(minV)}</SvgText>
        <Line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke={C.text} strokeWidth={1} opacity={0.3} />
        {/* axe droite : taux */}
        <SvgText x={width - padR + 6} y={ry(rateMax) + 4} fill={C.textSecondary} fontSize={9} textAnchor="start">{rateMax}%</SvgText>
        <SvgText x={width - padR + 6} y={ry(0) + 4} fill={C.textSecondary} fontSize={9} textAnchor="start">0%</SvgText>
        {data.map((d, i) => {
          const yy = y(d.net);
          const h = Math.abs(yy - zeroY);
          const color = d.net >= 0 ? C.emerald : C.rose;
          return (
            <Rect key={i} x={cx(i) - barW / 2} y={Math.min(yy, zeroY)} width={barW} height={Math.max(h, 1)} rx={3} fill={color} opacity={active === null || active === i ? 0.9 : 0.4} {...svgPress(() => setActive(active === i ? null : i))} />
          );
        })}
        <Path d={ratePath} fill="none" stroke={C.amber} strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => <Circle key={`r-${i}`} cx={cx(i)} cy={ry(d.rate)} r={3} fill={C.bg} stroke={C.amber} strokeWidth={1.5} {...svgPress(() => setActive(active === i ? null : i))} />)}
        {active !== null ? (
          <G>
            <SvgText x={Math.min(width - padR, Math.max(padL + 20, cx(active)))} y={Math.max(12, Math.min(y(data[active].net), ry(data[active].rate)) - 8)} fill={C.text} fontSize={10.5} fontWeight="700" textAnchor="middle">
              {`${data[active].net >= 0 ? '+' : '−'}${fmt(Math.abs(data[active].net))} · ${data[active].rate.toFixed(0)}%`}
            </SvgText>
          </G>
        ) : null}
        {data.map((d, i) => <SvgText key={`l-${i}`} x={cx(i)} y={chartH + 14} fill={C.textSecondary} fontSize={9} textAnchor="middle">{d.label}</SvgText>)}
      </Svg>
      <View style={[s.legendWrap, { marginTop: 4 }]}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.emerald }]} /><Text style={s.legendLabel}>Épargne nette</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.amber }]} /><Text style={s.legendLabel}>Taux d'épargne</Text></View>
      </View>
    </View>
  );
}

/* ── Barres horizontales : top postes de dépense ce mois vs mois précédent ── */
function HBarCompare({ rows, width }: { rows: { label: string; current: number; previous: number }[]; width: number }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  if (!rows.length) return <Text style={s.emptyChart}>Aucune dépense ce mois</Text>;
  const maxVal = Math.max(...rows.flatMap((r) => [r.current, r.previous]), 1);
  const labelW = 96;
  const valW = 64;
  const trackW = Math.max(40, width - labelW - valW - 8);
  return (
    <View>
      {rows.map((r, i) => {
        const curPct = (r.current / maxVal) * 100;
        const prevPct = (r.previous / maxVal) * 100;
        const diff = r.current - r.previous;
        return (
          <View key={i} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ width: labelW, color: C.text, fontSize: 12, fontWeight: '500' }} numberOfLines={1}>{r.label}</Text>
              <View style={{ width: trackW }}>
                {/* mois précédent (contour) */}
                <View style={{ height: 6, borderRadius: 3, backgroundColor: C.cardBorder, marginBottom: 3, width: `${Math.max(prevPct, 1.5)}%` as any }} />
                {/* mois en cours (plein) */}
                <View style={{ height: 12, borderRadius: 4, backgroundColor: C.violet, width: `${Math.max(curPct, 1.5)}%` as any }} />
              </View>
              <Text style={{ width: valW, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: '700' }}>{fmtFull(r.current)}</Text>
            </View>
            <Text style={{ marginLeft: labelW, color: diff > 0 ? C.rose : C.emerald, fontSize: 10, marginTop: 2 }}>
              {diff === 0 ? '= stable' : `${diff > 0 ? '▲' : '▼'} ${fmtFull(Math.abs(diff))} vs mois préc.`}
            </Text>
          </View>
        );
      })}
      <View style={[s.legendWrap, { marginTop: 4 }]}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.violet }]} /><Text style={s.legendLabel}>Ce mois</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.cardBorder, borderWidth: 1, borderColor: C.textSecondary }]} /><Text style={s.legendLabel}>Mois précédent</Text></View>
      </View>
    </View>
  );
}

/* ── Animated fade-in wrapper ── */
function FadeIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 500, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/* ── En-tête de section thématique (Patrimoine, Dépenses, Épargne…) ── */
function GroupHeader({ icon, title, color }: { icon: string; title: string; color: string }) {
  const C = useReportingColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 34, marginBottom: 2 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon as any} size={19} color={color} />
      </View>
      <Text style={{ fontSize: 19, fontWeight: '800', color: C.text, letterSpacing: -0.3 }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.cardBorder, marginLeft: 4 }} />
    </View>
  );
}

/* ── Mini-graphe compact de patrimoine net (1 par type de compte) ── */
function NetWorthMini({ label, value, color, points, width }: {
  label: string; value: number; color: string; points: { label: string; value: number }[]; width: number;
}) {
  const C = useReportingColors();
  const s = makeStyles(C);
  return (
    <View style={[s.chartCard, { paddingVertical: 12, marginBottom: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, marginRight: 8 }} />
        <Text style={{ color: C.text, fontSize: 13.5, fontWeight: '700', flex: 1 }}>{label}</Text>
        <Text style={{ color, fontSize: 15, fontWeight: '800' }}>{fmtFull(value)}</Text>
      </View>
      <AreaLineChart points={points} width={width} color={color} height={62} />
    </View>
  );
}

/* ── Summary KPI Card ── */
function KpiCard({ icon, label, value, color, sub }: { icon: string; label: string; value: string; color: string; sub?: string }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  return (
    <View style={[s.kpiCard, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Ionicons name={icon as any} size={18} color={color} />
        <Text style={s.kpiLabel}>{label}</Text>
      </View>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

/* ═══════════════════  MAIN SCREEN  ═══════════════════ */
export default function ReportingScreen() {
  const C = useReportingColors();
  const THEME = useAppColors(); // accent réel — C.emerald est écrasé par CHART
  const s = makeStyles(C);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const { width: screenW } = useWindowDimensions();
  const chartWidth = Math.min(screenW - 48, 500);

  // Reporting réservé aux abonnés Premium (les admins y accèdent toujours).
  const { data: profile } = useProfile(user?.id);
  const { isPremium } = usePlan(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const reportingAllowed = isPremium || isAdmin;

  const { data: transactions, refetch: rTx } = useTransactions(user?.id);
  const { data: accounts, refetch: rAcc } = useAccounts(user?.id);
  const { data: categories } = useCategories(user?.id);
  const { data: pilotage, refetch: rPil } = usePilotageData(user?.id);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([rTx(), rAcc(), rPil()]);
    setRefreshing(false);
  };

  /* ── Mois de départ : on n'affiche jamais de mois antérieur à la 1ʳᵉ donnée
   *    (création des comptes / 1ʳᵉ transaction). L'historique se remplit donc
   *    progressivement jusqu'à atteindre 12 mois. ── */
  const dataStartYM = useMemo(() => {
    let earliest: string | null = null;
    for (const a of accounts ?? []) {
      const ym = (a.created_at ?? '').substring(0, 7);
      if (ym && (!earliest || ym < earliest)) earliest = ym;
    }
    for (const t of transactions ?? []) {
      const ym = (t.date ?? '').substring(0, 7);
      if (ym && (!earliest || ym < earliest)) earliest = ym;
    }
    return earliest; // 'YYYY-MM' ou null
  }, [accounts, transactions]);

  /* ── Liste des N derniers mois, bornée au mois de création ── */
  const monthsWindow = (maxN: number) => {
    const now = new Date();
    const out: { year: number; month: number; ym: string; label: string }[] = [];
    for (let i = maxN - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (dataStartYM && ym < dataStartYM) continue; // pas avant la 1ʳᵉ donnée
      out.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        ym,
        label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
      });
    }
    return out;
  };

  /* ── Résolution « grande catégorie » (parent) d'une catégorie ── */
  const catById = useMemo(() => {
    const m = new Map<string, { name: string; parent_id?: string | null }>();
    for (const c of categories ?? []) m.set(c.id, { name: c.name, parent_id: c.parent_id });
    return m;
  }, [categories]);

  const grandCategoryName = (categoryId: string | null | undefined): string => {
    if (!categoryId) return 'Sans catégorie';
    const c = catById.get(categoryId);
    if (!c) return 'Sans catégorie';
    if (c.parent_id) return catById.get(c.parent_id)?.name ?? c.name;
    return c.name; // c'est déjà une grande catégorie
  };

  /* ── Revenus / dépenses par mois (jusqu'à 6 mois, borné à la création) ── */
  const monthlyIO = useMemo(() => {
    if (!transactions) return [];
    const months = monthsWindow(6).map(m => ({ ...m, income: 0, expense: 0 }));
    for (const t of transactions) {
      if (t.linked_account_id || t.is_draft) continue; // exclure virements internes & brouillons
      const ym = t.date.substring(0, 7);
      const bucket = months.find(b => b.ym === ym);
      if (!bucket) continue;
      if (Number(t.amount) >= 0) bucket.income += Number(t.amount);
      else bucket.expense += Math.abs(Number(t.amount));
    }
    return months;
  }, [transactions, dataStartYM]);

  /* ── 3. Épargne nette mensuelle + taux d'épargne, 12 mois ── */
  const netSavings12 = useMemo(() => {
    if (!transactions) return [];
    const months = monthsWindow(12);
    const acc: Record<string, { income: number; expense: number }> = {};
    months.forEach(m => { acc[m.ym] = { income: 0, expense: 0 }; });
    for (const t of transactions) {
      if (t.linked_account_id || t.is_draft) continue;
      const ym = t.date.substring(0, 7);
      if (!acc[ym]) continue;
      const amt = Number(t.amount);
      if (amt >= 0) acc[ym].income += amt;
      else acc[ym].expense += Math.abs(amt);
    }
    return months.map(m => {
      const { income, expense } = acc[m.ym];
      const net = income - expense;
      const rate = income > 0 ? (net / income) * 100 : 0;
      return { label: m.label, net, rate };
    });
  }, [transactions, dataStartYM]);

  /* ── Top postes de dépense (GRANDE catégorie) : mois en cours vs précédent ── */
  const topCategoriesCompare = useMemo(() => {
    if (!transactions) return [];
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const cur: Record<string, number> = {};
    const old: Record<string, number> = {};
    for (const t of transactions) {
      if (t.linked_account_id || t.is_draft) continue;
      if (Number(t.amount) >= 0) continue;
      const ym = t.date.substring(0, 7);
      const name = grandCategoryName(t.category_id);
      const amt = Math.abs(Number(t.amount));
      if (ym === curYm) cur[name] = (cur[name] ?? 0) + amt;
      else if (ym === prevYm) old[name] = (old[name] ?? 0) + amt;
    }
    return Object.entries(cur)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, current]) => ({ label, current, previous: old[label] ?? 0 }));
  }, [transactions, catById]);

  /* ── Reconstruit l'évolution du solde (12 mois) pour un ensemble de comptes ── */
  const buildBalanceSeries = (ids: Set<string>) => {
    if (!accounts || !transactions) return [];
    const months = monthsWindow(12);
    const startNow = accounts.filter(a => ids.has(a.id)).reduce((s, a) => s + Number(a.balance), 0);
    const deltas: Record<string, number> = {};
    for (const t of transactions) {
      if (t.is_draft || !ids.has(t.account_id)) continue;
      const ym = t.date.substring(0, 7);
      deltas[ym] = (deltas[ym] ?? 0) + Number(t.amount);
    }
    const points: { label: string; value: number }[] = [];
    let running = startNow;
    for (let i = months.length - 1; i >= 0; i--) {
      points.unshift({ label: months[i].label, value: running });
      running -= (deltas[months[i].ym] ?? 0);
    }
    return points;
  };

  /* ── Patrimoine net dans le temps, par type de compte (12 mois) ── */
  const checkingEvolution = useMemo(
    () => buildBalanceSeries(new Set((accounts ?? []).filter(a => a.type === 'checking').map(a => a.id))),
    [accounts, transactions, dataStartYM],
  );
  const savingsEvolution = useMemo(
    () => buildBalanceSeries(new Set((accounts ?? []).filter(a => a.type === 'savings').map(a => a.id))),
    [accounts, transactions, dataStartYM],
  );
  const investmentEvolution = useMemo(
    () => buildBalanceSeries(new Set((accounts ?? []).filter(a => a.type === 'investment').map(a => a.id))),
    [accounts, transactions, dataStartYM],
  );

  /* ── Soldes actuels par type (pour l'en-tête de chaque mini-graphe) ── */
  const balanceByType = useMemo(() => ({
    checking: (accounts ?? []).filter(a => a.type === 'checking').reduce((s, a) => s + Number(a.balance), 0),
    savings: (accounts ?? []).filter(a => a.type === 'savings').reduce((s, a) => s + Number(a.balance), 0),
    investment: (accounts ?? []).filter(a => a.type === 'investment').reduce((s, a) => s + Number(a.balance), 0),
  }), [accounts]);

  /* ── Month totals ── */
  const { totalIncome, totalExpense } = useMemo(() => {
    if (!transactions) return { totalIncome: 0, totalExpense: 0 };
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    let inc = 0, exp = 0;
    for (const t of transactions) {
      const [y, m] = t.date.split('-').map(Number);
      if (y !== cy || m !== cm) continue;
      if (Number(t.amount) >= 0) inc += Number(t.amount);
      else exp += Math.abs(Number(t.amount));
    }
    return { totalIncome: inc, totalExpense: exp };
  }, [transactions]);

  const patrimoine = accounts?.reduce((s, a) => s + Number(a.balance), 0) ?? 0;

  if (!user) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
              <ScreenGradient />
      <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={48} color={C.textSecondary} />
            <Text style={{ color: C.textSecondary, marginTop: 12, fontSize: 15 }}>Connectez-vous pour accéder au reporting.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!reportingAllowed) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <ScreenGradient />
        <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="star-outline" size={48} color={C.amber} />
            <Text style={{ color: C.text, marginTop: 14, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>Reporting réservé aux abonnés Premium</Text>
            <Text style={{ color: C.textSecondary, marginTop: 8, fontSize: 13.5, textAlign: 'center', lineHeight: 19 }}>
              Graphiques détaillés, répartition par catégorie et évolution de votre patrimoine : passez Premium pour y accéder.
            </Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.amber, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 20 }}
              onPress={() => router.push('/(tabs)/(secondary)/premium' as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="star" size={16} color="#0f172a" />
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>Passer Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 16, padding: 8 }} onPress={goBack} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: C.textSecondary }}>Retour</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
            <ScreenGradient />
      <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.emerald} progressBackgroundColor={C.card} />}
        >
          {/* ═══ HEADER (retour uniquement) ═══ */}
          <FadeIn>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                onPress={goBack}
              >
                <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.textSecondary }}>Retour</Text>
              </TouchableOpacity>
            </View>
          </FadeIn>

          {/* ════════════════ SECTION PATRIMOINE ════════════════ */}
          <FadeIn delay={140}>
            <GroupHeader icon="layers-outline" title="Patrimoine" color={ACCOUNT_COLORS.checking} />
          </FadeIn>
          <FadeIn delay={170}>
            <View style={s.section}>
              <Text style={[s.sectionSub, { marginTop: 2 }]}>Patrimoine net par type de compte · jusqu'à 12 mois</Text>
              <NetWorthMini label="Compte courant" value={balanceByType.checking} color={ACCOUNT_COLORS.checking} points={checkingEvolution} width={chartWidth} />
              <NetWorthMini label="Épargne" value={balanceByType.savings} color={ACCOUNT_COLORS.savings} points={savingsEvolution} width={chartWidth} />
              <NetWorthMini label="Investissement" value={balanceByType.investment} color={ACCOUNT_COLORS.investment} points={investmentEvolution} width={chartWidth} />
            </View>
          </FadeIn>

          {/* ════════════════ SECTION DÉPENSES ════════════════ */}
          <FadeIn delay={250}>
            <GroupHeader icon="card-outline" title="Dépenses" color={C.rose} />
          </FadeIn>
          <FadeIn delay={280}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="bar-chart-outline" size={20} color={C.emerald} />
                <Text style={s.sectionTitle}>Revenus vs Dépenses</Text>
              </View>
              <Text style={s.sectionSub}>Jusqu'à 6 mois</Text>
              <View style={s.chartCard}>
                <View style={s.legendRow}>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.emerald }]} /><Text style={s.legendSmall}>Revenus</Text></View>
                  <View style={s.legendInline}><View style={[s.legendDot, { backgroundColor: C.rose }]} /><Text style={s.legendSmall}>Dépenses</Text></View>
                </View>
                {monthlyIO.length > 0 ? (
                  <BarChart data={monthlyIO} width={chartWidth} />
                ) : (
                  <Text style={s.emptyChart}>Aucune transaction</Text>
                )}
              </View>
            </View>
          </FadeIn>
          <FadeIn delay={360}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="podium-outline" size={20} color={C.orange} />
                <Text style={s.sectionTitle}>Top postes de dépense</Text>
              </View>
              <Text style={s.sectionSub}>Par grande catégorie · ce mois vs précédent</Text>
              <View style={s.chartCard}>
                <HBarCompare rows={topCategoriesCompare} width={chartWidth} />
              </View>
            </View>
          </FadeIn>

          {/* ════════════════ SECTION ÉPARGNE ════════════════ */}
          <FadeIn delay={400}>
            <GroupHeader icon="leaf-outline" title="Épargne" color={ACCOUNT_COLORS.savings} />
          </FadeIn>
          {/* Santé financière — placée avant l'épargne nette */}
          {pilotage ? (
            <FadeIn delay={430}>
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <Ionicons name="pulse-outline" size={20} color={C.teal} />
                  <Text style={s.sectionTitle}>Santé financière</Text>
                </View>
                <Text style={s.sectionSub}>Épargne de sécurité & tendances</Text>
                <View style={s.chartCard}>
                  <HealthIndicator
                    label="Épargne de sécurité"
                    value={pilotage.current_savings}
                    thresholds={[
                      { level: pilotage.safety_threshold_min, label: 'Min', color: C.rose },
                      { level: pilotage.safety_threshold_optimal, label: 'Optimal', color: C.amber },
                      { level: pilotage.safety_threshold_comfort, label: 'Confort', color: C.emerald },
                    ]}
                  />
                  <View style={{ height: 16 }} />
                  <View style={s.healthRow}>
                    <View style={s.healthItem}>
                      <Text style={s.healthLabel}>Tendance variables</Text>
                      <Text style={[s.healthValue, { color: pilotage.variable_trend_percentage <= 100 ? C.emerald : C.rose }]}>
                        {pilotage.variable_trend_percentage.toFixed(0)}%
                      </Text>
                      <Text style={s.healthHint}>{pilotage.variable_trend_percentage <= 100 ? 'Sous contrôle' : 'Attention'}</Text>
                    </View>
                    <View style={s.healthDivider} />
                    <View style={s.healthItem}>
                      <Text style={s.healthLabel}>Surplus projeté</Text>
                      <Text style={[s.healthValue, { color: pilotage.projected_surplus > 0 ? C.emerald : C.textSecondary }]}>
                        {fmtFull(pilotage.projected_surplus)}
                      </Text>
                      <Text style={s.healthHint}>{pilotage.recommendation}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </FadeIn>
          ) : null}
          <FadeIn delay={470}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="wallet-outline" size={20} color={C.amber} />
                <Text style={s.sectionTitle}>Épargne nette & taux</Text>
              </View>
              <Text style={s.sectionSub}>Revenus − dépenses, et part épargnée · jusqu'à 12 mois</Text>
              <View style={s.chartCard}>
                <NetSavingsChart data={netSavings12} width={chartWidth} />
              </View>
            </View>
          </FadeIn>

          {/* ════════════════ SECTION RÉCAPITULATIF ════════════════ */}
          <FadeIn delay={600}>
            <GroupHeader icon="grid-outline" title="Récapitulatif" color={C.indigo} />
          </FadeIn>
          <FadeIn delay={640}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="calendar-outline" size={20} color={C.indigo} />
                <Text style={s.sectionTitle}>Récapitulatif mensuel</Text>
              </View>
              <Text style={s.sectionSub}>Revenus, dépenses et solde par mois</Text>
              <View style={s.tableCard}>
                <View style={s.tableHeaderRow}>
                  <Text style={[s.tableHeaderCell, { flex: 2 }]}>Mois</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Revenus</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Dépenses</Text>
                  <Text style={[s.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Solde</Text>
                </View>
                {monthlyIO.map((row, i) => {
                  const balance = row.income - row.expense;
                  return (
                    <View key={i} style={[s.tableRow, i % 2 === 0 && s.tableRowAlt]}>
                      <Text style={[s.tableCell, { flex: 2 }]}>{row.label}</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.emerald }]}>{fmtFull(row.income)}</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: C.rose }]}>{fmtFull(row.expense)}</Text>
                      <Text style={[s.tableCell, { flex: 2, textAlign: 'right', color: balance >= 0 ? C.emerald : C.rose }]}>
                        {balance >= 0 ? '+' : ''}{fmtFull(balance)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </FadeIn>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ── Health indicator bar ── */
function HealthIndicator({ label, value, thresholds }: { label: string; value: number; thresholds: { level: number; label: string; color: string }[] }) {
  const C = useReportingColors();
  const s = makeStyles(C);
  const maxLevel = Math.max(...thresholds.map(t => t.level), value) * 1.2;
  const pct = Math.min((value / maxLevel) * 100, 100);
  const valueColor = (() => {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (value >= thresholds[i].level) return thresholds[i].color;
    }
    return C.rose;
  })();

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
        <Text style={{ color: valueColor, fontSize: 13, fontWeight: '700' }}>{fmtFull(value)}</Text>
      </View>
      <View style={{ height: 10, backgroundColor: C.cardBorder, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
        <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: valueColor, borderRadius: 5 }} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {thresholds.map((t, i) => {
          const tPct = (t.level / maxLevel) * 100;
          return (
            <View key={i} style={{ position: 'absolute', left: `${tPct}%` as any }}>
              <View style={{ width: 1, height: 6, backgroundColor: t.color, marginBottom: 2 }} />
              <Text style={{ color: t.color, fontSize: 8 }}>{t.label}</Text>
            </View>
          );
        })}
      </View>
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

  pageTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 2 },
  pageSub: { fontSize: 14, color: C.textSecondary, marginBottom: 20, textTransform: 'capitalize' },

  /* KPI */
  kpiCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minWidth: 150,
  },
  kpiLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '500' },
  kpiValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  kpiSub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },

  /* Sections */
  section: { marginTop: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  sectionSub: { fontSize: 12, color: C.textSecondary, marginTop: 2, marginBottom: 12 },

  chartCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    padding: 16,
    overflow: 'hidden',
  },

  emptyChart: { color: C.textSecondary, textAlign: 'center', padding: 30, fontSize: 13 },

  /* Legend */
  legendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, maxWidth: 160 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, color: C.text, flexShrink: 1 },
  legendPct: { fontSize: 11, color: C.textSecondary, fontWeight: '600' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 12 },
  legendInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSmall: { fontSize: 11, color: C.textSecondary },

  /* Sub-section */
  subSectionTitle: { fontSize: 14, color: C.text, fontWeight: '600', marginBottom: 14 },
  globalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    paddingTop: 10,
    marginTop: 4,
  },
  globalLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  globalValue: { fontSize: 15, fontWeight: '800' },

  /* Health */
  healthRow: { flexDirection: 'row' },
  healthItem: { flex: 1, alignItems: 'center' },
  healthDivider: { width: 1, backgroundColor: C.cardBorder, marginHorizontal: 12 },
  healthLabel: { fontSize: 12, color: C.textSecondary, marginBottom: 4 },
  healthValue: { fontSize: 20, fontWeight: '800' },
  healthHint: { fontSize: 11, color: C.textSecondary, marginTop: 2 },

  /* Table */
  tableCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: C.cardBorder,
  },
  tableHeaderCell: { fontSize: 11, color: C.textSecondary, fontWeight: '700', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 14 },
  tableRowAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  tableCell: { fontSize: 13, color: C.text },
});
}
