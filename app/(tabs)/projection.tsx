import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  useWindowDimensions, Platform, findNodeHandle,
} from 'react-native';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../components/ScreenGradient';
import OnboardingHintBanner from '../components/OnboardingHintBanner';
import { useUpdateOnboarding } from '../hooks/useOnboarding';
import GuideOverlay, { type BubbleStep } from '../components/GuideOverlay';
import { useScreenGuide } from '../hooks/useScreenGuide';
import { tabRect } from '../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../lib/onbHighlight';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from '../hooks/usePilotageData';
import { useTransactions } from '../hooks/useTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { useQuestionnaireAnswers } from '../hooks/useFinancialProfile';
import { useAppColors } from '../hooks/useAppColors';
import { useFiscalEnvelopeRates, taxRateFor, noteFor } from '../hooks/useFiscalEnvelopes';
import {
  projectInvestment, sumProjections, projectSavings, investCurve,
  estimateMonthlySavings, incomeFromQ3, savingsRateFromQ6,
  type InvestYearRow,
} from '../lib/projectionEngine';

import { semanticText } from '../theme/palette';

const INVEST_COLOR = '#a78bfa';
const SAVINGS_COLOR = '#34d399';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
const fmtK = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.0', '')}k`;
  return Math.round(n).toString();
};

// ── Persistance locale des hypothèses ─────────────────────────
const storageKey = (uid?: string) => `projection_hypos_${uid ?? 'anon'}`;
function loadHypos(uid?: string): any | null {
  try { const r = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey(uid)) : null; return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveHypos(uid: string | undefined, data: any) {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(uid), JSON.stringify(data)); } catch {}
}

interface AccountHypo { contributed: string; annual: string; rate: string; tax: string; contributedBase?: number }

