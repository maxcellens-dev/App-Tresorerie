import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  useWindowDimensions, Platform, findNodeHandle,
} from 'react-native';
import { CURRENCY_SYMBOL } from '../../lib/currency';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/ScreenGradient';
import CalculatorButton from '../../components/CalculatorButton';
import PageIntroModal from '../../components/PageIntroModal';
import OnboardingHintBanner from '../../components/OnboardingHintBanner';
import AdSlot from '../../components/AdSlot';
import { useUpdateOnboarding } from '../../hooks/useOnboarding';
import GuideOverlay, { type BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';
import { tabRect } from '../../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../../lib/onbHighlight';
import { computeContributed } from '../../lib/contributed';
import { useRouter } from 'expo-router';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../../contexts/AuthContext';
import { usePilotageData } from '../../hooks/usePilotageData';
import { useTransactions } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useQuestionnaireAnswers } from '../../hooks/useFinancialProfile';
import { useAppColors } from '../../hooks/useAppColors';
import { useFiscalEnvelopeRates, taxRateFor, noteFor } from '../../hooks/useFiscalEnvelopes';
import { useProjectionAssumptions, useSaveProjectionAssumptions } from '../../hooks/useProjectionAssumptions';
import {
  projectInvestment, sumProjections, projectSavings, investCurve,
  estimateMonthlySavings, incomeFromQ3, savingsRateFromQ6,
  type InvestYearRow,
} from '../../lib/projectionEngine';

import { semanticText } from '../../theme/palette';

