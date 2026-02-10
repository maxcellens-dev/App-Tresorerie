import { View, Text, StyleSheet, ScrollView, RefreshControl, Dimensions, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Rect, Text as SvgText, Line, Circle, Path, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTransactions } from '../hooks/useTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { usePilotageData } from '../hooks/usePilotageData';
import { ACCOUNT_COLORS, SEMANTIC, accountColor } from '../theme/colors';

/* ── Constants ── */
const C = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
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

const CHART_PALETTE = [C.emerald, C.rose, C.violet, C.sky, C.amber, C.orange, C.pink, C.teal, C.lime, C.cyan, C.indigo];

const fmt = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return n.toFixed(0);
};

const fmtFull = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';

/* ── Animated fade-in wrapper ── */
function FadeIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
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

/* ── Summary KPI Card ── */
function KpiCard({ icon, label, value, color, sub }: { icon: string; label: string; value: string; color: string; sub?: string }) {
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

/* ── Bar Chart (Income vs Expenses, last 6 months) ── */
function BarChart({ data, width }: { data: { label: string; income: number; expense: number }[]; width: number }) {
  const chartW = width - 52;
  const chartH = 170;
  const barGroupW = chartW / data.length;
  const barW = barGroupW * 0.3;
  const gap = 4;
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);

  return (
    <Svg width={width} height={chartH + 36}>
      {/* Grid lines */}
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
      {/* Bars */}
      {data.map((d, i) => {
        const x = 48 + i * barGroupW + (barGroupW - barW * 2 - gap) / 2;
        const incomeH = (d.income / maxVal) * chartH;
        const expenseH = (d.expense / maxVal) * chartH;
        return (
          <G key={i}>
            <Defs>
              <LinearGradient id={`gi${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.emerald} stopOpacity="0.9" />
                <Stop offset="1" stopColor={C.emeraldDark} stopOpacity="0.6" />
              </LinearGradient>
              <LinearGradient id={`ge${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.rose} stopOpacity="0.9" />
                <Stop offset="1" stopColor={C.roseDark} stopOpacity="0.6" />
              </LinearGradient>
            </Defs>
            <Rect x={x} y={chartH - incomeH} width={barW} height={incomeH} rx={3} fill={`url(#gi${i})`} />
            <Rect x={x + barW + gap} y={chartH - expenseH} width={barW} height={expenseH} rx={3} fill={`url(#ge${i})`} />
            <SvgText x={x + barW + gap / 2} y={chartH + 14} fill={C.textSecondary} fontSize={10} textAnchor="middle">
              {d.label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

/* ── Donut Chart ── */
function DonutChart({ slices, size }: { slices: { label: string; value: number; color: string }[]; size: number }) {
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (total === 0) return <Text style={{ color: C.textSecondary, textAlign: 'center', padding: 20 }}>Aucune donnée</Text>;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;
  const innerR = r * 0.55;
  let cumAngle = -90;

  const arcs = slices.filter(s => s.value > 0).map((sl) => {
    const angle = (sl.value / total) * 360;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > 180 ? 1 : 0;
    const rad = (a: number) => (a * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad(startAngle));
    const y1 = cy + r * Math.sin(rad(startAngle));
    const x2 = cx + r * Math.cos(rad(endAngle));
    const y2 = cy + r * Math.sin(rad(endAngle));
    const ix1 = cx + innerR * Math.cos(rad(startAngle));
    const iy1 = cy + innerR * Math.sin(rad(startAngle));
    const ix2 = cx + innerR * Math.cos(rad(endAngle));
    const iy2 = cy + innerR * Math.sin(rad(endAngle));
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
    return { ...sl, d, pct: ((sl.value / total) * 100).toFixed(1) };
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {arcs.map((arc, i) => (
          <Path key={i} d={arc.d} fill={arc.color} />
        ))}
        <SvgText x={cx} y={cy - 4} fill={C.text} fontSize={16} fontWeight="bold" textAnchor="middle">
          {fmtFull(total)}
        </SvgText>
        <SvgText x={cx} y={cy + 14} fill={C.textSecondary} fontSize={10} textAnchor="middle">
          Total dépenses
        </SvgText>
      </Svg>
      <View style={s.legendWrap}>
        {arcs.map((arc, i) => (
          <View key={i} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: arc.color }]} />
            <Text style={s.legendLabel} numberOfLines={1}>{arc.label}</Text>
            <Text style={s.legendPct}>{arc.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Sparkline / area line chart ── */
function AreaLineChart({ points, width, color }: { points: { label: string; value: number }[]; width: number; color: string }) {
  const chartH = 120;
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
    <Svg width={width} height={chartH + 28}>
      <Defs>
        <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.3" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {/* Grid */}
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
      <Path d={areaPath} fill="url(#areaGrad)" />
      <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {coords.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={3.5} fill={C.card} stroke={color} strokeWidth={2} />
      ))}
      {points.map((p, i) => (
        <SvgText key={i} x={coords[i].x} y={chartH + 14} fill={C.textSecondary} fontSize={9} textAnchor="middle">{p.label}</SvgText>
      ))}
    </Svg>
  );
}

/* ── Horizontal progress bar ── */
function ProgressRow({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>{label}</Text>
        <Text style={{ color: C.textSecondary, fontSize: 12 }}>{fmtFull(current)} / {fmtFull(target)}</Text>
      </View>
      <View style={{ height: 7, backgroundColor: C.cardBorder, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color, fontSize: 11, marginTop: 2, textAlign: 'right' }}>{pct.toFixed(0)}%</Text>
    </View>
  );
}

/* ═══════════════════  MAIN SCREEN  ═══════════════════ */
export default function ReportingScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const { width: screenW } = useWindowDimensions();
  const chartWidth = Math.min(screenW - 48, 500);

  const { data: transactions, refetch: rTx } = useTransactions(user?.id);
  const { data: accounts, refetch: rAcc } = useAccounts(user?.id);
  const { data: categories } = useCategories(user?.id);
  const { data: pilotage, refetch: rPil } = usePilotageData(user?.id);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([rTx(), rAcc(), rPil()]);
    setRefreshing(false);
  };

  /* ── Monthly income / expense for last 6 months ── */
  const monthlyIO = useMemo(() => {
    if (!transactions) return [];
    const now = new Date();
    const months: { year: number; month: number; label: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        income: 0,
        expense: 0,
      });
    }
    for (const t of transactions) {
      const [y, m] = t.date.split('-').map(Number);
      const bucket = months.find(b => b.year === y && b.month === m);
      if (!bucket) continue;
      if (Number(t.amount) >= 0) bucket.income += Number(t.amount);
      else bucket.expense += Math.abs(Number(t.amount));
    }
    return months;
  }, [transactions]);

  /* ── Category-wise expense breakdown (current month) ── */
  const categorySlices = useMemo(() => {
    if (!transactions || !categories) return [];
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    const catMap: Record<string, { name: string; total: number }> = {};
    for (const t of transactions) {
      if (Number(t.amount) >= 0) continue;
      const [y, m] = t.date.split('-').map(Number);
      if (y !== cy || m !== cm) continue;
      const catName = t.category?.name ?? 'Sans catégorie';
      if (!catMap[catName]) catMap[catName] = { name: catName, total: 0 };
      catMap[catName].total += Math.abs(Number(t.amount));
    }
    return Object.values(catMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((c, i) => ({ label: c.name, value: c.total, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
  }, [transactions, categories]);

  /* ── Patrimoine evolution (monthly closing balance, 6 months) ── */
  const patrimoinePoints = useMemo(() => {
    if (!accounts || !transactions) return [];
    const now = new Date();
    const totalNow = accounts.reduce((s, a) => s + Number(a.balance), 0);
    const months: { label: string; yearMonth: string; delta: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        delta: 0,
      });
    }
    // Sum all transaction deltas per month
    for (const t of transactions) {
      const ym = t.date.substring(0, 7);
      const bucket = months.find(m => m.yearMonth === ym);
      if (bucket) bucket.delta += Number(t.amount);
    }
    // Reconstruct approx. balances going backwards from current
    const points: { label: string; value: number }[] = [];
    let runningBalance = totalNow;
    for (let i = months.length - 1; i >= 0; i--) {
      points.unshift({ label: months[i].label, value: runningBalance });
      runningBalance -= months[i].delta;
    }
    return points;
  }, [accounts, transactions]);

  /* ── Savings evolution (just savings+investment accounts) ── */
  const savingsPoints = useMemo(() => {
    if (!accounts || !transactions) return [];
    const now = new Date();
    const savingsIds = new Set(accounts.filter(a => a.type === 'savings' || a.type === 'investment').map(a => a.id));
    const savingsNow = accounts.filter(a => savingsIds.has(a.id)).reduce((s, a) => s + Number(a.balance), 0);
    const months: { label: string; yearMonth: string; delta: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        delta: 0,
      });
    }
    for (const t of transactions) {
      if (!savingsIds.has(t.account_id)) continue;
      const ym = t.date.substring(0, 7);
      const bucket = months.find(m => m.yearMonth === ym);
      if (bucket) bucket.delta += Number(t.amount);
    }
    const points: { label: string; value: number }[] = [];
    let running = savingsNow;
    for (let i = months.length - 1; i >= 0; i--) {
      points.unshift({ label: months[i].label, value: running });
      running -= months[i].delta;
    }
    return points;
  }, [accounts, transactions]);

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
        <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={48} color={C.textSecondary} />
            <Text style={{ color: C.textSecondary, marginTop: 12, fontSize: 15 }}>Connectez-vous pour accéder au reporting.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const currentMonthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.emerald} progressBackgroundColor={C.card} />}
        >
          {/* ═══ HEADER ═══ */}
          <FadeIn>
            <Text style={s.pageTitle}>Reporting</Text>
            <Text style={s.pageSub}>{currentMonthLabel.charAt(0).toUpperCase() + currentMonthLabel.slice(1)}</Text>
          </FadeIn>

          {/* ═══ KPI CARDS ═══ */}
          <FadeIn delay={80}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
              <KpiCard icon="wallet-outline" label="Patrimoine total" value={fmtFull(patrimoine)} color={ACCOUNT_COLORS.checking} />
              <KpiCard icon="trending-up-outline" label="Revenus du mois" value={fmtFull(totalIncome)} color={ACCOUNT_COLORS.savings} />
              <KpiCard icon="trending-down-outline" label="Dépenses du mois" value={fmtFull(totalExpense)} color={C.rose} />
              {pilotage ? (
                <KpiCard icon="shield-checkmark-outline" label="À dépenser" value={fmtFull(pilotage.safe_to_spend)} color={SEMANTIC.variableExpense} sub="en sécurité" />
              ) : null}
            </ScrollView>
          </FadeIn>

          {/* ═══ REVENUS vs DÉPENSES ═══ */}
          <FadeIn delay={160}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="bar-chart-outline" size={20} color={C.emerald} />
                <Text style={s.sectionTitle}>Revenus vs Dépenses</Text>
              </View>
              <Text style={s.sectionSub}>6 derniers mois</Text>
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

          {/* ═══ CATÉGORIES (Donut) ═══ */}
          <FadeIn delay={240}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="pie-chart-outline" size={20} color={C.violet} />
                <Text style={s.sectionTitle}>Répartition des dépenses</Text>
              </View>
              <Text style={s.sectionSub}>Mois en cours par catégorie</Text>
              <View style={s.chartCard}>
                <DonutChart slices={categorySlices} size={Math.min(chartWidth, 260)} />
              </View>
            </View>
          </FadeIn>

          {/* ═══ PATRIMOINE EVOLUTION ═══ */}
          <FadeIn delay={320}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="analytics-outline" size={20} color={ACCOUNT_COLORS.checking} />
                <Text style={s.sectionTitle}>Évolution du patrimoine</Text>
              </View>
              <Text style={s.sectionSub}>Solde total estimé, 6 mois</Text>
              <View style={s.chartCard}>
                <AreaLineChart points={patrimoinePoints} width={chartWidth} color={ACCOUNT_COLORS.checking} />
              </View>
            </View>
          </FadeIn>

          {/* ═══ ÉPARGNE EVOLUTION ═══ */}
          <FadeIn delay={400}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="leaf-outline" size={20} color={ACCOUNT_COLORS.savings} />
                <Text style={s.sectionTitle}>Évolution de l'épargne</Text>
              </View>
              <Text style={s.sectionSub}>Comptes épargne & investissement</Text>
              <View style={s.chartCard}>
                <AreaLineChart points={savingsPoints} width={chartWidth} color={ACCOUNT_COLORS.savings} />
              </View>
            </View>
          </FadeIn>

          {/* ═══ PROJETS & OBJECTIFS ═══ */}
          {pilotage && (pilotage.projects_with_progress.length > 0 || pilotage.objectives_with_progress.length > 0) ? (
            <FadeIn delay={480}>
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <Ionicons name="rocket-outline" size={20} color={C.amber} />
                  <Text style={s.sectionTitle}>Projets & Objectifs</Text>
                </View>

                {pilotage.projects_with_progress.length > 0 ? (
                  <View style={s.chartCard}>
                    <Text style={s.subSectionTitle}>Projets</Text>
                    {pilotage.projects_with_progress.map((p) => (
                      <ProgressRow key={p.id} label={p.name} current={(p.progress_percentage / 100) * p.target_amount} target={p.target_amount} color={SEMANTIC.project} />
                    ))}
                    <View style={s.globalRow}>
                      <Text style={s.globalLabel}>Avancement global</Text>
                      <Text style={[s.globalValue, { color: SEMANTIC.project }]}>{pilotage.global_projects_percentage.toFixed(0)}%</Text>
                    </View>
                  </View>
                ) : null}

                {pilotage.objectives_with_progress.length > 0 ? (
                  <View style={[s.chartCard, { marginTop: 12 }]}>
                    <Text style={s.subSectionTitle}>Objectifs annuels</Text>
                    {pilotage.objectives_with_progress.map((o) => (
                      <ProgressRow key={o.id} label={o.name} current={o.current_year_invested} target={o.target_yearly_amount} color={accountColor(o.account_type ?? 'savings')} />
                    ))}
                    <View style={s.globalRow}>
                      <Text style={s.globalLabel}>Avancement global</Text>
                      <Text style={[s.globalValue, { color: ACCOUNT_COLORS.savings }]}>{pilotage.global_objectives_percentage.toFixed(0)}%</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </FadeIn>
          ) : null}

          {/* ═══ INDICATEURS DE SANTÉ ═══ */}
          {pilotage ? (
            <FadeIn delay={560}>
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <Ionicons name="pulse-outline" size={20} color={C.teal} />
                  <Text style={s.sectionTitle}>Santé financière</Text>
                </View>
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

          {/* ═══ TABLEAU MENSUEL ═══ */}
          <FadeIn delay={640}>
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="grid-outline" size={20} color={C.indigo} />
                <Text style={s.sectionTitle}>Récapitulatif mensuel</Text>
              </View>
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
const s = StyleSheet.create({
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
