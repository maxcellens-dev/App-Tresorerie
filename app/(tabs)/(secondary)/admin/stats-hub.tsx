/**
 * Stats Hub — tableau de bord d'usage de l'app (admin).
 * Agrège les évènements analytics_events : utilisateurs actifs (DAU/WAU/MAU), sessions,
 * vues de pages, répartition par heure / jour de semaine, plateformes, activité quotidienne.
 * Les données sont agrégées côté client sur une période sélectionnable (7 / 30 / 90 jours).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { supabase } from '../../../lib/supabase';
import { useAppColors } from '../../../hooks/useAppColors';

interface RawEvent { profile_id: string | null; event: string; screen: string | null; platform: string | null; session_id: string | null; created_at: string }

const PERIODS = [
  { days: 7, label: '7 j' },
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
];
const DAY_MS = 86400000;
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function prettyScreen(s: string | null): string {
  if (!s || s === '/') return 'Accueil';
  const clean = s.replace(/^\//, '').replace(/\/index$/, '').replace(/\/$/, '');
  return clean || 'Accueil';
}

export default function StatsHub() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [counts, setCounts] = useState<{ users: number; accounts: number; transactions: number; newUsers: number }>({ users: 0, accounts: 0, transactions: 0, newUsers: 0 });
  const [updatedAt, setUpdatedAt] = useState<string>('');

  useEffect(() => { if (isAdmin) loadStats(days); /* eslint-disable-next-line */ }, [isAdmin, days]);

  async function loadStats(periodDays: number) {
    if (!supabase) { setMessage('Supabase non configuré'); setLoading(false); return; }
    setLoading(true); setMessage(null);
    const since = new Date(Date.now() - periodDays * DAY_MS).toISOString();
    try {
      const [usersRes, accountsRes, txRes, newUsersRes] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('accounts').select('*', { count: 'exact', head: true }),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', since),
      ]);
      setCounts({
        users: usersRes.count ?? 0,
        accounts: accountsRes.count ?? 0,
        transactions: txRes.count ?? 0,
        newUsers: newUsersRes.count ?? 0,
      });

      const { data, error } = await supabase
        .from('analytics_events')
        .select('profile_id, event, screen, platform, session_id, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50000);
      if (error) {
        // Table absente → migration non appliquée.
        if ((error.message || '').toLowerCase().includes('analytics_events')) {
          setMessage("Table analytics_events introuvable — appliquez la migration 055_analytics.sql.");
        } else {
          setMessage(error.message);
        }
        setEvents([]);
      } else {
        setEvents((data ?? []) as RawEvent[]);
      }
      setUpdatedAt(new Date().toLocaleString('fr-FR'));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }

  const agg = useMemo(() => computeAggregates(events, days), [events, days]);

  if (!isAdmin) {
    return (
      <View style={styles.root}><StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/(secondary)/admin' as any)}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Stats Hub</Text>
              <Text style={styles.subtitle}>Usage de l'app sur {days} jours{updatedAt ? ` · maj ${updatedAt}` : ''}.</Text>
            </View>
            <TouchableOpacity style={styles.refreshIcon} onPress={() => loadStats(days)}>
              <Ionicons name="refresh" size={18} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {/* Sélecteur de période */}
          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <TouchableOpacity key={p.days} style={[styles.periodChip, days === p.days && styles.periodChipActive]} onPress={() => setDays(p.days)} activeOpacity={0.85}>
                <Text style={[styles.periodText, days === p.days && styles.periodTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={{ marginTop: 40 }} />
          ) : (
            <>
              {/* KPIs principaux */}
              <View style={styles.kpiGrid}>
                <Kpi icon="people" color={COLORS.emerald} value={counts.users} label="Utilisateurs" styles={styles} />
                <Kpi icon="person-add" color="#22c55e" value={`+${counts.newUsers}`} label="Nouveaux" styles={styles} />
                <Kpi icon="today" color="#60a5fa" value={agg.dau} label="Actifs (24 h)" styles={styles} />
                <Kpi icon="calendar" color="#a78bfa" value={agg.wau} label="Actifs (7 j)" styles={styles} />
                <Kpi icon="calendar-outline" color="#f59e0b" value={agg.mau} label="Actifs (30 j)" styles={styles} />
                <Kpi icon="enter" color="#ec4899" value={agg.sessions} label="Sessions" styles={styles} />
                <Kpi icon="eye" color="#0ea5a8" value={agg.screenViews} label="Vues de page" styles={styles} />
                <Kpi icon="repeat" color="#f97316" value={agg.avgSessions} label="Sessions / actif" styles={styles} />
              </View>

              {/* Activité quotidienne (utilisateurs actifs / jour) */}
              <Section title="Activité quotidienne" hint="Utilisateurs actifs par jour" styles={styles}>
                <VBars data={agg.daily.map((d, i) => ({ value: d.users, label: i % Math.max(1, Math.ceil(days / 8)) === 0 ? d.short : '' }))} color={COLORS.emerald} styles={styles} c={COLORS} maxLabels={999} />
              </Section>

              {/* Pages les plus vues */}
              <Section title="Pages les plus vues" hint="Vues · visiteurs uniques" styles={styles}>
                {agg.topScreens.length === 0 ? <Empty styles={styles} /> : agg.topScreens.slice(0, 12).map((s) => (
                  <HBar key={s.screen} label={prettyScreen(s.screen)} value={s.views} sub={`${s.users} util.`} max={agg.maxScreenViews} color={COLORS.blue} styles={styles} c={COLORS} />
                ))}
              </Section>

              {/* Répartition par heure */}
              <Section title="Activité par heure" hint="Évènements selon l'heure (locale)" styles={styles}>
                <VBars data={agg.byHour.map((v, h) => ({ value: v, label: h % 6 === 0 ? `${h}h` : '' }))} color="#a78bfa" styles={styles} c={COLORS} maxLabels={999} />
              </Section>

              {/* Répartition par jour de semaine */}
              <Section title="Activité par jour de semaine" styles={styles}>
                <VBars data={agg.byWeekday.map((v, i) => ({ value: v, label: WEEKDAYS[i] }))} color="#f59e0b" styles={styles} c={COLORS} maxLabels={999} />
              </Section>

              {/* Types d'évènements */}
              <Section title="Types d'évènements" styles={styles}>
                {agg.eventsByType.length === 0 ? <Empty styles={styles} /> : agg.eventsByType.map((e) => (
                  <HBar key={e.type} label={e.type} value={e.count} max={agg.maxEventType} color={COLORS.emerald} styles={styles} c={COLORS} />
                ))}
              </Section>

              {/* Plateformes */}
              <Section title="Plateformes" hint="Utilisateurs uniques" styles={styles}>
                {agg.platforms.length === 0 ? <Empty styles={styles} /> : agg.platforms.map((p) => (
                  <HBar key={p.name} label={p.name} value={p.users} max={agg.maxPlatform} color="#0ea5a8" styles={styles} c={COLORS} />
                ))}
              </Section>

              {/* Données de référence */}
              <Section title="Données" styles={styles}>
                <RefRow label="Comptes créés (total)" value={counts.accounts} styles={styles} />
                <RefRow label="Transactions (total)" value={counts.transactions} styles={styles} />
                <RefRow label="Évènements (période)" value={agg.totalEvents} styles={styles} />
                <RefRow label="Ouvertures d'app (période)" value={agg.appOpens} styles={styles} />
              </Section>

              {message && <Text style={styles.error}>{message}</Text>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Agrégation ───────────────────────────────────────────────────────────────
function computeAggregates(events: RawEvent[], days: number) {
  const now = Date.now();
  const time = (e: RawEvent) => new Date(e.created_at).getTime();
  const inLast = (ms: number) => events.filter((e) => time(e) >= now - ms);
  const distinct = (arr: RawEvent[], key: keyof RawEvent) => new Set(arr.map((x) => x[key]).filter(Boolean)).size;

  const dau = distinct(inLast(DAY_MS), 'profile_id');
  const wau = distinct(inLast(7 * DAY_MS), 'profile_id');
  const mau = distinct(inLast(30 * DAY_MS), 'profile_id');
  const activeUsers = distinct(events, 'profile_id');
  const sessions = distinct(events, 'session_id');
  const screenViewEvents = events.filter((e) => e.event === 'screen_view');
  const appOpens = events.filter((e) => e.event === 'app_open').length;
  const avgSessions = activeUsers ? (sessions / activeUsers).toFixed(1) : '0';

  // Pages
  const screenMap: Record<string, { views: number; users: Set<string> }> = {};
  screenViewEvents.forEach((e) => {
    const s = e.screen || '—';
    (screenMap[s] ??= { views: 0, users: new Set() });
    screenMap[s].views++;
    if (e.profile_id) screenMap[s].users.add(e.profile_id);
  });
  const topScreens = Object.entries(screenMap)
    .map(([screen, v]) => ({ screen, views: v.views, users: v.users.size }))
    .sort((a, b) => b.views - a.views);
  const maxScreenViews = Math.max(1, ...topScreens.map((s) => s.views));

  // Types d'évènements
  const typeMap: Record<string, number> = {};
  events.forEach((e) => { typeMap[e.event] = (typeMap[e.event] || 0) + 1; });
  const eventsByType = Object.entries(typeMap).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  const maxEventType = Math.max(1, ...eventsByType.map((e) => e.count));

  // Par heure (0-23) / jour de semaine (Lun-Dim)
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  events.forEach((e) => {
    const d = new Date(e.created_at);
    byHour[d.getHours()]++;
    byWeekday[(d.getDay() + 6) % 7]++;
  });

  // Activité quotidienne (N derniers jours)
  const dailyMap: Record<string, { users: Set<string>; events: number; sessions: Set<string> }> = {};
  events.forEach((e) => {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    (dailyMap[key] ??= { users: new Set(), events: 0, sessions: new Set() });
    if (e.profile_id) dailyMap[key].users.add(e.profile_id);
    if (e.session_id) dailyMap[key].sessions.add(e.session_id);
    dailyMap[key].events++;
  });
  const daily: { date: string; short: string; users: number; events: number; sessions: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = dailyMap[key];
    daily.push({ date: key, short: `${d.getDate()}/${d.getMonth() + 1}`, users: v?.users.size ?? 0, events: v?.events ?? 0, sessions: v?.sessions.size ?? 0 });
  }

  // Plateformes (utilisateurs uniques)
  const platMap: Record<string, Set<string>> = {};
  events.forEach((e) => {
    const p = e.platform || 'inconnu';
    (platMap[p] ??= new Set());
    if (e.profile_id) platMap[p].add(e.profile_id);
  });
  const platforms = Object.entries(platMap).map(([name, set]) => ({ name, users: set.size })).sort((a, b) => b.users - a.users);
  const maxPlatform = Math.max(1, ...platforms.map((p) => p.users));

  return {
    dau, wau, mau, sessions, screenViews: screenViewEvents.length, avgSessions, appOpens,
    totalEvents: events.length, topScreens, maxScreenViews, eventsByType, maxEventType,
    byHour, byWeekday, daily, platforms, maxPlatform,
  };
}

// ── Sous-composants ──────────────────────────────────────────────────────────
function Kpi({ icon, color, value, label, styles }: any) {
  return (
    <View style={styles.kpiCard}>
      <Ionicons name={icon} size={20} color={color} style={{ marginBottom: 6 }} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, hint, children, styles }: any) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

function HBar({ label, value, sub, max, color, styles, c }: any) {
  const pct = Math.max(0.02, value / max);
  return (
    <View style={styles.hbarRow}>
      <View style={styles.hbarHead}>
        <Text style={styles.hbarLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.hbarValue}>{value}{sub ? <Text style={styles.hbarSub}>  ·  {sub}</Text> : null}</Text>
      </View>
      <View style={[styles.hbarTrack, { backgroundColor: c.cardBorder }]}>
        <View style={[styles.hbarFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function VBars({ data, color, styles, c, maxLabels }: any) {
  const max = Math.max(1, ...data.map((d: any) => d.value));
  return (
    <View>
      <View style={styles.vbarsRow}>
        {data.map((d: any, i: number) => (
          <View key={i} style={styles.vbarCol}>
            <View style={styles.vbarTrack}>
              <View style={[styles.vbarFill, { height: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: d.value > 0 ? color : c.cardBorder }]} />
            </View>
            {maxLabels > 0 && d.label ? <Text style={styles.vbarLabel} numberOfLines={1}>{d.label}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function RefRow({ label, value, styles }: any) {
  return (
    <View style={styles.refRow}>
      <Text style={styles.refLabel}>{label}</Text>
      <Text style={styles.refValue}>{value}</Text>
    </View>
  );
}

function Empty({ styles }: any) {
  return <Text style={styles.empty}>Aucune donnée sur cette période.</Text>;
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 100 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    title: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 4 },
    subtitle: { fontSize: 12, color: c.textSecondary, marginBottom: 14, lineHeight: 16 },
    refreshIcon: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    periodChip: { flex: 1, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    periodChipActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    periodText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    periodTextActive: { color: c.emerald },
    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    kpiCard: { flexGrow: 1, flexBasis: '22%', minWidth: 78, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
    kpiValue: { fontSize: 19, fontWeight: '800', color: c.text },
    kpiLabel: { fontSize: 10.5, color: c.textSecondary, fontWeight: '600', textAlign: 'center', marginTop: 2 },
    section: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginTop: 12 },
    sectionTitle: { fontSize: 15, fontWeight: '800', color: c.text },
    sectionHint: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    hbarRow: { marginBottom: 12 },
    hbarHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
    hbarLabel: { fontSize: 13, fontWeight: '600', color: c.text, flex: 1, marginRight: 8 },
    hbarValue: { fontSize: 13, fontWeight: '800', color: c.text },
    hbarSub: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
    hbarTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
    hbarFill: { height: '100%', borderRadius: 4 },
    vbarsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 110 },
    vbarCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    vbarTrack: { width: '100%', flex: 1, justifyContent: 'flex-end' },
    vbarFill: { width: '100%', borderRadius: 3, minHeight: 2 },
    vbarLabel: { fontSize: 8.5, color: c.textSecondary, marginTop: 4 },
    refRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    refLabel: { fontSize: 13, color: c.textSecondary },
    refValue: { fontSize: 14, fontWeight: '800', color: c.text },
    empty: { fontSize: 12, color: c.textSecondary, fontStyle: 'italic' },
    error: { marginTop: 14, fontSize: 13, color: c.danger, textAlign: 'center' },
    text: { color: c.text },
  });
}