const INVEST_COLOR = '#a78bfa';
const SAVINGS_COLOR = '#34d399';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
const fmtK = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.0', '')}k`;
  return Math.round(n).toString();
};

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
  // Couleurs Investissement / Épargne = couleurs sémantiques du Style Editor
  // (respectent le thème clair/sombre). Surchargent les constantes de marque par défaut.
  const INVEST_COLOR = COLORS.investment;
  const SAVINGS_COLOR = COLORS.savings;
  const onbHypo = useOnbHighlight('projection_edited');
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const router = useRouter();
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
    { getRect: () => tabRect(3), icon: 'trending-up', iconColor: '#a78bfa', title: 'Onglet Projection', description: 'Touchez « Projection » dans la barre du bas pour projeter votre patrimoine.' },
    { getRef: () => tabsRef, icon: 'swap-horizontal-outline', iconColor: '#a78bfa', title: 'Investissement & Épargne', description: 'Basculez entre la projection de vos investissements et celle de votre épargne.' },
    { getRef: () => hypoRef, icon: 'options-outline', iconColor: COLORS.green, title: 'Vos hypothèses', description: 'Ajustez apports, rendement, fiscalité et durée : la projection se recalcule en direct.' },
  ];

  const [activeTab, setActiveTab] = useState<'invest' | 'epargne' | 'treso'>('treso');

  // ── Comptes d'investissement (simulation libre si aucun, toujours au moins un) ──
  const investAccounts = useMemo(() => {
    const list = allAccounts.filter((a: any) => a.type === 'investment');
    if (list.length > 0) return list.map((a: any) => ({ id: a.id, name: a.name, balance: Number(a.balance), envelope: a.fiscal_envelope ?? 'autre', initialContributed: a.initial_contributed != null ? Number(a.initial_contributed) : null }));
    return [{ id: 'manual', name: 'Simulation libre', balance: 0, envelope: 'autre', initialContributed: null as number | null }];
  }, [allAccounts]);

  // Apport repris dans l'hypothèse = « apport actuel » dérivé des transactions (apports + virements − retraits au prorata).
  // À défaut (aucun apport de base défini), on retombe sur la valeur du compte.
  const autoContributedFor = React.useCallback((acc: { id: string; balance: number; initialContributed: number | null }) => {
    const derived = computeContributed({ id: acc.id, type: 'investment', balance: acc.balance, initial_contributed: acc.initialContributed }, transactions as any);
    return derived != null ? derived : acc.balance;
  }, [transactions]);

  // Hypothèses persistées en base (remplace localStorage).
  const assumptionsQuery = useProjectionAssumptions(user?.id);
  const saveAssumptions = useSaveProjectionAssumptions(user?.id);

  // ── État : hypothèses par compte + durée globale ──
  const [hypos, setHypos] = useState<Record<string, AccountHypo>>({});
  const [years, setYears] = useState(20);
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // Charger depuis la base + pré-remplir les comptes manquants
  useEffect(() => {
    if (loaded || investAccounts.length === 0 || fiscalRates.length === 0 || !assumptionsQuery.isFetched) return;
    const saved = assumptionsQuery.data;
    const initialHypos: Record<string, AccountHypo> = saved?.hypos ?? {};
    for (const acc of investAccounts) {
      if (!initialHypos[acc.id]) {
        const auto = autoContributedFor(acc);
        initialHypos[acc.id] = {
          contributed: String(Math.round(auto)),
          contributedBase: auto,
          annual: '0',
          rate: '7',
          tax: String(taxRateFor(fiscalRates, acc.envelope)),
        };
      }
    }
    setHypos(initialHypos);
    if (saved?.years) setYears(saved.years);
    // Épargne « personnalisé » : on restaure la saisie de l'utilisateur (§P5).
    if (saved?.savingsMonthlyPerso != null) setSavingsMonthlyPerso(String(saved.savingsMonthlyPerso));
    if (saved?.savingsInitial != null) { setSavingsInitial(String(saved.savingsInitial)); setSavSynced(true); }
    if (saved?.savingsSource) setPickedSource(saved.savingsSource);
    setSelectedAccId(investAccounts[0].id);
    setLoaded(true);
  }, [investAccounts, loaded, user?.id, fiscalRates]);

  // Sauvegarde : voir l'effet plus bas (après la déclaration des états d'épargne « perso »).
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
          next[acc.id] = { contributed: String(Math.round(auto)), contributedBase: auto, annual: '0', rate: '7', tax: String(taxRateFor(fiscalRates, acc.envelope)) };
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
        if (acc.initialContributed == null || !next[acc.id]) continue;
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

  // Réinitialise les hypothèses du compte aux valeurs par défaut :
  // apport = total apporté à la création + apports/virements, 0 € d'apport mensuel/annuel,
  // 7 % de rendement et fiscalité de l'enveloppe.
  const resetHypo = (acc: { id: string; balance: number; envelope: string; initialContributed: number | null }) => {
    const auto = autoContributedFor(acc);
    updateHypo(acc.id, {
      contributed: String(Math.round(auto)),
      contributedBase: auto,
      annual: '0',
      rate: '7',
      tax: String(taxRateFor(fiscalRates, acc.envelope)),
    });
  };

  const selectedAcc = investAccounts.find((a) => a.id === selectedAccId) ?? investAccounts[0];
  const selHypo = selectedAcc ? hypos[selectedAcc.id] : undefined;

  // Sécurité : si le compte sélectionné n'a pas encore d'hypothèse (init pas encore passée à
  // cause d'un timing de chargement), on l'initialise tout de suite → les champs s'affichent
  // par défaut, sans devoir cliquer sur l'icône « actualiser ».
  useEffect(() => {
    if (!selectedAcc || hypos[selectedAcc.id]) return;
    const auto = autoContributedFor(selectedAcc as any);
    setHypos((prev) => (prev[selectedAcc.id] ? prev : {
      ...prev,
      [selectedAcc.id]: {
        contributed: String(Math.round(auto)),
        contributedBase: auto,
        annual: '0',
        rate: '7',
        tax: String(taxRateFor(fiscalRates, (selectedAcc as any).envelope)),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAcc?.id, hypos, fiscalRates]);

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

  // Sauvegarde des hypothèses (debounced) — inclut l'épargne « perso » (§P5).
  useEffect(() => {
    if (!loaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveAssumptions.mutate({ hypos, years, savingsMonthlyPerso, savingsInitial, savingsSource: pickedSource });
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hypos, years, loaded, savingsMonthlyPerso, savingsInitial, pickedSource]);

  const savingsMonthly =
    savingsSource === 'reel' ? realMonthlySavings :
    savingsSource === 'questionnaire' ? questionnaireMonthlySavings :
    num(savingsMonthlyPerso);
  const savingsHorizons = useMemo(() => projectSavings(num(savingsInitial), savingsMonthly, [1, 3, 5, 10], 2), [savingsInitial, savingsMonthly]);

  const [showTable, setShowTable] = useState(true);

  // ── Années passées : reconstruction du solde réel par année ──
  const currentYear = new Date().getFullYear();
  // ── Suivi : montant réellement investi (apports + virements) cette année ──
  const yearlyInvested = useMemo(() => {
    const investAccountIds = new Set(investAccounts.map((a) => a.id).filter((id) => id !== 'manual'));
    if (investAccountIds.size === 0) return 0;
    const yearStart = `${currentYear}-01-01`;
    return (transactions as any[])
      .filter((t) => t.account_id && investAccountIds.has(t.account_id) && !t.is_draft && Number(t.amount) > 0 && t.date >= yearStart)
      .reduce((s, t) => s + Number(t.amount), 0);
  }, [investAccounts, transactions, currentYear]);

  // ── Apport annuel par ligne de projection ──
  // Année en cours : apports réels (virements/apports sur les comptes d'invest, hors apport de création).
  // Années futures : apport annuel projeté (somme des hypothèses).
  const yearlyApportForRow = useMemo(() => {
    const totalAnnual = investAccounts.filter((a) => hypos[a.id]).reduce((s, a) => s + num(hypos[a.id]?.annual ?? '0'), 0);
    return (year: number) => (year === currentYear ? yearlyInvested : totalAnnual);
  }, [investAccounts, hypos, currentYear, yearlyInvested]);

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
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <PageIntroModal pageKey="projection" />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Onglets */}
          <View style={styles.tabs} ref={tabsRef}>
            <TouchableOpacity style={[styles.tab, activeTab === 'treso' && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]} onPress={() => setActiveTab('treso')}>
              <Ionicons name="calendar-outline" size={15} color={activeTab === 'treso' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'treso' && { color: '#fff' }]} numberOfLines={1}>Trésorerie</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, activeTab === 'invest' && { backgroundColor: semanticText(INVEST_COLOR, COLORS), borderColor: semanticText(INVEST_COLOR, COLORS) }]} onPress={() => setActiveTab('invest')}>
              <Ionicons name="trending-up" size={15} color={activeTab === 'invest' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'invest' && { color: '#fff' }]} numberOfLines={1}>Invest.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, activeTab === 'epargne' && { backgroundColor: semanticText(SAVINGS_COLOR, COLORS), borderColor: semanticText(SAVINGS_COLOR, COLORS) }]} onPress={() => setActiveTab('epargne')}>
              <Ionicons name="shield-checkmark" size={15} color={activeTab === 'epargne' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'epargne' && { color: '#fff' }]} numberOfLines={1}>Épargne</Text>
            </TouchableOpacity>
          </View>

          {/* ═══════ INVESTISSEMENTS ═══════ */}
          {/* ═══════ TRÉSORERIE SIMPLIFIÉE ═══════ */}
          {activeTab === 'treso' && (
            <TresoSimplified transactions={transactions} accounts={allAccounts} pilotage={pilotage} COLORS={COLORS} styles={styles} onOpenDetail={() => router.push('/(tabs)/tresorerie')} />
          )}

          {activeTab === 'invest' && (<>
          <Text style={styles.sectionHint}>Projection globale sur {years} ans (tous comptes)</Text>

          {/* ── Suivi annuel ── */}
          {yearlyInvested > 0 && (
            <View style={[styles.kpiCard, { borderLeftColor: INVEST_COLOR, flexDirection: 'row', alignItems: 'center', marginBottom: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kpiLabel}>Investi en {currentYear}</Text>
                <Text style={[styles.kpiValue, { color: semanticText(INVEST_COLOR, COLORS) }]}>{fmt(yearlyInvested)}</Text>
                <Text style={styles.kpiSub}>apports et virements réels sur vos comptes invest</Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color={SAVINGS_COLOR} />
            </View>
          )}

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

          {/* Bandeau pub (maison) — juste au-dessus du détail année par année */}
          <AdSlot placement="projection_invest" />

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
                  <Text style={[styles.th, { width: 80 }]}>Apport/an</Text>
                  <Text style={[styles.th, { width: 88 }]}>Apport total</Text>
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
                    <Text style={[styles.td, { width: 88, color: COLORS.textSecondary }]}>—</Text>
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
                    <Text style={[styles.td, { width: 80 }]}>{fmt(yearlyApportForRow(r.year))}</Text>
                    <Text style={[styles.td, { width: 88 }]}>{fmt(r.cumulativeContribution)}</Text>
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
              {/* Réinitialisation au solde actuel des comptes épargne (§N9) */}
              {Math.round(num(savingsInitial)) !== Math.round(realSavings) && (
                <TouchableOpacity
                  style={styles.savingsResetLink}
                  activeOpacity={0.7}
                  onPress={() => { setSavingsInitial(String(Math.round(realSavings))); markProjectionEdited(); }}
                >
                  <Ionicons name="refresh" size={13} color={COLORS.emerald} />
                  <Text style={styles.savingsResetText}>Réinitialiser à votre solde réel ({fmt(realSavings)})</Text>
                </TouchableOpacity>
              )}
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

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <AdSlot placement="projection" />

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
      <CalculatorButton />
    </View>
  );
}

/* ── Courbe des soldes prévus (ligne + points marqués) sur 6 mois ── */
function BalanceCurve({ rows, width, COLORS, marginAmount = 0 }: {
  rows: { label: string; balance: number; isCurrent: boolean }[];
  width: number;
  COLORS: any;
  marginAmount?: number;
}) {
  if (rows.length < 2 || width <= 0) return null;
  const h = 188;
  const padL = 12, padR = 14, padT = 30, padB = 26;
  const usableW = width - padL - padR;
  const usableH = h - padT - padB;
  const vals = rows.map((r) => r.balance);
  const hasMargin = marginAmount > 0;
  let minV = Math.min(...vals, 0, hasMargin ? marginAmount : Infinity);
  let maxV = Math.max(...vals, hasMargin ? marginAmount : -Infinity);
  if (maxV === minV) maxV = minV + 1;
  const pad = (maxV - minV) * 0.12;
  minV -= pad; maxV += pad;
  const x = (i: number) => padL + (i / (rows.length - 1)) * usableW;
  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * usableH;
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.balance)}`).join(' ');
  const area = `${line} L ${x(rows.length - 1)} ${padT + usableH} L ${x(0)} ${padT + usableH} Z`;
  const zeroVisible = minV < 0 && maxV > 0;
  const shortMonth = (lbl: string) => lbl.split(' ')[0].slice(0, 4);
  return (
    <Svg width={width} height={h}>
      <Defs>
        <LinearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={COLORS.blue} stopOpacity="0.28" />
          <Stop offset="1" stopColor={COLORS.blue} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {zeroVisible && (
        <Line x1={padL} y1={y(0)} x2={width - padR} y2={y(0)} stroke={COLORS.cardBorder} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {/* Trait « marge de sécurité » (§N7) */}
      {hasMargin && (
        <>
          <Line x1={padL} y1={y(marginAmount)} x2={width - padR} y2={y(marginAmount)} stroke={COLORS.yellow} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.9} />
          <SvgText x={padL + 2} y={y(marginAmount) - 4} fill={COLORS.yellow} fontSize="9" fontWeight="400" textAnchor="start" opacity={0.9}>{`Marge de sécurité (${fmt(marginAmount)})`}</SvgText>
        </>
      )}
      <Path d={area} fill="url(#balGrad)" />
      <Path d={line} stroke={COLORS.blue} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((r, i) => (
        <React.Fragment key={i}>
          <Circle cx={x(i)} cy={y(r.balance)} r={r.isCurrent ? 5 : 3.5} fill={r.isCurrent ? COLORS.blue : COLORS.bg} stroke={COLORS.blue} strokeWidth={2} />
          <SvgText x={x(i)} y={y(r.balance) - 10} fill={r.balance >= 0 ? COLORS.text : COLORS.danger} fontSize="10" fontWeight="700" textAnchor="middle">
            {fmtK(r.balance)}
          </SvgText>
          <SvgText x={x(i)} y={h - 8} fill={r.isCurrent ? COLORS.blue : COLORS.textSecondary} fontSize="10" fontWeight={r.isCurrent ? '800' : '600'} textAnchor="middle">
            {shortMonth(r.label)}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}

// ── Trésorerie simplifiée : liste de mois (revenus / dépenses / variables / solde prévu) ──
function TresoSimplified({ transactions, accounts, pilotage, COLORS, styles, onOpenDetail }: {
  transactions: any[]; accounts: any[]; pilotage: any; COLORS: any; styles: any; onOpenDetail: () => void;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
  const { width: winW } = useWindowDimensions();
  const chartWidth = Math.max(0, winW - 32 - 24); // padding scroll (16×2) + carte (12×2)
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const checkingIds = new Set(accounts.filter((a: any) => a.type === 'checking').map((a: any) => a.id));
  const accountTypeById: Record<string, string> = {};
  accounts.forEach((a: any) => { accountTypeById[a.id] = a.type; });
  const checkingBalance = accounts.filter((a: any) => a.type === 'checking').reduce((s: number, a: any) => s + Number(a.balance), 0);
  const variableMonthly = pilotage?.variable_envelope_initial ?? 0;
  const variableRemaining = pilotage?.variable_envelope_remaining ?? variableMonthly;

  // Filtres : on ne garde que les flux des comptes courants, hors virements internes,
  // hors régularisations et hors montants RÉSERVÉS (qui restent sur le compte → font partie du solde).
  const onChecking = (t: any) => checkingIds.has(t.account_id);
  const isTransfer = (t: any) => !!t.linked_account_id;
  const isRegul = (t: any) => typeof t.note === 'string' && /r[ée]gul/i.test(t.note);
  const usable = (t: any) => onChecking(t) && !isTransfer(t) && !t.is_draft && !t.is_reserved;

  // « Autre » = virements entre le compte courant et l'épargne/investissement, DANS LES 2 SENS
  // (courant→épargne = sortie négative ; épargne→courant = entrée positive).
  // Les virements de PROJET comptent comme des virements planifiés, MÊME en brouillon (comme si on
  // les avait saisis manuellement). Les RÉSERVATIONS (is_reserved) et les autres brouillons ne comptent pas.
  const isOtherFlow = (t: any) => {
    if (t.is_reserved) return false;
    if (t.is_draft && !t.project_id) return false; // brouillons hors projet : exclus
    if (!onChecking(t)) return false; // on ne garde que la jambe côté compte courant
    if (!t.linked_account_id) return false; // doit être un virement (pas une réservation)
    const linkedType = accountTypeById[t.linked_account_id] ?? null;
    return linkedType === 'savings' || linkedType === 'investment';
  };

  // Renvoie le flux NET signé du mois (négatif = sortie d'épargne, positif = retour vers le courant).
  const otherForMonth = (year: number, month: number, onlyRemaining: boolean) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let total = 0;
    for (const t of transactions) {
      if (!isOtherFlow(t)) continue;
      const raw = Number(t.amount);
      if (raw === 0) continue;
      if (t.is_recurring && t.recurrence_rule) {
        const occ = recurrenceAmount(t, year, month);
        if (!occ) continue;
        if (onlyRemaining) {
          const recDay = new Date(t.date).getDate();
          if (!t.is_draft && recDay < now.getDate()) continue;
        }
        total += occ; // signé
      } else if (t.date.startsWith(prefix)) {
        if (onlyRemaining) {
          if (!t.is_draft && t.date <= todayStr) continue;
        }
        total += raw; // signé
      }
    }
    return total;
  };

  function recurrenceAmount(t: any, year: number, month: number): number {
    const rule = t.recurrence_rule;
    const start = new Date(t.date);
    const end = t.recurrence_end_date ? new Date(t.recurrence_end_date) : new Date(year + 5, 0, 1);
    const msStart = new Date(year, month - 1, 1);
    const msEnd = new Date(year, month, 0);
    if (start > msEnd || end < msStart) return 0;
    if (rule === 'monthly') return Number(t.amount);
    if (rule === 'quarterly') {
      const sm = start.getFullYear() * 12 + start.getMonth();
      const tm = year * 12 + (month - 1);
      return (tm - sm) % 3 === 0 && tm >= sm ? Number(t.amount) : 0;
    }
    if (rule === 'yearly') return start.getMonth() === month - 1 ? Number(t.amount) : 0;
    if (rule === 'weekly') {
      let count = 0; let d = new Date(start);
      while (d <= msEnd) { if (d >= msStart && d <= end) count++; d.setDate(d.getDate() + 7); }
      return count * Number(t.amount);
    }
    return 0;
  }

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 1 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  });

  let runningBalance = checkingBalance;

  const rows = months.map(({ year, month, label }, i) => {
    const isCurrent = i === 0;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let income = 0;   // revenus (comptes courants, hors virements/régul)
    let expense = 0;  // dépenses récurrentes + réelles (signe négatif)

    for (const t of transactions) {
      if (!usable(t)) continue;
      const amt = Number(t.amount);
      let monthAmt: number;
      if (t.is_recurring && t.recurrence_rule) monthAmt = recurrenceAmount(t, year, month);
      else if (t.date.startsWith(prefix)) monthAmt = amt;
      else continue;
      if (monthAmt === 0) continue;
      if (monthAmt > 0) { if (!isRegul(t)) income += monthAmt; }
      else { expense += monthAmt; }
    }

    // Dépenses variables : reste estimé pour le mois courant, estimation mensuelle ensuite.
    const variable = isCurrent ? variableRemaining : variableMonthly;
    const other = otherForMonth(year, month, false);
    const otherRemaining = isCurrent ? otherForMonth(year, month, true) : other;

    // Solde prévu (fin de mois). Mois courant : on ne reprojette que ce qui est encore à venir
    // (récurrences + ponctuels datés après aujourd'hui) pour ne pas double-compter le solde réel.
    if (isCurrent) {
      let upcoming = 0;
      for (const t of transactions) {
        if (!usable(t)) continue;
        const amt = Number(t.amount);
        if (t.is_recurring && t.recurrence_rule) {
          const occ = recurrenceAmount(t, year, month);
          // approximation : récurrence comptée si son jour n'est pas encore passé
          const recDay = new Date(t.date).getDate();
          if (occ !== 0 && recDay >= now.getDate()) upcoming += occ;
        } else if (t.date.startsWith(prefix) && t.date > todayStr) {
          if (!(amt > 0 && isRegul(t))) upcoming += amt;
        }
      }
      // `otherRemaining` est signé (sortie négative / entrée positive) → on l'AJOUTE.
      runningBalance = checkingBalance + upcoming - variableRemaining + otherRemaining;
    } else {
      runningBalance += income + expense - variable + other;
    }

    return {
      year, month, label, income, expense: Math.abs(expense), variable, other, balance: runningBalance, isCurrent,
      startBalance: isCurrent ? checkingBalance : null,
    };
  });

  return (
    <View>
      <TouchableOpacity style={[styles.tresoDetailBtn, { marginTop: 0, marginBottom: 14 }]} onPress={onOpenDetail} activeOpacity={0.8}>
        <Ionicons name="grid-outline" size={16} color={COLORS.blue} />
        <Text style={[styles.tresoDetailBtnText, { color: COLORS.blue }]}>Voir le plan détaillé (tableau complet)</Text>
        <Ionicons name="chevron-forward" size={15} color={COLORS.blue} />
      </TouchableOpacity>
      <Text style={styles.sectionHint}>Soldes et flux prévus sur les 6 prochains mois</Text>
      {/* Courbe d'évolution des soldes prévus (points marqués) — au-dessus du 1er mois */}
      <View style={[styles.chartCard, { marginTop: 0, alignItems: 'stretch' }]}>
        <Text style={styles.chartTitle}>Prévision des soldes de trésorerie</Text>
        <View style={{ alignItems: 'center' }}>
          <BalanceCurve rows={rows} width={chartWidth} COLORS={COLORS} marginAmount={pilotage?.safety_margin_amount ?? 0} />
        </View>
      </View>
      {rows.map((r, i) => (
        <React.Fragment key={`${r.year}-${r.month}`}>
        {/* Bandeau pub entre le 3e et le 4e mois — marges égales avec les cartes (≈10px). */}
        {i === 3 && <AdSlot placement="projection_mois" style={{ marginTop: -6, marginBottom: 4 }} />}
        <View style={[styles.tresoMonthCard, r.isCurrent && { borderColor: COLORS.blue + '88' }]}>
          <View style={[styles.tresoMonthHeader, r.isCurrent && { justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
              {r.isCurrent && <View style={[styles.tresoCurrentDot, { backgroundColor: COLORS.blue }]} />}
              <Text style={[styles.tresoMonthLabel, r.isCurrent && { color: COLORS.blue }]}>{r.label}</Text>
            </View>
            {r.isCurrent && r.startBalance != null && (
              <Text style={[styles.tresoStartBalance, { color: COLORS.textSecondary }]}>
                Départ : {fmt(r.startBalance)} {CURRENCY_SYMBOL}
              </Text>
            )}
          </View>
          <View style={styles.tresoMonthBody}>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>Revenus</Text>
              <Text style={[styles.tresoVal, { color: COLORS.green }]}>+{fmt(r.income)} {CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>Dépenses prévues</Text>
              <Text style={[styles.tresoVal, { color: COLORS.danger }]}>−{fmt(r.expense)} {CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>Dépenses variables (est.)</Text>
              <Text style={[styles.tresoVal, { color: COLORS.orange }]}>−{fmt(r.variable)} {CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>Autre (épargne, invest., projets)</Text>
              <Text style={[styles.tresoVal, { color: r.other > 0 ? COLORS.green : COLORS.violet }]}>
                {r.other > 0 ? '+' : '−'}{fmt(Math.abs(r.other))} {CURRENCY_SYMBOL}
              </Text>
            </View>
            <View style={[styles.tresoMonthRow, { borderTopWidth: 0.5, borderTopColor: COLORS.cardBorder, marginTop: 4, paddingTop: 6 }]}>
              <Text style={[styles.tresoKey, { fontWeight: '700' }]}>Solde prévu</Text>
              <Text style={[styles.tresoVal, { fontWeight: '800', color: r.balance >= 0 ? COLORS.text : COLORS.danger }]}>{fmt(r.balance)} {CURRENCY_SYMBOL}</Text>
            </View>
          </View>
        </View>
        </React.Fragment>
      ))}
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

    tabs: { flexDirection: 'row', gap: 6, marginBottom: 18 },
    tab: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      paddingVertical: 11, paddingHorizontal: 4, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    },
    tabText: { fontSize: 12, fontWeight: '700', color: c.textSecondary, flexShrink: 1 },

    sectionHint: { fontSize: 12, color: c.textSecondary, marginBottom: 14 },
    chartTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 8 },
    savingsResetLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    savingsResetText: { fontSize: 12, color: c.emerald, fontWeight: '600', flexShrink: 1 },

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
    valueBadgeValue: { fontSize: 15, fontWeight: '800', color: c.investment },
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

    tresoMonthCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 14, marginBottom: 10 },
    tresoMonthHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
    tresoCurrentDot: { width: 7, height: 7, borderRadius: 3.5 },
    tresoMonthLabel: { fontSize: 14, fontWeight: '800', color: c.text, textTransform: 'capitalize' },
    tresoStartBalance: { fontSize: 12, fontWeight: '600' },
    tresoMonthBody: { gap: 3 },
    tresoMonthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
    tresoKey: { fontSize: 13, color: c.textSecondary },
    tresoVal: { fontSize: 14, fontWeight: '600' },
    tresoDetailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginTop: 8, marginBottom: 8 },
    tresoDetailBtnText: { fontSize: 13, fontWeight: '700' },
  });
}