/* ── Graphique aire (valeur) + ligne (capital), 3 valeurs affichées ── */
function GrowthChart({ points, width, color }: {
  points: { label: string; value: number; contributed: number }[];
  width: number;
  color: string;
}) {
  const c = useAppColors();
  const h = 200;
  const padL = 44, padR = 16, padT = 26, padB = 24;
  const usableW = width - padL - padR;
  const usableH = h - padT - padB;
  if (points.length < 2) return null;

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
        <LinearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
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
      <Path d={area} fill="url(#growthGrad)" />
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

/* ── Champ numérique compact ── */
function NumField({ label, value, onChange, suffix, colors, flex = 1 }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string; colors: any; flex?: number;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={[styles.field, { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholderTextColor={colors.textSecondary}
        />
        {suffix ? <Text style={styles.fieldSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export default function ProjectionScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const onbHypo = useOnbHighlight('projection_edited');
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const { data: allAccounts = [] } = useAccounts(user?.id);
  const { data: fiscalRates = [] } = useFiscalEnvelopeRates();

  const chartWidth = Math.min(width - 48, 560);
  const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(/,/g, '.')) || 0;

  // ── Guide de présentation (bulles) ──
  const guide = useScreenGuide('projection', user?.id);
  const scrollRef = React.useRef<ScrollView>(null);
  const tabsRef = React.useRef<View>(null);
  const chartRef = React.useRef<View>(null);
  const hypoRef = React.useRef<View>(null);

  // Scroll vers la zone « Hypothèses » mise en évidence par le guide « Pour bien démarrer ».
  React.useEffect(() => {
    if (!onbHypo) return;
    const t = setTimeout(() => {
      const node = scrollRef.current ? findNodeHandle(scrollRef.current) : null;
      if (node && hypoRef.current?.measureLayout) {
        hypoRef.current.measureLayout(node, (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
        }, () => {});
      }
    }, 350);
    return () => clearTimeout(t);
  }, [onbHypo]);

  const PROJECTION_GUIDE: BubbleStep[] = [
    { getRect: () => tabRect(4), icon: 'trending-up', iconColor: '#a78bfa', title: 'Onglet Projection', description: 'Touchez « Projection » dans la barre du bas pour projeter votre patrimoine.' },
    { getRef: () => tabsRef, icon: 'swap-horizontal-outline', iconColor: '#a78bfa', title: 'Investissement & Épargne', description: 'Basculez entre la projection de vos investissements et celle de votre épargne.' },
    { getRef: () => hypoRef, icon: 'options-outline', iconColor: '#34d399', title: 'Vos hypothèses', description: 'Ajustez apports, rendement, fiscalité et durée : la projection se recalcule en direct.' },
  ];

  const [activeTab, setActiveTab] = useState<'invest' | 'epargne'>('invest');

  // ── Comptes d'investissement (simulation libre si aucun, toujours au moins un) ──
  const investAccounts = useMemo(() => {
    const list = allAccounts.filter((a: any) => a.type === 'investment');
    if (list.length > 0) return list.map((a: any) => ({ id: a.id, name: a.name, balance: Number(a.balance), envelope: a.fiscal_envelope ?? 'autre', currentContributed: a.current_contributed != null ? Number(a.current_contributed) : null }));
    return [{ id: 'manual', name: 'Simulation libre', balance: 0, envelope: 'autre', currentContributed: null as number | null }];
  }, [allAccounts]);

  // Apport repris dans l'hypothèse = « apport actuel » du compte (suivi : apports + virements − retraits au prorata).
  // À défaut (non renseigné), on retombe sur la valeur du compte.
  const autoContributedFor = React.useCallback((acc: { balance: number; currentContributed: number | null }) => {
    return acc.currentContributed != null ? acc.currentContributed : acc.balance;
  }, []);

  // ── État : hypothèses par compte + durée globale ──
  const [hypos, setHypos] = useState<Record<string, AccountHypo>>({});
  const [years, setYears] = useState(20);
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // Charger depuis le stockage + pré-remplir les comptes manquants
  useEffect(() => {
    if (loaded || investAccounts.length === 0 || fiscalRates.length === 0) return;
    const saved = loadHypos(user?.id);
    const initialHypos: Record<string, AccountHypo> = saved?.hypos ?? {};
    for (const acc of investAccounts) {
      if (!initialHypos[acc.id]) {
        const auto = autoContributedFor(acc);
        initialHypos[acc.id] = {
          contributed: String(Math.round(auto)),
          contributedBase: auto,
          annual: '2400',
          rate: '7',
          tax: String(taxRateFor(fiscalRates, acc.envelope)),
        };
      }
    }
    setHypos(initialHypos);
    if (saved?.years) setYears(saved.years);
    setSelectedAccId(investAccounts[0].id);
    setLoaded(true);
  }, [investAccounts, loaded, user?.id, fiscalRates]);

  // Sauvegarder à chaque changement
  useEffect(() => {
    if (loaded) saveHypos(user?.id, { hypos, years });
  }, [hypos, years, loaded, user?.id]);

  // Initialise automatiquement l'hypothèse des comptes d'invest qui n'en ont pas encore
  // (ex. comptes créés après le 1er chargement) → le bloc s'affiche sans devoir « actualiser ».
  useEffect(() => {
    if (!loaded || fiscalRates.length === 0) return;
    setHypos((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const acc of investAccounts) {
        if (!next[acc.id]) {
          const auto = autoContributedFor(acc);
          next[acc.id] = { contributed: String(Math.round(auto)), contributedBase: auto, annual: '2400', rate: '7', tax: String(taxRateFor(fiscalRates, acc.envelope)) };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    if (!selectedAccId && investAccounts[0]) setSelectedAccId(investAccounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, investAccounts, fiscalRates]);

  // Accumulation auto : tout nouvel apport/virement s'ajoute à l'« Apport existant » courant
  // (uniquement pour les comptes avec un total apporté défini à la création). La valeur saisie
  // par l'utilisateur est conservée : seul le delta des nouveaux apports vient s'y ajouter.
  useEffect(() => {
    if (!loaded) return;
    setHypos((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const acc of investAccounts) {
        if (acc.currentContributed == null || !next[acc.id]) continue;
        const auto = autoContributedFor(acc);
        const base = next[acc.id].contributedBase ?? auto;
        const delta = auto - base;
        // Les apports/virements augmentent l'apport, les retraits le diminuent (prorata) → on suit dans les 2 sens.
        if (Math.abs(delta) > 0.5) {
          next[acc.id] = {
            ...next[acc.id],
            contributed: String(Math.round(num(next[acc.id].contributed) + delta)),
            contributedBase: auto,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, investAccounts, autoContributedFor]);

  const updateOnboarding = useUpdateOnboarding(user?.id);
  const projEditedRef = React.useRef(false);
  const markProjectionEdited = () => {
    if (projEditedRef.current) return;
    projEditedRef.current = true;
    updateOnboarding.mutate({ flags: { projection_edited: true } });
  };

  const updateHypo = (accId: string, patch: Partial<AccountHypo>) => {
    setHypos((prev) => ({ ...prev, [accId]: { ...prev[accId], ...patch } }));
    markProjectionEdited();
  };

  // Réinitialise les hypothèses du compte : apport = total apporté à la création + apports/virements.
  const resetHypo = (acc: { id: string; balance: number; envelope: string; currentContributed: number | null }) => {
    const auto = autoContributedFor(acc);
    updateHypo(acc.id, {
      contributed: String(Math.round(auto)),
      contributedBase: auto,
      annual: '2400',
      rate: '7',
      tax: String(taxRateFor(fiscalRates, acc.envelope)),
    });
  };

  const selectedAcc = investAccounts.find((a) => a.id === selectedAccId) ?? investAccounts[0];
  const selHypo = selectedAcc ? hypos[selectedAcc.id] : undefined;

  // ── Calcul global (somme des comptes) ──
  const investRowsGlobal = useMemo<InvestYearRow[]>(() => {
    const perAccount = investAccounts
      .filter((a) => hypos[a.id])
      .map((a) => projectInvestment({
        initialValue: a.balance,
        initialContributed: num(hypos[a.id].contributed),
        annualContribution: num(hypos[a.id].annual),
        annualRatePct: num(hypos[a.id].rate),
        years,
        taxRatePct: num(hypos[a.id].tax),
      }));
    return sumProjections(perAccount);
  }, [investAccounts, hypos, years]);

  const investFinal = investRowsGlobal[investRowsGlobal.length - 1];
  const curve = useMemo(() => investCurve(investRowsGlobal), [investRowsGlobal]);

  // ── Épargne ──
  const realSavings = pilotage?.total_savings ?? 0;
  const realMonthlySavings = useMemo(() => {
    const txs = transactions.map((t: any) => ({
      amount: Number(t.amount), date: t.date,
      account_type: t.account?.type ?? 'other',
      linked_account_type: t.linked_account?.type ?? null,
      note: t.note ?? null,
    }));
    return Math.round(estimateMonthlySavings(txs));
  }, [transactions]);
  const questionnaireMonthlySavings = useMemo(() => Math.round(incomeFromQ3(answers?.q3) * savingsRateFromQ6(answers?.q6)), [answers]);

  // Source choisie manuellement (null = automatique : Réel si actif, sinon Questionnaire, sinon Perso)
  const [pickedSource, setPickedSource] = useState<'reel' | 'questionnaire' | 'perso' | null>(null);
  const savingsSource: 'reel' | 'questionnaire' | 'perso' =
    pickedSource ?? (realMonthlySavings > 0 ? 'reel' : (questionnaireMonthlySavings > 0 ? 'questionnaire' : 'perso'));
  const setSavingsSource = setPickedSource;
  const [savingsInitial, setSavingsInitial] = useState('0');
  const [savingsMonthlyPerso, setSavingsMonthlyPerso] = useState('150');
  const [savSynced, setSavSynced] = useState(false);
  useEffect(() => {
    if (!savSynced && pilotage) {
      setSavingsInitial(String(Math.round(realSavings)));
      setSavSynced(true);
    }
  }, [pilotage, savSynced]);

  const savingsMonthly =
    savingsSource === 'reel' ? realMonthlySavings :
    savingsSource === 'questionnaire' ? questionnaireMonthlySavings :
    num(savingsMonthlyPerso);
  const savingsHorizons = useMemo(() => projectSavings(num(savingsInitial), savingsMonthly, [1, 3, 5, 10], 2), [savingsInitial, savingsMonthly]);

  const [showTable, setShowTable] = useState(true);

  // ── Années passées : reconstruction du solde réel par année ──
  const currentYear = new Date().getFullYear();
  const pastInvestRows = useMemo(() => {
    const investAccountIds = new Set(investAccounts.map((a) => a.id).filter((id) => id !== 'manual'));
    if (investAccountIds.size === 0) return [];

    // Trouver l'année de départ = min(created_at des comptes d'invest)
    const creationYears = allAccounts
      .filter((a: any) => a.type === 'investment' && a.created_at)
      .map((a: any) => new Date(a.created_at).getFullYear());
    if (creationYears.length === 0) return [];
    const startYear = Math.min(...creationYears);
    if (startYear >= currentYear) return [];

    // Solde actuel total des comptes d'invest
    const totalBalance = investAccounts.reduce((s, a) => s + (a.id !== 'manual' ? a.balance : 0), 0);

    // Pour chaque année passée, reconstruire le solde = totalBalance - sum(transactions > fin d'année)
    const investTxs = (transactions as any[]).filter(
      (t) => investAccountIds.has(t.account_id) && !t.is_draft
    );

    const rows: { year: number; value: number; isPast: true }[] = [];
    for (let y = startYear; y < currentYear; y++) {
      const endOfYear = `${y}-12-31`;
      const sumAfter = investTxs
        .filter((t) => t.date > endOfYear)
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      const valueAtYear = totalBalance - sumAfter;
      rows.push({ year: y, value: Math.max(0, valueAtYear), isPast: true });
    }
    return rows;
  }, [allAccounts, investAccounts, transactions, currentYear]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Onglets */}
          <View style={styles.tabs} ref={tabsRef}>
            <TouchableOpacity style={[styles.tab, activeTab === 'invest' && { backgroundColor: semanticText(INVEST_COLOR, COLORS), borderColor: semanticText(INVEST_COLOR, COLORS) }]} onPress={() => setActiveTab('invest')}>
              <Ionicons name="trending-up" size={16} color={activeTab === 'invest' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'invest' && { color: '#fff' }]}>Investissements</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, activeTab === 'epargne' && { backgroundColor: semanticText(SAVINGS_COLOR, COLORS), borderColor: semanticText(SAVINGS_COLOR, COLORS) }]} onPress={() => setActiveTab('epargne')}>
              <Ionicons name="shield-checkmark" size={16} color={activeTab === 'epargne' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'epargne' && { color: '#fff' }]}>Épargne</Text>
            </TouchableOpacity>
          </View>

          {/* ═══════ INVESTISSEMENTS ═══════ */}
          {activeTab === 'invest' && (<>
          <Text style={styles.sectionHint}>Projection globale sur {years} ans (tous comptes)</Text>

          {/* KPIs globaux */}
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderLeftColor: INVEST_COLOR }]}>
              <Text style={styles.kpiLabel}>Valeur projetée</Text>
              <Text style={[styles.kpiValue, { color: semanticText(INVEST_COLOR, COLORS) }]}>{fmt(investFinal?.value ?? 0)}</Text>
              <Text style={styles.kpiSub}>après {years} ans</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Capital investi</Text>
              <Text style={styles.kpiValue}>{fmt(investFinal?.cumulativeContribution ?? 0)}</Text>
              <Text style={styles.kpiSub}>vos apports</Text>
            </View>
          </View>
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderLeftColor: SAVINGS_COLOR }]}>
              <Text style={styles.kpiLabel}>Plus-value nette</Text>
              <Text style={[styles.kpiValue, { color: semanticText(SAVINGS_COLOR, COLORS) }]}>+{fmt(investFinal?.netGainTotal ?? 0)}</Text>
              <Text style={styles.kpiSub}>après fiscalité</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Revenu passif</Text>
              <Text style={styles.kpiValue}>{fmt(investFinal?.netGainMonthly ?? 0)}</Text>
              <Text style={styles.kpiSub}>/ mois la dernière année</Text>
            </View>
          </View>

          {/* Graphique global */}
          <View style={styles.chartCard} ref={chartRef}>
            <GrowthChart points={curve} width={chartWidth} color={INVEST_COLOR} />
            <View style={styles.legendRow}>
              <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: INVEST_COLOR }]} /><Text style={styles.legendText}>Valeur du portefeuille</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDash, { borderColor: COLORS.textSecondary }]} /><Text style={styles.legendText}>Capital investi</Text></View>
            </View>
          </View>

          {/* Hypothèses PAR COMPTE */}
          <View style={[styles.controlsCard, onbHypo ? onbGlow(COLORS, true) : null]} ref={hypoRef}>
            <View style={styles.controlsTitleRow}>
              <Text style={[styles.controlsTitle, { marginBottom: 0 }]}>Hypothèses par compte</Text>
              {selectedAcc && (
                <TouchableOpacity
                  onPress={() => resetHypo(selectedAcc)}
                  style={styles.resetBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Réinitialiser les hypothèses"
                >
                  <Ionicons name="refresh-outline" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            {/* Sélecteur de compte */}
            {investAccounts.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }}>
                <View style={styles.accChipRow}>
                  {investAccounts.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.accChip, selectedAccId === a.id && { backgroundColor: INVEST_COLOR + '22', borderColor: INVEST_COLOR }]}
                      onPress={() => setSelectedAccId(a.id)}
                    >
                      <Text style={[styles.accChipText, selectedAccId === a.id && { color: INVEST_COLOR, fontWeight: '700' }]}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            {selectedAcc && selHypo && (
              <>
                <View style={styles.valueBadge}>
                  <Text style={styles.valueBadgeLabel}>Valeur actuelle</Text>
                  <Text style={styles.valueBadgeValue}>{fmt(selectedAcc.balance)}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <NumField label="Apport existant" value={selHypo.contributed} onChange={(v) => updateHypo(selectedAcc.id, { contributed: v, contributedBase: autoContributedFor(selectedAcc) })} suffix={CURRENCY_SYMBOL} colors={COLORS} />
                  <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 10 }}>
                    <Text style={styles.miniHint}>Plus-value = valeur − apport.</Text>
                  </View>
                </View>
                <View style={styles.fieldRow}>
                  <NumField
                    label="Apport mensuel" suffix={CURRENCY_SYMBOL} colors={COLORS}
                    value={String(Math.round(num(selHypo.annual) / 12))}
                    onChange={(v) => updateHypo(selectedAcc.id, { annual: String(Math.round(num(v) * 12)) })}
                  />
                  <NumField
                    label="Apport annuel" suffix={CURRENCY_SYMBOL} colors={COLORS}
                    value={selHypo.annual}
                    onChange={(v) => updateHypo(selectedAcc.id, { annual: v })}
                  />
                </View>
                <View style={styles.fieldRow}>
                  <NumField label="Rendement /an" value={selHypo.rate} onChange={(v) => updateHypo(selectedAcc.id, { rate: v })} suffix="%" colors={COLORS} />
                  <NumField label="Fiscalité (gains)" value={selHypo.tax} onChange={(v) => updateHypo(selectedAcc.id, { tax: v })} suffix="%" colors={COLORS} />
                </View>
                {noteFor(fiscalRates, (selectedAcc as any).envelope) && (
                  <View style={styles.fiscalNote}>
                    <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.fiscalNoteText}>{noteFor(fiscalRates, (selectedAcc as any).envelope)}</Text>
                  </View>
                )}
              </>
            )}

            {/* Durée globale */}
            <Text style={styles.fieldLabel}>Durée (globale)</Text>
            <View style={styles.chipRow}>
              {[10, 15, 20, 25].map((yy) => (
                <TouchableOpacity key={yy} style={[styles.chip, years === yy && { backgroundColor: INVEST_COLOR, borderColor: INVEST_COLOR }]} onPress={() => setYears(yy)}>
                  <Text style={[styles.chipText, years === yy && { color: '#fff', fontWeight: '700' }]}>{yy} ans</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tableau global détaillé */}
          <TouchableOpacity style={styles.tableToggle} onPress={() => setShowTable((s) => !s)}>
            <Text style={styles.tableToggleText}>Détail année par année (global)</Text>
            <Ionicons name={showTable ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {showTable && (
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
              <View>
                <View style={[styles.tr, styles.trHead]}>
                  <Text style={[styles.th, { width: 52 }]}>Année</Text>
                  <Text style={[styles.th, { width: 80 }]}>Apport</Text>
                  <Text style={[styles.th, { width: 88 }]}>Valeur</Text>
                  <Text style={[styles.th, { width: 92 }]}>Net après taxe</Text>
                  <Text style={[styles.th, { width: 92 }]}>+Value brute</Text>
                  <Text style={[styles.th, { width: 88 }]}>Gain net /an</Text>
                  <Text style={[styles.th, { width: 96 }]} numberOfLines={1}>Gain net/mois</Text>
                </View>
                {/* Années passées (données réelles) */}
                {pastInvestRows.map((r, i) => (
                  <View key={`past-${r.year}`} style={[styles.tr, { opacity: 0.6 }, i % 2 === 1 && styles.trAlt]}>
                    <Text style={[styles.td, { width: 52, fontWeight: '700', color: COLORS.textSecondary }]}>{r.year}</Text>
                    <Text style={[styles.td, { width: 80, color: COLORS.textSecondary }]}>—</Text>
                    <Text style={[styles.td, { width: 88, color: COLORS.textSecondary, fontWeight: '600' }]}>{fmt(r.value)}</Text>
                    <Text style={[styles.td, { width: 92, color: COLORS.textSecondary }]}>—</Text>
                    <Text style={[styles.td, { width: 92, color: COLORS.textSecondary }]}>—</Text>
                    <Text style={[styles.td, { width: 88, color: COLORS.textSecondary }]}>—</Text>
                    <Text style={[styles.td, { width: 96, color: COLORS.textSecondary }]}>—</Text>
                  </View>
                ))}
                {/* Années projetées */}
                {investRowsGlobal.map((r, i) => (
                  <View key={r.year} style={[styles.tr, (pastInvestRows.length + i) % 2 === 1 && styles.trAlt]}>
                    <Text style={[styles.td, { width: 52, fontWeight: '700' }]}>{r.year}</Text>
                    <Text style={[styles.td, { width: 80 }]}>{fmt(r.cumulativeContribution)}</Text>
                    <Text style={[styles.td, { width: 88, color: INVEST_COLOR, fontWeight: '600' }]}>{fmt(r.value)}</Text>
                    <Text style={[styles.td, { width: 92 }]}>{fmt(r.valueAfterTax)}</Text>
                    <Text style={[styles.td, { width: 92, color: SAVINGS_COLOR }]}>+{fmt(r.gainLatent)}</Text>
                    <Text style={[styles.td, { width: 88, color: SAVINGS_COLOR }]}>+{fmt(r.netGainAnnual)}</Text>
                    <Text style={[styles.td, { width: 96, color: SAVINGS_COLOR }]}>+{fmt(r.netGainMonthly)}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
          </>)}

          {/* ═══════ ÉPARGNE ═══════ */}
          {activeTab === 'epargne' && (<>
          <Text style={styles.sectionHint}>Combien aurez-vous selon votre rythme d'épargne</Text>

          <View style={styles.sourceRow}>
            {([
              { id: 'reel', label: 'Réel', val: realMonthlySavings, disabled: realMonthlySavings <= 0 },
              { id: 'questionnaire', label: 'Questionnaire', val: questionnaireMonthlySavings, disabled: questionnaireMonthlySavings <= 0 },
              { id: 'perso', label: 'Personnalisé', val: num(savingsMonthlyPerso), disabled: false },
            ] as const).map((s) => (
              <TouchableOpacity
                key={s.id} disabled={s.disabled}
                style={[styles.sourceChip, savingsSource === s.id && { backgroundColor: SAVINGS_COLOR + '22', borderColor: SAVINGS_COLOR }, s.disabled && { opacity: 0.4 }]}
                onPress={() => setSavingsSource(s.id)}
              >
                <Text style={[styles.sourceLabel, savingsSource === s.id && { color: SAVINGS_COLOR, fontWeight: '700' }]}>{s.label}</Text>
                <Text style={styles.sourceVal}>{fmt(s.val)}/mois</Text>
              </TouchableOpacity>
            ))}
          </View>

          {savingsSource === 'perso' && (
            <View style={styles.controlsCard}>
              <View style={styles.fieldRow}>
                <NumField label="Épargne /mois" value={savingsMonthlyPerso} onChange={(v) => { setSavingsMonthlyPerso(v); markProjectionEdited(); }} suffix={CURRENCY_SYMBOL} colors={COLORS} />
                <NumField label="Déjà épargné" value={savingsInitial} onChange={(v) => { setSavingsInitial(v); markProjectionEdited(); }} suffix={CURRENCY_SYMBOL} colors={COLORS} />
              </View>
            </View>
          )}
          {savingsSource === 'reel' && realMonthlySavings > 0 && (
            <Text style={styles.realHint}>💡 Moyenne lissée sur 12 mois (1 an) de vos virements et apports vers l'épargne, hors initialisation.</Text>
          )}
          {savingsSource === 'questionnaire' && (
            <Text style={styles.realHint}>💡 Estimé depuis vos réponses au questionnaire ({fmt(questionnaireMonthlySavings)}/mois).</Text>
          )}

          <View style={styles.horizonGrid}>
            {savingsHorizons.map((hz) => (
              <View key={hz.years} style={styles.horizonCard}>
                <Text style={styles.horizonSaved}>Épargné : {fmt(hz.contributed)}</Text>
                <Text style={styles.horizonLabel}>Dans {hz.label}</Text>
                <Text style={[styles.horizonValue, { color: semanticText(SAVINGS_COLOR, COLORS) }]}>{fmt(hz.total)}</Text>
              </View>
            ))}
          </View>
          </>)}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      <GuideOverlay
        visible={guide.visible}
        steps={PROJECTION_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(PROJECTION_GUIDE.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Projection"
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1 },
    scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
    pageTitle: { fontSize: 26, fontWeight: '800', color: c.text, marginBottom: 4 },
    pageSub: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginBottom: 16 },

    tabs: { flexDirection: 'row', gap: 8, marginBottom: 18 },
    tab: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 11, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    },
    tabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },

    sectionHint: { fontSize: 12, color: c.textSecondary, marginBottom: 14 },

    kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    kpiCard: {
      flex: 1, backgroundColor: c.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: c.cardBorder, borderLeftWidth: 3, borderLeftColor: c.cardBorder, gap: 2,
    },
    kpiLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
    kpiValue: { fontSize: 18, fontWeight: '800', color: c.text },
    kpiSub: { fontSize: 10, color: c.textSecondary },

    chartCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
      padding: 12, marginTop: 6, marginBottom: 14, alignItems: 'center',
    },
    legendRow: { flexDirection: 'row', gap: 16, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendLine: { width: 16, height: 3, borderRadius: 2 },
    legendDash: { width: 16, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
    legendText: { fontSize: 11, color: c.textSecondary },

    controlsCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
      padding: 14, marginBottom: 14, gap: 10,
    },
    controlsTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    controlsTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    resetBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    accChipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2, paddingHorizontal: 2 },
    accChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    accChipText: { fontSize: 12, color: c.text },
    valueBadge: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: c.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
      borderWidth: 1, borderColor: c.cardBorder,
    },
    valueBadgeLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
    valueBadgeValue: { fontSize: 15, fontWeight: '800', color: INVEST_COLOR },
    miniHint: { fontSize: 10, color: c.textSecondary, lineHeight: 13 },
    fiscalNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 6,
      backgroundColor: c.bg, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: c.cardBorder,
    },
    fiscalNoteText: { flex: 1, fontSize: 11, color: c.textSecondary, lineHeight: 15 },

    fieldRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    field: { gap: 5, minWidth: 0 },
    fieldLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
    fieldInputWrap: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12,
      minWidth: 0,
    },
    fieldInput: {
      flex: 1, minWidth: 0, color: c.text, fontSize: 16, fontWeight: '700', paddingVertical: 9,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', width: 0 } as any : {}),
    },
    fieldSuffix: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    chipText: { fontSize: 13, color: c.text },
    realHint: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 12 },

    tableToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
    tableToggleText: { fontSize: 14, fontWeight: '600', color: c.text },
    tableScroll: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, marginBottom: 8, backgroundColor: c.card },
    tr: { flexDirection: 'row' },
    trHead: { borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    trAlt: { backgroundColor: c.bg },
    th: { fontSize: 11, fontWeight: '700', color: c.textSecondary, paddingVertical: 10, paddingHorizontal: 8, textAlign: 'right' },
    td: { fontSize: 12, color: c.text, paddingVertical: 9, paddingHorizontal: 8, textAlign: 'right' },

    sourceRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    sourceChip: { flex: 1, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: c.card, gap: 2, alignItems: 'center' },
    sourceLabel: { fontSize: 13, color: c.text, fontWeight: '600' },
    sourceVal: { fontSize: 11, color: c.textSecondary },

    horizonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    horizonCard: { flexGrow: 1, flexBasis: '46%', backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 14, gap: 3 },
    horizonSaved: { fontSize: 11, color: c.textSecondary },
    horizonLabel: { fontSize: 13, color: c.text, fontWeight: '700' },
    horizonValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  });
}
