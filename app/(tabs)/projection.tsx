import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  useWindowDimensions, Platform, findNodeHandle, Animated, Easing,
} from 'react-native';
import { CURRENCY_SYMBOL, convertAmount } from '../../lib/finance/currency';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { useProfile } from '../../hooks/data/useProfile';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/layout/ScreenGradient';
import PageLoader from '../../components/layout/PageLoader';
import { useDeferredMount } from '../../hooks/platform/useDeferredMount';
import CalculatorButton from '../../components/transaction/CalculatorButton';
import OnboardingHintBanner from '../../components/onboarding/OnboardingHintBanner';
import AdSlot from '../../components/marketing/AdSlot';
import { useUpdateOnboarding } from '../../hooks/engagement/useOnboarding';
import { useOnbHighlight, onbGlow } from '../../lib/engagement/onbHighlight';
import { computeContributed } from '../../lib/finance/contributed';
import { computeTresoRows } from '../../lib/finance/tresoProjection';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Svg, { Path, Line, Circle, Rect, Text as SvgText } from 'react-native-svg';
import GrowthChart, { fmtK } from '../../components/charts/GrowthChart';
import { useAuth } from '../../contexts/AuthContext';
import { usePilotageData } from '../../hooks/pilotage/usePilotageData';
import { useTransactions } from '../../hooks/data/useTransactions';
import { useSharedContribution } from '../../hooks/data/useSharedContribution';
import { useCreditFlows } from '../../hooks/data/useCreditFlows';
import { useTransactionMonthOverrides } from '../../hooks/data/useTransactionMonthOverrides';
import { useAccounts } from '../../hooks/data/useAccounts';
import { useQuestionnaireAnswers } from '../../hooks/pilotage/useFinancialProfile';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { pageColumn, MAX_W, GUTTER } from '../../lib/ui/webLayout';
import { useProjectionHorizon } from '../../hooks/config/useUiPrefs';
import { useFiscalEnvelopeRates, taxRateFor, noteFor, depositCapFor } from '../../hooks/data/useFiscalEnvelopes';
import { useProjectionAssumptions, useSaveProjectionAssumptions } from '../../hooks/pilotage/useProjectionAssumptions';
import {
  projectInvestment, sumProjections, projectSavings, investCurve,
  estimateMonthlySavings, incomeFromQ3, savingsRateFromQ6,
  type InvestYearRow,
} from '../../lib/finance/projectionEngine';

import { semanticText } from '../../theme/palette';
import { computeConfidence, resolveReliabilityConfig } from '../../lib/finance/confidenceEngine';
import { buildPerimeterCtx, transformFluxTransactions, splitPerimeterAccounts } from '../../lib/finance/perimeter';
import KeyboardAwareScrollView from '../../components/layout/KeyboardAwareScrollView';
import { sanitizeAmountInput, sanitizeRateInput } from '../../lib/ui/amountInput';
import { todayISO } from '../../lib/dateUtils';

/* Les constantes de marque `INVEST_COLOR` / `SAVINGS_COLOR` qui vivaient ici étaient MORTES : le
   corps de l'écran les redéfinit à partir du thème (`COLORS.investment` / `COLORS.savings`), donc
   les shadowe partout. Elles portaient les valeurs du thème SOMBRE — les garder à côté de leurs
   homonymes ne pouvait que tromper la prochaine lecture. */

/**
 * Rendement annuel appliqué à la projection d'ÉPARGNE (%).
 *
 * Ordre de grandeur d'un livret réglementé. Il était écrit en dur, sans nom, au milieu de l'appel à
 * `projectSavings` — et surtout il n'était annoncé NULLE PART : l'écran affichait « Épargné : X »
 * puis un total supérieur à « capital de départ + X », sans que rien n'explique l'écart. On le nomme
 * ici, et l'écran le dit maintenant (cf. la note sous les horizons).
 *
 * À exposer en admin le jour où le taux des livrets bouge — c'est la seule hypothèse de cet écran
 * que l'utilisateur ne peut pas régler lui-même.
 */
const SAVINGS_ANNUAL_RATE_PCT = 2;

/**
 * Durées proposées pour la projection d'investissement.
 *
 * Cette liste est aussi le FILTRE de la durée relue en base : `projection_assumptions` est un JSON
 * du profil, et une valeur qui n'est pas dans les puces laisse l'écran dans un état qu'aucun bouton
 * ne reflète — l'utilisateur lit « sur 37 ans » sans pouvoir revenir en arrière autrement qu'en
 * choisissant une autre durée.
 */
const YEAR_CHOICES = [10, 15, 20, 25] as const;
const DEFAULT_YEARS = 20;

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

/**
 * Montant SIGNÉ (« +1 200 € », « −340 € », « 0 € »).
 *
 * Plusieurs montants de cet écran peuvent légitimement être négatifs — la plus-value d'un compte en
 * perte, le gain net d'une année sans progression — et l'écran leur collait un « + » en dur dans le
 * JSX. On lisait donc « +-1 234 € ». Le signe se déduit du nombre, une seule fois, ici ; et zéro
 * n'a pas de signe.
 */
const fmtSigned = (n: number) => {
  const r = Math.round(n);
  if (r === 0) return fmt(0);
  return (r > 0 ? '+' : '−') + fmt(Math.abs(r));
};

interface AccountHypo { contributed: string; annual: string; rate: string; tax: string; contributedBase?: number }

/* ── Champ numérique compact ── */
function NumField({ label, value, onChange, suffix, colors, flex = 1, sanitize = sanitizeAmountInput }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string; colors: any; flex?: number;
  /** Normalisation à la frappe : montant (2 décimales) par défaut, taux (3) pour les %. */
  sanitize?: (raw: string) => string;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /* Le champ garde SA frappe tant qu'il a le focus.
     « Apport mensuel » est une valeur DÉRIVÉE (apport annuel ÷ 12) : chaque caractère tapé était
     converti en apport annuel, puis redivisé et arrondi pour réécrire le champ. Poser une virgule
     était donc impossible — « 12, » repassait à « 12 » avant même la décimale, et saisir 12,50 €
     par mois n'avait aucun moyen d'aboutir.
     Règle générale : un champ dont la valeur est recalculée en amont ne corrige pas l'utilisateur
     pendant qu'il tape ; il se réaligne quand il le quitte. */
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View style={[styles.field, { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          style={styles.fieldInput}
          value={draft ?? value}
          onChangeText={(t) => { const s = sanitize(t); setDraft(s); onChange(s); }}
          onFocus={() => setDraft(value)}
          onBlur={() => setDraft(null)}
          keyboardType="decimal-pad"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={label}
        />
        {suffix ? <Text style={styles.fieldSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

/** Montage différé (écran LOURD) : squelette 1 frame → l'onglet s'ouvre instantanément, le
 *  contenu (projections + graphes) arrive juste après. Cf. hooks/useDeferredMount. */
export default function ProjectionScreen() {
  return useDeferredMount() ? <ProjectionBody /> : <PageLoader />;
}

function ProjectionBody() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Couleurs Investissement / Épargne = couleurs sémantiques du Style Editor
  // (respectent le thème clair/sombre). Surchargent les constantes de marque par défaut.
  const INVEST_COLOR = COLORS.investment;
  const SAVINGS_COLOR = COLORS.savings;
  const onbHypo = useOnbHighlight('projection_edited');
  const { width } = useWindowDimensions();
  const { isDesktop } = useResponsive(); // web bureau : colonne de tableau de bord centrée
  const { user } = useAuth();
  const router = useRouter();
  const { horizon: tresoHorizon, setHorizon: setTresoHorizon } = useProjectionHorizon(user?.id);
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: rawTransactionsPerso = [] } = useTransactions(user?.id);
  const { data: monthOverrides = [] } = useTransactionMonthOverrides(user?.id);
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const { data: rawAccountsPerso = [] } = useAccounts(user?.id);
  const { data: fiscalRates = [] } = useFiscalEnvelopeRates();
  // #5 — Comptes partagés/joints pondérés (toutes les tx de tous les participants, ×mon % d'impact).
  const { data: sharedContrib } = useSharedContribution(user?.id);
  // C3 — flux dérivé des mensualités de crédit (sorties virtuelles sur le compte de prélèvement).
  const creditFlows = useCreditFlows(user?.id);
  const rawTransactions = useMemo(() => [...rawTransactionsPerso, ...(sharedContrib?.transactions ?? []), ...creditFlows], [rawTransactionsPerso, sharedContrib, creditFlows]);
  const rawAllAccounts = useMemo(() => [...rawAccountsPerso, ...(sharedContrib?.accounts ?? [])], [rawAccountsPerso, sharedContrib]);

  // ── Multi-devises : la projection raisonne dans la devise de RÉFÉRENCE. On convertit comptes
  // (solde + apport investissement) et transactions (par la devise de leur compte).
  const { data: profile } = useProfile(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const refCode = (profile as any)?.currency_code ?? 'EUR';
  const allAccounts = useMemo(() => rawAllAccounts.map((a) => {
    const cur = (a as any).currency || 'EUR';
    const ic = (a as any).initial_contributed;
    return {
      ...a,
      balance: convertAmount(Number(a.balance), cur, refCode, rates) ?? Number(a.balance),
      initial_contributed: ic != null ? (convertAmount(Number(ic), cur, refCode, rates) ?? Number(ic)) : ic,
    };
  }), [rawAllAccounts, rates, refCode]);
  const transactions = useMemo(
    () => rawTransactions.map((t) => ({ ...t, amount: convertAmount(Number(t.amount), (t as any).account?.currency || refCode, refCode, rates) ?? Number(t.amount) })),
    [rawTransactions, rates, refCode],
  );

  // Périmètre quotidien pour la VUE FLUX (courbe de solde / trésorerie simplifiée) UNIQUEMENT : les
  // joints « contribution » sortent, leurs virements deviennent des mouvements « compte partagé ».
  // Le patrimoine (graphe épargne/invest) garde `allAccounts`/`transactions` complets.
  const perimeterCtx = useMemo(() => buildPerimeterCtx(allAccounts.map((a: any) => ({
    id: a.id,
    isShared: !!(sharedContrib?.factorByAccount && a.id in sharedContrib.factorByAccount),
    shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
    factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
    type: a.type,
  }))), [allAccounts, sharedContrib]);
  const fluxTransactions = useMemo(() => transformFluxTransactions(transactions as any[], perimeterCtx), [transactions, perimeterCtx]);
  const fluxAccounts = useMemo(() => splitPerimeterAccounts(allAccounts, perimeterCtx).perimeter, [allAccounts, perimeterCtx]);

  /* ── Filtre par compte courant (onglet Trésorerie UNIQUEMENT) ──────────────────────────────
     Avec plusieurs comptes courants, la prévision les additionne : on ne peut pas voir où en sera
     TEL compte, alors que c'est souvent celui sur lequel tombent les prélèvements.
     Liste VIDE = « Tous » (comportement d'origine, donc rien ne change par défaut).
     L'état vit ICI et non dans `TresoSimplified` : il survit ainsi au passage par les onglets
     Invest./Épargne. Il n'est volontairement pas mémorisé d'une visite à l'autre — comme le filtre
     de la page Transactions, dont celui-ci reprend l'apparence. */
  const tresoCheckingAccounts = useMemo(
    () => fluxAccounts.filter((a: any) => a.type === 'checking'),
    [fluxAccounts],
  );
  const [tresoAccountIds, setTresoAccountIds] = useState<string[]>([]);

  /* Une sélection ne doit jamais désigner un compte qui n'existe plus (compte supprimé, ou passage
     en « connecté en tant que » : le jeu de comptes change entièrement sous nos pieds). Sans ce
     recoupement, le filtre ne retenait plus AUCUN compte et la prévision s'affichait à zéro, sans
     que rien à l'écran n'explique pourquoi. */
  const tresoSelectedIds = useMemo(() => {
    if (tresoAccountIds.length === 0) return [];
    const available = new Set(tresoCheckingAccounts.map((a: any) => a.id));
    return tresoAccountIds.filter((id) => available.has(id));
  }, [tresoAccountIds, tresoCheckingAccounts]);

  /* ⚠️ On ne retire QUE des comptes COURANTS. Les comptes d'épargne et d'investissement restent
     dans la liste même quand ils ne sont pas sélectionnés : `computeTresoRows` s'en sert pour
     reconnaître un virement « courant → épargne » et le classer en « Autre (épargne, invest,
     projets) ». Les enlever ne filtrait pas cette ligne : elle disparaissait purement et
     simplement, et le solde prévu devenait faux. */
  const tresoAccounts = useMemo(() => {
    if (tresoSelectedIds.length === 0) return fluxAccounts;
    const keep = new Set(tresoSelectedIds);
    return fluxAccounts.filter((a: any) => a.type !== 'checking' || keep.has(a.id));
  }, [fluxAccounts, tresoSelectedIds]);

  // Overrides « échéance modifiée » (transaction_month_overrides) : montant FINAL signé d'un mois
  // donné pour une récurrence. Converti dans la devise de référence (comme les transactions) et
  // indexé `${transaction_id}:${year}:${month}` → utilisé par la trésorerie simplifiée pour que la
  // Projection reflète les montants édités, comme le fait le plan de trésorerie.
  const overridesMap = useMemo(() => {
    const txById = new Map(rawTransactions.map((t) => [t.id, t]));
    const map: Record<string, number> = {};
    for (const o of monthOverrides) {
      if (o.override_amount == null) continue; // override date-only (#2) → pas de montant
      const t = txById.get(o.transaction_id);
      const cur = (t as any)?.account?.currency || refCode;
      const conv = convertAmount(Number(o.override_amount), cur, refCode, rates) ?? Number(o.override_amount);
      map[`${o.transaction_id}:${o.year}:${o.month}`] = conv;
    }
    return map;
  }, [monthOverrides, rawTransactions, rates, refCode]);

  /* Largeur du graphe d'investissement.
     Elle se DÉDUIT de la place réellement disponible, pas de la largeur de fenêtre : la carte est
     dans un ScrollView de 16 px de marge et a elle-même 12 px de padding, soit 56 px consommés.
     L'ancienne formule (`width − 48`) était optimiste de 8 px — le SVG dépassait donc du cadre
     arrondi de la carte sur tous les téléphones (et se faisait rogner sur Android). Sur ordinateur,
     la page vit dans une colonne centrée : c'est elle qui borne, pas la fenêtre. */
  const columnWidth = isDesktop ? Math.min(width, MAX_W.dashboard) - 2 * GUTTER : width;
  const chartWidth = Math.max(0, Math.min(columnWidth - 56, 560));
  const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(/,/g, '.')) || 0;
  /** Apport mensuel affiché depuis l'apport annuel stocké : au centime, sans décimale inutile. */
  const monthlyFromAnnual = (annual: string) => String(Math.round((num(annual) / 12) * 100) / 100);

  // ── Guide de présentation (bulles) ──
  const scrollRef = React.useRef<ScrollView>(null);
  const tabsRef = React.useRef<View>(null);
  const chartRef = React.useRef<View>(null);
  const hypoRef = React.useRef<View>(null);

  // Scroll vers la zone « Hypothèses » mise en évidence par le guide « Pour bien démarrer ».
  React.useEffect(() => {
    if (!onbHypo) return;
    const t = setTimeout(() => {
      // WEB : `findNodeHandle` LÈVE une exception sur react-native-web. On y passe par le DOM
      // (défilement courant + position mesurée dans la fenêtre) — même résultat, sans crash.
      if (Platform.OS === 'web') {
        const el: any = (scrollRef.current as any)?.getScrollableNode?.();
        if (el && hypoRef.current?.measureInWindow) {
          const currentY = Number(el.scrollTop) || 0;
          hypoRef.current.measureInWindow((_x: number, y: number) => {
            scrollRef.current?.scrollTo({ y: Math.max(0, currentY + y - 90), animated: true });
          });
        }
        return;
      }
      const node = scrollRef.current ? findNodeHandle(scrollRef.current) : null;
      if (node && hypoRef.current?.measureLayout) {
        hypoRef.current.measureLayout(node, (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
        }, () => {});
      }
    }, 350);
    return () => clearTimeout(t);
  }, [onbHypo]);


  const [activeTab, setActiveTab] = useState<'invest' | 'epargne' | 'treso'>('treso');

  // Étape « Personnaliser une projection » du guide : ouvrir l'onglet Investissement, car les
  // hypothèses à ajuster (hypoRef) ne sont rendues que là — sinon le scroll ne mène à rien.
  React.useEffect(() => {
    if (onbHypo) setActiveTab('invest');
  }, [onbHypo]);

  // Bannière interne ciblant un onglet de cette page. `adNonce` change à chaque clic → l'onglet
  // se rouvre même si l'on est déjà sur la page.
  const adParams = useLocalSearchParams<{ adAction?: string; adNonce?: string }>();
  React.useEffect(() => {
    const a = adParams.adAction;
    if (a === 'treso' || a === 'invest' || a === 'epargne') setActiveTab(a);
  }, [adParams.adAction, adParams.adNonce]);

  // ── Comptes d'investissement (simulation libre si aucun, toujours au moins un) ──
  const investAccounts = useMemo(() => {
    const list = allAccounts.filter((a: any) => a.type === 'investment');
    if (list.length > 0) return list.map((a: any) => ({ id: a.id, name: a.name, balance: Number(a.balance), envelope: a.fiscal_envelope ?? 'autre', initialContributed: a.initial_contributed != null ? Number(a.initial_contributed) : null }));
    return [{ id: 'manual', name: 'Simulation libre', balance: 0, envelope: 'autre', initialContributed: null as number | null }];
  }, [allAccounts]);

  /* Aucun compte d'investissement : l'écran travaille sur un compte FICTIF à 0 €. Sans le dire, il
     affichait une page entière de « 0 € » — valeur projetée, capital, plus-value, courbe plate —
     qu'un nouvel utilisateur lit comme un bug ou comme un verdict sur sa situation. */
  const isSimulationOnly = investAccounts.length === 1 && investAccounts[0].id === 'manual';

  // Apport repris dans l'hypothèse = « apport actuel » dérivé des transactions (apports + virements − retraits au prorata).
  // À défaut (aucun apport de base défini), on retombe sur la valeur du compte.
  const autoContributedFor = React.useCallback((acc: { id: string; balance: number; initialContributed: number | null }) => {
    // estimateBaseWhenMissing : sans apport de création défini, l'apport est estimé en EXCLUANT
    // les +/- values (sinon le repli sur le solde gonflerait l'apport des plus-values latentes).
    const derived = computeContributed(
      { id: acc.id, type: 'investment', balance: acc.balance, initial_contributed: acc.initialContributed },
      transactions as any,
      { estimateBaseWhenMissing: true },
    );
    return derived != null ? derived : acc.balance;
  }, [transactions]);

  // Hypothèses persistées en base (remplace localStorage).
  const assumptionsQuery = useProjectionAssumptions(user?.id);
  const saveAssumptions = useSaveProjectionAssumptions(user?.id);

  // ── État : hypothèses par compte + durée globale ──
  const [hypos, setHypos] = useState<Record<string, AccountHypo>>({});
  const [years, setYears] = useState<number>(DEFAULT_YEARS);
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // Charger depuis la base + pré-remplir les comptes manquants
  useEffect(() => {
    // `isSuccess` et non `isFetched` : une lecture EN ÉCHEC compte comme « fetched ». On partait
    // alors sur les valeurs par défaut, `loaded` passait à true, et la sauvegarde différée écrasait
    // en base les hypothèses réellement enregistrées. Tant que la lecture n'a pas RÉUSSI, on ne
    // charge rien et — surtout — on n'écrit rien (la sauvegarde est gardée par `loaded`).
    if (loaded || investAccounts.length === 0 || fiscalRates.length === 0 || !assumptionsQuery.isSuccess) return;
    const saved = assumptionsQuery.data;
    /* COPIE, et non l'objet du cache react-query : la boucle ci-dessous écrit dans cette table, et
       elle modifiait donc EN PLACE la donnée mise en cache par la requête. Une donnée de cache est
       censée être immuable — la muter fait diverger ce que react-query croit avoir stocké de ce
       qu'il détient réellement, et l'on perd les re-rendus qui devraient suivre. */
    const initialHypos: Record<string, AccountHypo> = { ...(saved?.hypos ?? {}) };
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
      } else if (acc.initialContributed == null) {
        // Correction des projections enregistrées avec l'ancien repli (apport = solde, +/- values
        // incluses). On ne recalcule QUE si la valeur n'a pas été éditée à la main (= encore égale
        // à la base auto précédente) → on ne touche jamais à une saisie volontaire de l'utilisateur.
        const h = initialHypos[acc.id];
        const looksAuto = h.contributedBase != null && Math.round(num(h.contributed)) === Math.round(h.contributedBase);
        if (looksAuto) {
          const auto = autoContributedFor(acc);
          initialHypos[acc.id] = { ...h, contributed: String(Math.round(auto)), contributedBase: auto };
        }
      }
    }
    setHypos(initialHypos);
    if ((YEAR_CHOICES as readonly number[]).includes(Number(saved?.years))) setYears(Number(saved.years));
    // Épargne « personnalisé » : on restaure la saisie de l'utilisateur (§P5).
    if (saved?.savingsMonthlyPerso != null) setSavingsMonthlyPerso(String(saved.savingsMonthlyPerso));
    if (saved?.savingsInitial != null) { setSavingsInitial(String(saved.savingsInitial)); setSavSynced(true); }
    if (saved?.savingsSource) setPickedSource(saved.savingsSource);
    setSelectedAccId(investAccounts[0].id);
    setLoaded(true);
    // assumptionsQuery.isFetched/.data DOIVENT être dans les deps : sinon, si les comptes et les
    // taux fiscaux sont prêts AVANT la requête des hypothèses, l'effet sort tôt (isFetched=false)
    // et ne se relance jamais → les valeurs sauvegardées ne sont pas restaurées et l'UI retombe
    // sur les défauts (« se remet par défaut parfois »).
  }, [investAccounts, loaded, user?.id, fiscalRates, assumptionsQuery.isSuccess, assumptionsQuery.data]);

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

  /* Les champs d'hypothèses gardent la frappe en cours tant qu'ils ont le focus (cf. `NumField`).
     Ce compteur les REMONTE quand leur contenu doit repartir de la valeur officielle :
       • après un « Réinitialiser » — sinon, sur mobile, appuyer sur le bouton ne fait pas perdre le
         focus au champ, qui continuerait d'afficher la saisie abandonnée ;
       • au changement de compte — sinon on lirait la frappe faite sur le compte PRÉCÉDENT.
     Il fait partie de la `key` des champs : le remontage remet la frappe en cours à zéro. */
  const [hypoNonce, setHypoNonce] = useState(0);

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
    setHypoNonce((n) => n + 1);
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
  // Le payload le plus récent est tenu dans un ref → il peut être FLUSHÉ à la sortie de l'écran
  // (sinon quitter la Projection < 500 ms après une saisie annulait le timer → dernière saisie perdue).
  const latestPayloadRef = React.useRef<any>(null);
  latestPayloadRef.current = { hypos, years, savingsMonthlyPerso, savingsInitial, savingsSource: pickedSource };
  useEffect(() => {
    if (!loaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveAssumptions.mutate(latestPayloadRef.current);
      saveTimerRef.current = null;
    }, 500);
    // Pas de clearTimeout ici : un changement de deps re-planifie déjà le timer (ligne ci-dessus).
    // Annuler à chaque rendu risquerait de perdre une sauvegarde au démontage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hypos, years, loaded, savingsMonthlyPerso, savingsInitial, pickedSource]);

  // Flush à la SORTIE de l'écran : si une sauvegarde est encore en attente, on l'exécute tout de suite.
  const loadedRef = React.useRef(loaded);
  loadedRef.current = loaded;
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      if (loadedRef.current) saveAssumptions.mutate(latestPayloadRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savingsMonthly =
    savingsSource === 'reel' ? realMonthlySavings :
    savingsSource === 'questionnaire' ? questionnaireMonthlySavings :
    num(savingsMonthlyPerso);
  const savingsHorizons = useMemo(
    () => projectSavings(num(savingsInitial), savingsMonthly, [1, 3, 5, 10], SAVINGS_ANNUAL_RATE_PCT),
    [savingsInitial, savingsMonthly],
  );

  const [showTable, setShowTable] = useState(true);

  // ── Années passées : reconstruction du solde réel par année ──
  const currentYear = new Date().getFullYear();
  // ── Suivi : montant réellement investi (apports + virements) cette année ──
  const yearlyInvested = useMemo(() => {
    const investAccountIds = new Set(investAccounts.map((a) => a.id).filter((id) => id !== 'manual'));
    if (investAccountIds.size === 0) return 0;
    const yearStart = `${currentYear}-01-01`;
    return (transactions as any[])
      // Apports & virements UNIQUEMENT (transfert lié ou note « apport ») : on exclut les +/- values
      // enregistrées comme transactions positives, qui augmentent la valeur mais pas l'apport.
      .filter((t) => t.account_id && investAccountIds.has(t.account_id) && !t.is_draft && Number(t.amount) > 0 && t.date >= yearStart
        && (!!t.linked_account_id || /apport/i.test(t.note || '')))
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

    /* Pour chaque année passée : solde = solde actuel − somme des mouvements postérieurs.
       ⚠️ On s'arrête à AUJOURD'HUI. Le solde d'un compte ne contient que les mouvements ÉCHUS
       (le recalcul serveur somme les transactions de date ≤ aujourd'hui) : retrancher en plus des
       apports DATÉS DANS LE FUTUR — un versement programmé, une échéance à venir — revenait à les
       soustraire d'un solde qui ne les a jamais contenus. Tous les points du passé s'en trouvaient
       décalés vers le bas, d'autant plus que le futur saisi est important.
       C'est la règle que le Reporting applique déjà pour reconstruire le patrimoine. */
    const todayStr = todayISO();
    const investTxs = (transactions as any[]).filter(
      (t) => investAccountIds.has(t.account_id) && !t.is_draft && String(t.date ?? '') <= todayStr,
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

  /* RIEN À MONTRER ≠ TOUT À ZÉRO. Sans ce garde, la page se dessinait entièrement pendant que les
     données arrivaient : chaque montant repliait sur `?? 0`, on lisait donc des cartes vides et des
     « 0 € » présentés comme des vrais chiffres, avant de les voir sauter aux bonnes valeurs.
     ⚠️ On teste l'ABSENCE de données, pas `isFetching` : le cache rend la quasi-totalité des
     retours instantanés, et remplacer une page déjà remplie par un cercle la ferait clignoter. */
  if (!pilotage) return <PageLoader label="Calcul de ta projection…" />;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right']}>
        <KeyboardAwareScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

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
            <TresoSimplified
              transactions={fluxTransactions}
              accounts={tresoAccounts}
              pilotage={pilotage}
              overridesMap={overridesMap}
              COLORS={COLORS}
              styles={styles}
              onOpenDetail={() => router.push('/(tabs)/tresorerie')}
              horizon={tresoHorizon}
              onChangeHorizon={setTresoHorizon}
              checkingAccounts={tresoCheckingAccounts}
              selectedAccountIds={tresoSelectedIds}
              onChangeAccountIds={setTresoAccountIds}
            />
          )}

          {activeTab === 'invest' && (<>
          <Text style={styles.sectionHint}>
            {isSimulationOnly
              ? `Simulation libre sur ${years} ans`
              : `Projection globale sur ${years} ans (tous comptes)`}
          </Text>

          {/* Pas encore de compte d'investissement : on explique les zéros et on montre la sortie. */}
          {isSimulationOnly && (
            <View style={styles.emptyCard}>
              <Ionicons name="flask-outline" size={20} color={COLORS.textSecondary} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.emptyTitle}>Tu n'as pas encore de compte d'investissement</Text>
                <Text style={styles.emptyText}>
                  Les montants ci-dessous partent donc de zéro. Renseigne un apport mensuel dans
                  « Hypothèses » pour simuler librement — ou crée un compte pour suivre ton vrai portefeuille.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/comptes/add')}
                  accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
                >
                  <Text style={[styles.emptyLink, { color: semanticText(INVEST_COLOR, COLORS) }]}>Créer un compte d'investissement</Text>
                  <Ionicons name="chevron-forward" size={14} color={semanticText(INVEST_COLOR, COLORS)} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Les hypothèses ne se chargent/enregistrent pas : on le DIT. Sans ce signal, l'écran
              repartait sur ses valeurs par défaut et les réglages saisis disparaissaient au
              prochain démarrage, sans que rien ne l'ait laissé deviner. */}
          {assumptionsQuery.isError ? (
            <View style={styles.warnCard}>
              <Ionicons name="cloud-offline-outline" size={16} color={COLORS.orange} />
              <Text style={styles.warnText}>
                Tes hypothèses enregistrées n'ont pas pu être chargées. Les valeurs affichées sont
                celles par défaut, et tes modifications ne seront pas conservées tant que la connexion
                n'est pas rétablie.
              </Text>
            </View>
          ) : saveAssumptions.isError ? (
            <View style={styles.warnCard}>
              <Ionicons name="cloud-offline-outline" size={16} color={COLORS.orange} />
              <Text style={styles.warnText}>
                Tes dernières modifications n'ont pas pu être enregistrées. Elles restent affichées ici,
                mais seront perdues si tu recharges l'application.
              </Text>
            </View>
          ) : null}

          {/* ── Suivi annuel ── */}
          {yearlyInvested > 0 && (
            <View style={[styles.kpiCard, { borderLeftColor: INVEST_COLOR, flexDirection: 'row', alignItems: 'center', marginBottom: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kpiLabel}>Investi en {currentYear}</Text>
                <Text style={[styles.kpiValue, { color: semanticText(INVEST_COLOR, COLORS) }]}>{fmt(yearlyInvested)}</Text>
                <Text style={styles.kpiSub}>apports et virements réels sur tes comptes invest</Text>
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
              <Text style={styles.kpiSub}>tes apports</Text>
            </View>
          </View>
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderLeftColor: SAVINGS_COLOR }]}>
              <Text style={styles.kpiLabel}>Plus-value nette</Text>
              <Text style={[styles.kpiValue, { color: semanticText(SAVINGS_COLOR, COLORS) }]}>{fmtSigned(investFinal?.netGainTotal ?? 0)}</Text>
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
                  {/* On surligne le compte RÉELLEMENT affiché (`selectedAcc`), pas l'identifiant
                      mémorisé : quand le compte sélectionné a été supprimé ailleurs dans l'app, les
                      champs retombent sur le premier compte mais AUCUNE puce n'était mise en avant
                      — on ne savait plus de quel compte on lisait les hypothèses. */}
                  {investAccounts.map((a) => {
                    const active = selectedAcc?.id === a.id;
                    return (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.accChip, active && { backgroundColor: INVEST_COLOR + '22', borderColor: INVEST_COLOR }]}
                        onPress={() => setSelectedAccId(a.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.accChipText, active && { color: INVEST_COLOR, fontWeight: '700' }]} numberOfLines={1}>{a.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {selectedAcc && selHypo && (
              <>
                <View style={styles.valueBadge}>
                  <Text style={styles.valueBadgeLabel}>Valeur actuelle</Text>
                  <Text style={styles.valueBadgeValue}>{fmt(selectedAcc.balance)}</Text>
                </View>
                {/* `key` = compte + compteur de réinitialisation : voir `hypoNonce`. Elle garantit
                    qu'un champ ne conserve jamais une frappe faite sur un AUTRE compte. */}
                <View style={styles.fieldRow}>
                  <NumField key={`ct-${selectedAcc.id}-${hypoNonce}`} label="Apport existant" value={selHypo.contributed} onChange={(v) => updateHypo(selectedAcc.id, { contributed: v, contributedBase: autoContributedFor(selectedAcc) })} suffix={CURRENCY_SYMBOL} colors={COLORS} />
                  <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 10 }}>
                    <Text style={styles.miniHint}>Plus-value = valeur − apport.</Text>
                  </View>
                </View>
                <View style={styles.fieldRow}>
                  <NumField
                    key={`mo-${selectedAcc.id}-${hypoNonce}`}
                    label="Apport mensuel" suffix={CURRENCY_SYMBOL} colors={COLORS}
                    // Affiché au centime près (et non arrondi à l'euro) : un apport annuel de 100 €
                    // vaut 8,33 €/mois, pas 8 € — et l'arrondi se répercutait sur l'apport annuel
                    // dès qu'on touchait ce champ.
                    value={monthlyFromAnnual(selHypo.annual)}
                    onChange={(v) => updateHypo(selectedAcc.id, { annual: String(Math.round(num(v) * 12)) })}
                  />
                  <NumField
                    key={`an-${selectedAcc.id}-${hypoNonce}`}
                    label="Apport annuel" suffix={CURRENCY_SYMBOL} colors={COLORS}
                    value={selHypo.annual}
                    onChange={(v) => updateHypo(selectedAcc.id, { annual: v })}
                  />
                </View>
                <View style={styles.fieldRow}>
                  {/* Champs de POURCENTAGE : 3 décimales (un rendement de 7,125 % existe), là où un
                      montant s'arrête à 2. */}
                  <NumField key={`ra-${selectedAcc.id}-${hypoNonce}`} label="Rendement /an" value={selHypo.rate} onChange={(v) => updateHypo(selectedAcc.id, { rate: v })} suffix="%" colors={COLORS} sanitize={sanitizeRateInput} />
                  <NumField key={`tx-${selectedAcc.id}-${hypoNonce}`} label="Fiscalité (gains)" value={selHypo.tax} onChange={(v) => updateHypo(selectedAcc.id, { tax: v })} suffix="%" colors={COLORS} sanitize={sanitizeRateInput} />
                </View>
                {/* La fiscalité est bornée à 100 % par le moteur : on le DIT, au lieu de calculer
                    en silence autre chose que ce que le champ affiche. */}
                {num(selHypo.tax) > 100 && (
                  <View style={[styles.fiscalNote, { borderColor: COLORS.orange + '55', backgroundColor: COLORS.orange + '12' }]}>
                    <Ionicons name="alert-circle-outline" size={14} color={COLORS.orange} />
                    <Text style={[styles.fiscalNoteText, { color: COLORS.orange }]}>
                      Une fiscalité ne peut pas dépasser 100 % : la projection calcule avec 100 %.
                    </Text>
                  </View>
                )}
                {noteFor(fiscalRates, (selectedAcc as any).envelope) && (
                  <View style={styles.fiscalNote}>
                    <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.fiscalNoteText}>{noteFor(fiscalRates, (selectedAcc as any).envelope)}</Text>
                  </View>
                )}
                {/* Plafond de VERSEMENTS de l'enveloppe (ex. PEA : 150 000 €) — sensibilisation, jamais bloquant. */}
                {(() => {
                  const cap = depositCapFor((selectedAcc as any).envelope);
                  if (!cap) return null;
                  const contributed = num(selHypo.contributed);
                  const annual = num(selHypo.annual);
                  if (contributed >= cap) {
                    return (
                      <View style={[styles.fiscalNote, { borderColor: COLORS.orange + '55', backgroundColor: COLORS.orange + '12' }]}>
                        <Ionicons name="alert-circle-outline" size={14} color={COLORS.orange} />
                        <Text style={[styles.fiscalNoteText, { color: COLORS.orange }]}>
                          Plafond de versements atteint ({fmt(cap)}) : de nouveaux apports ne sont plus possibles sur cette enveloppe — pense à un CTO ou une assurance-vie pour la suite.
                        </Text>
                      </View>
                    );
                  }
                  if (annual > 0) {
                    const yearsToCap = (cap - contributed) / annual;
                    if (yearsToCap <= years) {
                      const capYear = new Date().getFullYear() + Math.ceil(yearsToCap);
                      return (
                        <View style={[styles.fiscalNote, { borderColor: COLORS.orange + '55', backgroundColor: COLORS.orange + '12' }]}>
                          <Ionicons name="alert-circle-outline" size={14} color={COLORS.orange} />
                          <Text style={[styles.fiscalNoteText, { color: COLORS.orange }]}>
                            À ce rythme, le plafond de versements ({fmt(cap)}) sera atteint vers {capYear}. Au-delà, les apports devront aller sur une autre enveloppe (CTO, assurance-vie…) — la projection reste indicative.
                          </Text>
                        </View>
                      );
                    }
                  }
                  return null;
                })()}
              </>
            )}

            {/* Durée globale */}
            <Text style={styles.fieldLabel}>Durée (globale)</Text>
            <View style={styles.chipRow}>
              {YEAR_CHOICES.map((yy) => (
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
                    {/* Ces trois colonnes peuvent être négatives (compte en moins-value) : le signe
                        vient du nombre, pas d'un « + » écrit en dur. Et la couleur suit le sens. */}
                    <Text style={[styles.td, { width: 92, color: r.gainLatent < 0 ? COLORS.danger : SAVINGS_COLOR }]}>{fmtSigned(r.gainLatent)}</Text>
                    <Text style={[styles.td, { width: 88, color: r.netGainAnnual < 0 ? COLORS.danger : SAVINGS_COLOR }]}>{fmtSigned(r.netGainAnnual)}</Text>
                    <Text style={[styles.td, { width: 96, color: r.netGainMonthly < 0 ? COLORS.danger : SAVINGS_COLOR }]}>{fmtSigned(r.netGainMonthly)}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
          </>)}

          {/* ═══════ ÉPARGNE ═══════ */}
          {activeTab === 'epargne' && (<>
          <Text style={styles.sectionHint}>Combien auras-tu selon ton rythme d'épargne</Text>

          <View style={styles.sourceRow}>
            {([
              { id: 'reel', label: 'Réel', val: realMonthlySavings, empty: realMonthlySavings <= 0 },
              { id: 'questionnaire', label: 'Questionnaire', val: questionnaireMonthlySavings, empty: questionnaireMonthlySavings <= 0 },
              { id: 'perso', label: 'Personnalisé', val: num(savingsMonthlyPerso), empty: false },
            ] as const).map((s) => {
              const active = savingsSource === s.id;
              /* Une source VIDE se choisit pas — sauf si c'est celle qui est active. Un utilisateur
                 qui avait choisi « Réel » puis cessé d'épargner pendant 12 mois se retrouvait devant
                 une puce à la fois SÉLECTIONNÉE et GRISÉE, sans plus aucun moyen d'en changer
                 l'apparence ni d'en comprendre le 0 €. */
              const disabled = s.empty && !active;
              return (
                <TouchableOpacity
                  key={s.id} disabled={disabled}
                  style={[styles.sourceChip, active && { backgroundColor: SAVINGS_COLOR + '22', borderColor: SAVINGS_COLOR }, disabled && { opacity: 0.4 }]}
                  onPress={() => setSavingsSource(s.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled }}
                >
                  <Text style={[styles.sourceLabel, active && { color: SAVINGS_COLOR, fontWeight: '700' }]}>{s.label}</Text>
                  <Text style={styles.sourceVal}>{fmt(s.val)}/mois</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Le capital de DÉPART entre dans tous les totaux, quelle que soit la source choisie —
              mais il n'était visible (et modifiable) que dans « Personnalisé ». On lisait donc, en
              « Réel » ou « Questionnaire », des montants gonflés par un capital invisible, parfois
              saisi à la main des mois plus tôt. Il est désormais toujours affiché. */}
          <View style={styles.controlsCard}>
            <View style={styles.fieldRow}>
              {savingsSource === 'perso' ? (
                <NumField label="Épargne /mois" value={savingsMonthlyPerso} onChange={(v) => { setSavingsMonthlyPerso(v); markProjectionEdited(); }} suffix={CURRENCY_SYMBOL} colors={COLORS} />
              ) : (
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Épargne /mois</Text>
                  {/* Lecture seule : la valeur vient de la source choisie (Réel / Questionnaire).
                      Style dédié — `fieldInput` porte des propriétés propres au champ de saisie web
                      (`width: 0`, suppression du contour) qui n'ont pas de sens sur un texte. */}
                  <View style={[styles.fieldInputWrap, { paddingVertical: 9 }]}>
                    <Text style={styles.fieldReadonly} numberOfLines={1}>{Math.round(savingsMonthly).toLocaleString('fr-FR')}</Text>
                    <Text style={styles.fieldSuffix}>{CURRENCY_SYMBOL}</Text>
                  </View>
                </View>
              )}
              <NumField label="Déjà épargné" value={savingsInitial} onChange={(v) => { setSavingsInitial(v); markProjectionEdited(); }} suffix={CURRENCY_SYMBOL} colors={COLORS} />
            </View>
            {/* Réinitialisation au solde actuel des comptes épargne (§N9) */}
            {Math.round(num(savingsInitial)) !== Math.round(realSavings) && (
              <TouchableOpacity
                style={styles.savingsResetLink}
                activeOpacity={0.7}
                accessibilityRole="button"
                onPress={() => { setSavingsInitial(String(Math.round(realSavings))); markProjectionEdited(); }}
              >
                <Ionicons name="refresh" size={13} color={COLORS.emerald} />
                <Text style={styles.savingsResetText}>Réinitialiser à ton solde réel ({fmt(realSavings)})</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Source active à 0 €/mois : les cartes ci-dessous ne montrent alors que le capital de
              départ qui fructifie. On le dit, plutôt que de laisser croire à une projection morte. */}
          {savingsMonthly <= 0 && (
            <View style={styles.warnCard}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.orange} />
              <Text style={styles.warnText}>
                {savingsSource === 'reel'
                  ? "Aucun virement vers l'épargne détecté sur les 12 derniers mois : la projection n'ajoute rien chaque mois."
                  : savingsSource === 'questionnaire'
                    ? "Tes réponses au questionnaire n'indiquent aucune épargne mensuelle."
                    : "Renseigne un montant mensuel pour voir ton épargne progresser."}
                {savingsSource !== 'perso' ? ' Choisis « Personnalisé » pour saisir ton rythme.' : ''}
              </Text>
            </View>
          )}
          {/* Ce que compte VRAIMENT `estimateMonthlySavings` : les virements sortants d'un compte
              courant vers un compte d'épargne. Le texte annonçait « virements ET apports » alors que
              les apports directs sur un livret sont explicitement écartés (ce sont le plus souvent
              des initialisations de compte) — l'utilisateur cherchait donc un écart inexistant. */}
          {savingsSource === 'reel' && realMonthlySavings > 0 && (
            <Text style={styles.realHint}>💡 Moyenne lissée sur 12 mois de tes virements depuis un compte courant vers l'épargne, hors initialisation de compte.</Text>
          )}
          {savingsSource === 'questionnaire' && questionnaireMonthlySavings > 0 && (
            <Text style={styles.realHint}>💡 Estimé depuis tes réponses au questionnaire ({fmt(questionnaireMonthlySavings)}/mois).</Text>
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
          {/* L'hypothèse de rendement était INVISIBLE : le total dépassait « capital de départ +
              épargné » sans que rien ne l'explique. Une projection qui ne dit pas sur quoi elle
              repose n'est pas vérifiable. Le capital de départ est nommé pour la même raison :
              c'est la seconde moitié de l'écart entre « Épargné » et le total. */}
          <Text style={styles.realHint}>
            Départ : {fmt(num(savingsInitial))}, puis {fmt(savingsMonthly)}/mois, avec un rendement
            supposé de {SAVINGS_ANNUAL_RATE_PCT} %/an (ordre de grandeur d'un livret réglementé).
            « Épargné » est la somme de tes versements, sans le capital de départ ni les intérêts.
          </Text>
          </>)}

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <AdSlot placement="projection" />

          <View style={{ height: 40 }} />
        </KeyboardAwareScrollView>
      </SafeAreaView>

      <CalculatorButton page="projection" />
    </View>
  );
}

// Version animable du tracé + des points (révélation de la courbe mois par mois).
/**
 * `Animated.createAnimatedComponent` injecte `collapsable={false}` — une prop INTERNE de React
 * Native (optimisation de vues Android). Le shim web de react-native-svg ne la filtre pas et la
 * transmet telle quelle à l'élément SVG du DOM, qui ne la connaît pas : React avertit à chaque
 * rendu.
 *
 * Le contournement existait, mais recopié à la main sur `Path` uniquement — et `Circle`, ajouté
 * ensuite, l'a naturellement oublié. Une enveloppe UNIQUE le rend impossible : tout élément SVG
 * qu'on veut animer passe par elle.
 */
function animatedSvg<P extends object>(Cmp: React.ComponentType<P>, name: string) {
  const Filtered = React.forwardRef<any, any>(
    ({ collapsable, ...rest }, ref) => <Cmp ref={ref} {...(rest as P)} />,
  );
  Filtered.displayName = name;
  return Animated.createAnimatedComponent(Filtered);
}
const AnimatedPath = animatedSvg(Path, 'SvgPathWeb');
const AnimatedCircle = animatedSvg(Circle, 'SvgCircleWeb');
// Ne jouer l'animation qu'UNE fois par session d'app (comme les colonnes Relyka).
let projectionCurveAnimated = false;

/** Chemin LISSÉ (spline Catmull-Rom → béziers cubiques) passant par les points. */
function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Pas d'échelle « joli » (1 / 2 / 5 × 10ⁿ) pour ~6 graduations. */
function niceStep(range: number): number {
  const rough = Math.max(1, range) / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

/* ── Courbe des soldes prévus en CÔNE d'incertitude (ligne médiane lissée + bande ±σ) ──
 * incertitude(mois m) = σ_variables × √m × facteur_confiance. La bande s'élargit avec l'horizon. */
function BalanceCurve({ rows, width, COLORS, marginAmount = 0, sigma = 0, confidenceFactor = 1 }: {
  rows: { label: string; balance: number; isCurrent: boolean }[];
  width: number;
  COLORS: any;
  marginAmount?: number;
  sigma?: number;
  confidenceFactor?: number;
}) {
  const [sel, setSel] = React.useState<number | null>(null);
  /* Révélation progressive de la courbe (0 → 1), une fois par session.
     ⚠️ On n'attaque QUE lorsqu'il y a réellement quelque chose à tracer. L'effet se déclenchait au
     premier montage — c'est-à-dire pendant que les transactions se chargeaient encore, donc sur un
     graphe vide (`rows.length < 2` : la fonction sort plus bas sans rien rendre). Il consommait
     alors le drapeau « déjà joué » et faisait courir les 1150 ms dans le vide : quand les données
     arrivaient enfin, `draw` valait déjà 1 et la courbe surgissait d'un coup. L'animation ne se
     voyait donc à peu près jamais. */
  const ready = rows.length >= 2 && width > 0;
  const draw = React.useRef(new Animated.Value(projectionCurveAnimated ? 1 : 0)).current;
  React.useEffect(() => {
    if (!ready || projectionCurveAnimated) return;
    projectionCurveAnimated = true;
    const anim = Animated.timing(draw, {
      toValue: 1,
      duration: 1150,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false, // props SVG animées → pas de driver natif
    });
    anim.start();
    return () => anim.stop();
  }, [draw, ready]);
  if (!ready) return null;
  const h = 220;
  const padL = 34, padR = 12, padT = 8, padB = 22;
  const usableW = width - padL - padR;
  const usableH = h - padT - padB;
  const uncAt = (i: number) => (sigma > 0 && i > 0 ? sigma * Math.sqrt(i) * confidenceFactor : 0);
  const upperV = rows.map((r, i) => r.balance + uncAt(i));
  const lowerV = rows.map((r, i) => r.balance - uncAt(i));
  const hasBand = sigma > 0;
  const hasMargin = marginAmount > 0;

  // Échelle Y « propre » (graduations rondes).
  const rawMin = Math.min(0, ...lowerV, hasMargin ? marginAmount : Infinity);
  const rawMax = Math.max(...upperV, hasMargin ? marginAmount : -Infinity, 1);
  const step = niceStep(rawMax - rawMin);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step || step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += step) ticks.push(v);

  const x = (i: number) => padL + (i / (rows.length - 1)) * usableW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * usableH;

  const centralPts = rows.map((r, i) => ({ x: x(i), y: y(r.balance) }));
  const upperPts = upperV.map((v, i) => ({ x: x(i), y: y(v) }));
  const lowerPts = lowerV.map((v, i) => ({ x: x(i), y: y(v) }));
  const centralD = smoothLine(centralPts);
  // Longueur approx. de la ligne (polyligne ×1.03 pour la marge des courbes) → tracé animé.
  let polyLen = 0;
  for (let i = 1; i < centralPts.length; i++) {
    polyLen += Math.hypot(centralPts[i].x - centralPts[i - 1].x, centralPts[i].y - centralPts[i - 1].y);
  }
  const pathLen = Math.max(1, polyLen * 1.03);
  const dashOffset = draw.interpolate({ inputRange: [0, 1], outputRange: [pathLen, 0] });
  // Bande = borne haute lissée (aller) + borne basse lissée (retour).
  const bandD = hasBand
    ? `${smoothLine(upperPts)} L ${lowerPts[lowerPts.length - 1].x} ${lowerPts[lowerPts.length - 1].y} `
      + `${smoothLine([...lowerPts].reverse()).replace(/^M/, 'L')} Z`
    : '';
  const shortMonth = (lbl: string) => lbl.split(' ')[0].slice(0, 4);
  const crossIdx = hasMargin && hasBand ? rows.findIndex((_r, i) => lowerV[i] < marginAmount && i > 0) : -1;

  const LegendItem = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 14, height: dashed ? 0 : 10, borderRadius: 3, backgroundColor: dashed ? undefined : color,
        borderTopWidth: dashed ? 2 : 0, borderTopColor: color, borderStyle: 'dashed' }} />
      <Text style={{ fontSize: 10.5, color: COLORS.textSecondary, fontWeight: '600' }}>{label}</Text>
    </View>
  );

  const h100 = (n: number) => Math.round(n / 100) * 100;
  const tipFor = (i: number) => {
    const b = rows[i].balance, u = uncAt(i);
    return u > 0.5
      ? `${h100(b - u).toLocaleString('fr-FR')}–${h100(b + u).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
      : `${Math.round(b).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
  };

  return (
    <View>
      <View style={{ width, height: h }}>
        <Svg width={width} height={h}>
          {/* Grille + graduations Y */}
          {ticks.map((t, i) => (
            <React.Fragment key={`t${i}`}>
              <Line x1={padL} y1={y(t)} x2={width - padR} y2={y(t)} stroke={COLORS.cardBorder} strokeWidth={1} opacity={0.4} />
              <SvgText x={padL - 6} y={y(t) + 3} fill={COLORS.textSecondary} fontSize="9" textAnchor="end">{fmtK(t)}</SvgText>
            </React.Fragment>
          ))}
          {/* Cône d'incertitude */}
          {hasBand && <Path d={bandD} fill={COLORS.blue} opacity={0.16} />}
          {/* Marge de sécurité */}
          {hasMargin && (
            <Line x1={padL} y1={y(marginAmount)} x2={width - padR} y2={y(marginAmount)} stroke={COLORS.orange} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.95} />
          )}
          {/* Ligne médiane lissée — tracée progressivement (dashoffset animé) */}
          <AnimatedPath
            d={centralD}
            stroke={COLORS.blue}
            strokeWidth={2.5}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={pathLen}
            strokeDashoffset={dashOffset}
          />
          {rows.map((r, i) => {
            const cx = x(i), cy = y(r.balance);
            const selected = sel === i;
            // Chaque point apparaît quand le tracé « passe » dessus.
            const t = i / (rows.length - 1);
            const dotOpacity = draw.interpolate({
              inputRange: [Math.max(0, t - 0.06), t],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            });
            return (
              <React.Fragment key={i}>
                <AnimatedCircle cx={cx} cy={cy} r={selected ? 6 : r.isCurrent ? 4.5 : 3} fill={selected || r.isCurrent ? COLORS.blue : COLORS.bg} stroke={COLORS.blue} strokeWidth={2} opacity={dotOpacity} />
                <SvgText x={cx} y={h - 6} fill={r.isCurrent ? COLORS.blue : COLORS.textSecondary} fontSize="10" fontWeight={r.isCurrent ? '800' : '600'} textAnchor="middle">
                  {shortMonth(r.label)}
                </SvgText>
              </React.Fragment>
            );
          })}
          {/* Tooltip (montant / fourchette) du point sélectionné — un seul à la fois */}
          {sel != null && (() => {
            const cx = x(sel), cy = y(rows[sel].balance);
            const label = tipFor(sel);
            const w = Math.max(48, label.length * 6.3);
            const bx = Math.min(Math.max(cx - w / 2, padL), width - padR - w);
            const by = Math.max(padT, cy - 26);
            const tipX = Math.min(Math.max(cx, bx + 8), bx + w - 8); // pointe clampée dans la bulle
            return (
              <React.Fragment>
                <Rect x={bx} y={by} width={w} height={18} rx={6} fill={COLORS.cardSolid ?? COLORS.card} stroke={COLORS.cardBorder} strokeWidth={1} />
                {/* Pointe de la bulle vers le point sélectionné */}
                <Path d={`M ${tipX - 5} ${by + 17.5} L ${tipX + 5} ${by + 17.5} L ${tipX} ${by + 23} Z`} fill={COLORS.cardSolid ?? COLORS.card} stroke={COLORS.cardBorder} strokeWidth={1} />
                <SvgText x={bx + w / 2} y={by + 12.5} fill={COLORS.text} fontSize="10.5" fontWeight="800" textAnchor="middle">{label}</SvgText>
              </React.Fragment>
            );
          })()}
        </Svg>
        {/* Zones tactiles NATIVES par-dessus les points (les événements SVG sont peu fiables web/natif).
            Leur largeur suit l'ÉCART entre deux points : à 36 px fixes, l'horizon 12 mois (≈26 px
            d'écart) faisait se chevaucher les zones voisines, et c'était toujours le point le plus à
            droite — dessiné en dernier — qui captait le toucher. On sélectionnait donc un autre mois
            que celui visé. */}
        {rows.map((r, i) => {
          const hitW = Math.max(16, Math.min(36, usableW / Math.max(1, rows.length - 1)));
          return (
            <TouchableOpacity
              key={`hit${i}`}
              style={{ position: 'absolute', left: x(i) - hitW / 2, top: y(r.balance) - 18, width: hitW, height: 36 }}
              activeOpacity={0.6}
              onPress={() => setSel(sel === i ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={`Solde prévu ${r.label} : ${tipFor(i)}`}
            />
          );
        })}
      </View>

      {/* Légende SOUS le graphe (sous les mois) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8, paddingLeft: 4 }}>
        <LegendItem color={COLORS.blue} label="Solde prévu" />
        {hasBand && <LegendItem color={COLORS.blue + '55'} label="Fourchette probable" />}
        {hasMargin && <LegendItem color={COLORS.orange} label={`Marge de sécurité (${fmt(marginAmount)})`} dashed />}
      </View>

      {crossIdx > 0 && (
        <Text style={{ fontSize: 11.5, color: COLORS.orange, fontWeight: '600', marginTop: 4, paddingHorizontal: 4, lineHeight: 16 }}>
          ⚠️ Dans le scénario le plus bas, tu passes sous ta marge en {rows[crossIdx].label}.
        </Text>
      )}
    </View>
  );
}

// ── Trésorerie simplifiée : liste de mois (revenus / dépenses / variables / solde prévu) ──
function TresoSimplified({ transactions, accounts, pilotage, overridesMap, COLORS, styles, onOpenDetail, horizon, onChangeHorizon, checkingAccounts, selectedAccountIds, onChangeAccountIds }: {
  transactions: any[]; accounts: any[]; pilotage: any; overridesMap: Record<string, number>; COLORS: any; styles: any; onOpenDetail: () => void;
  horizon: 6 | 12; onChangeHorizon: (v: 6 | 12) => void;
  /** Comptes courants proposés au filtre (le filtre ne porte que sur eux). */
  checkingAccounts: any[];
  /** Comptes retenus — liste VIDE = « Tous ». */
  selectedAccountIds: string[];
  onChangeAccountIds: (ids: string[]) => void;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
  const [showAccountFilter, setShowAccountFilter] = useState(false);
  // Un seul compte courant : le filtre n'aurait rien à trancher, on ne montre pas le bouton.
  const canFilterAccounts = checkingAccounts.length > 1;
  const filterActive = selectedAccountIds.length > 0;
  const toggleAccount = (id: string) => {
    const next = selectedAccountIds.includes(id)
      ? selectedAccountIds.filter((x) => x !== id)
      : [...selectedAccountIds, id];
    /* Tout décocher = « Tous », et non « aucun compte ». Une prévision vide n'est pas une réponse :
       on retombe sur l'état par défaut, qui est lisible. */
    onChangeAccountIds(next);
  };
  const { width: winW } = useWindowDimensions();
  // La largeur du graphe se MESURE sur son conteneur (`onLayout` plus bas) : sur le web, l'app vit
  // dans une colonne centrée, donc partir de la largeur de FENÊTRE faisait déborder la courbe hors
  // de la carte. La valeur initiale n'est qu'un repli pour la 1ʳᵉ frame — bornée à la largeur de
  // colonne réelle (MAX_W.dashboard) plutôt qu'à une constante qui avait cessé d'être la bonne.
  const [chartWidth, setChartWidth] = useState(() => Math.max(0, Math.min(winW, MAX_W.dashboard) - 32 - 24));
  const variableMonthly = pilotage?.variable_envelope_initial ?? 0;
  const variableRemaining = pilotage?.variable_envelope_remaining ?? variableMonthly;

  /* Calcul partagé avec le garde-fou marge du moteur de recos (une seule trajectoire).
     Horizon 6 (défaut) ou 12 mois, choisi par l'utilisateur (persisté).
     MÉMOÏSÉ : la fonction balaie toutes les transactions une fois par mois projeté (jusqu'à 12).
     Sans ça, elle repartait de zéro à chaque rendu du composant — dont ceux déclenchés par la
     simple mesure de la largeur du graphe, ou par un rafraîchissement du Pilotage en arrière-plan. */
  const rows = useMemo(
    () => computeTresoRows({ transactions, accounts, overridesMap, variableMonthly, variableRemaining, monthsCount: horizon }),
    [transactions, accounts, overridesMap, variableMonthly, variableRemaining, horizon],
  );

  // σ_variables : VRAI écart-type des dépenses variables (mois fiables, hors estimated) ;
  // repli = fraction de l'enveloppe si historique insuffisant.
  const sigma = useMemo(() => {
    const real = pilotage?.variable_sigma ?? 0;
    return real > 0 ? real : 0.25 * (pilotage?.variable_envelope_initial ?? 0);
  }, [pilotage?.variable_sigma, pilotage?.variable_envelope_initial]);

  // Facteur d'élargissement du cône selon le niveau de doute (fonction de doute UNIQUE de l'app).
  const confidenceFactor = useMemo(() => {
    const ci = pilotage?.confidence_inputs;
    if (!ci) return 1;
    const conf = computeConfidence({
      today: new Date(), lastVerifiedAt: ci.lastVerifiedAt ?? null, lastActivityAt: ci.lastActivityAt ?? null,
      calibration: ci.calibration ?? null,
      relyka: pilotage?.safe_to_spend ?? 0, floorBase: ci.floorBase ?? 0, config: resolveReliabilityConfig(null),
    });
    return conf.level === 'high' ? 1 : conf.level === 'medium' ? 1.6 : 2.2;
  }, [pilotage?.confidence_inputs, pilotage?.safe_to_spend]);

  return (
    <View>
      {/* Le bouton « plan détaillé » et le filtre partagent la même ligne : le filtre qualifie ce
          qu'on est en train de lire, il doit se voir sans défiler. */}
      <View style={styles.tresoActionRow}>
        <TouchableOpacity style={[styles.tresoDetailBtn, { flex: 1, marginTop: 0, marginBottom: 0 }]} onPress={onOpenDetail} activeOpacity={0.8}>
          <Ionicons name="grid-outline" size={16} color={COLORS.blue} />
          <Text style={[styles.tresoDetailBtnText, { color: COLORS.blue }]} numberOfLines={1}>Voir le plan de trésorerie détaillé</Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.blue} />
        </TouchableOpacity>
        {canFilterAccounts && (
          <TouchableOpacity
            style={[styles.tresoFilterBtn, filterActive && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}
            onPress={() => setShowAccountFilter((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAccountFilter }}
            accessibilityLabel={filterActive
              ? `Filtrer par compte courant — ${selectedAccountIds.length} compte${selectedAccountIds.length > 1 ? 's' : ''} sélectionné${selectedAccountIds.length > 1 ? 's' : ''}`
              : 'Filtrer par compte courant'}
          >
            <Ionicons name="filter" size={18} color={filterActive ? '#fff' : COLORS.textSecondary} />
            {/* Compteur DANS le bouton (cf. page Transactions) : une pastille débordante se fait
                rogner sur Android quand le parent a un rayon de bordure. */}
            {filterActive && <Text style={styles.tresoFilterCount}>{selectedAccountIds.length}</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Panneau déplié SUR PLACE (pas une feuille venue du bas) : on garde sous les yeux la
          prévision qu'on est en train de filtrer. */}
      {canFilterAccounts && showAccountFilter && (
        <View style={styles.tresoFilterPanel}>
          <View style={styles.tresoFilterHead}>
            <Text style={styles.tresoFilterTitle}>Comptes courants</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {filterActive && (
                <TouchableOpacity onPress={() => onChangeAccountIds([])} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.tresoFilterReset, { color: COLORS.blue }]}>Tout effacer</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setShowAccountFilter(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer les filtres">
                <Ionicons name="close" size={19} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.tresoFilterChips}>
            <TouchableOpacity
              style={[styles.tresoFilterChip, !filterActive && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}
              onPress={() => onChangeAccountIds([])}
              accessibilityRole="button"
              accessibilityState={{ selected: !filterActive }}
            >
              <Text style={[styles.tresoFilterChipText, !filterActive && { color: '#fff', fontWeight: '700' }]}>Tous</Text>
            </TouchableOpacity>
            {checkingAccounts.map((acc: any) => {
              const selected = selectedAccountIds.includes(acc.id);
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.tresoFilterChip, selected && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}
                  onPress={() => toggleAccount(acc.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.tresoFilterChipText, selected && { color: '#fff', fontWeight: '700' }]} numberOfLines={1}>{acc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Ce que le filtre ne SAIT PAS faire, dit franchement. Les dépenses variables sont une
              ESTIMATION globale (enveloppe du mois) : elles ne sont rattachées à aucun compte, on ne
              peut donc pas les répartir. Les compter en entier sur un seul compte rend la prévision
              prudente — mais il faut le savoir pour lire le solde prévu. */}
          {filterActive && (
            <Text style={styles.tresoFilterNote}>
              Les dépenses variables estimées ne sont pas rattachées à un compte : elles restent
              comptées en entier. Le solde prévu est donc prudent.
            </Text>
          )}
        </View>
      )}
      {/* Courbe d'évolution des soldes prévus (points marqués) — au-dessus du 1er mois */}
      <View style={[styles.chartCard, { marginTop: 0, alignItems: 'stretch' }]}>
        {/* La bascule d'horizon (persistée) vit dans l'en-tête du graphique : elle qualifie l'axe des
            abscisses, et n'occupe plus une rangée entière au-dessus. */}
        <View style={styles.chartHeader}>
          {/* « de trésorerie » répétait l'onglet actif : titre raccourci pour loger la bascule. */}
          <Text style={[styles.chartTitle, { marginBottom: 0, flexShrink: 1 }]} numberOfLines={1}>Prévision des soldes</Text>
          <View style={styles.horizonPills}>
            {([6, 12] as const).map((h) => {
              const active = horizon === h;
              return (
                <TouchableOpacity
                  key={h}
                  style={[styles.horizonPill, active && { backgroundColor: COLORS.blue }]}
                  onPress={() => onChangeHorizon(h)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Horizon ${h} mois`}
                >
                  <Text style={[styles.horizonPillText, { color: active ? '#fff' : COLORS.textSecondary }]}>{h} mois</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View
          style={{ alignItems: 'center', overflow: 'hidden' }}
          onLayout={(e) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            if (w > 0 && w !== chartWidth) setChartWidth(w);
          }}
        >
          <BalanceCurve
            rows={rows}
            width={chartWidth}
            COLORS={COLORS}
            marginAmount={pilotage?.safety_margin_amount ?? 0}
            sigma={sigma}
            confidenceFactor={confidenceFactor}
          />
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
              // « Départ » laissait entendre « début du mois ». C'est le solde D'AUJOURD'HUI : il
              // contient déjà tout ce qui s'est passé depuis le 1er.
              <Text style={[styles.tresoStartBalance, { color: COLORS.textSecondary }]}>
                Aujourd'hui : {fmt(r.startBalance)} {CURRENCY_SYMBOL}
              </Text>
            )}
          </View>
          <View style={styles.tresoMonthBody}>
            {/* ── MOIS COURANT : on montre ce qui RESTE à venir ──────────────────────────────────
                Le solde d'aujourd'hui contient déjà le passé du mois. En affichant à côté de lui
                les totaux PLEINS (passé + à venir), l'addition ne pouvait pas tomber juste :
                l'utilisateur lisait « aujourd'hui 1 200 € », « revenus +2 500 », « dépenses −1 800 »
                et un solde prévu qui ne correspondait à rien de calculable.
                Avec la part restante, la carte redevient vérifiable de tête :
                    aujourd'hui + revenus − dépenses − variables + autre = solde prévu. */}
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>{r.isCurrent ? 'Revenus à venir' : 'Revenus'}</Text>
              <Text style={[styles.tresoVal, { color: COLORS.green }]}>+{fmt(r.isCurrent ? r.incomeRemaining : r.income)} {CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>{r.isCurrent ? 'Dépenses à venir' : 'Dépenses prévues'}</Text>
              <Text style={[styles.tresoVal, { color: COLORS.danger }]}>−{fmt(r.isCurrent ? r.expenseRemaining : r.expense)} {CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.tresoMonthRow}>
              <Text style={styles.tresoKey}>{r.isCurrent ? 'Variables (reste estimé)' : 'Dépenses variables (est.)'}</Text>
              <Text style={[styles.tresoVal, { color: COLORS.orange }]}>−{fmt(r.variable)} {CURRENCY_SYMBOL}</Text>
            </View>
            {(() => {
              // Zéro n'a pas de signe : « −0 € » se lisait comme une sortie.
              const other = r.isCurrent ? r.otherRemaining : r.other;
              const rounded = Math.round(other);
              return (
                <View style={styles.tresoMonthRow}>
                  <Text style={styles.tresoKey}>Autre (épargne, invest, projets)</Text>
                  <Text style={[styles.tresoVal, { color: rounded > 0 ? COLORS.green : rounded < 0 ? COLORS.violet : COLORS.textSecondary }]}>
                    {rounded > 0 ? '+' : rounded < 0 ? '−' : ''}{fmt(Math.abs(other))} {CURRENCY_SYMBOL}
                  </Text>
                </View>
              );
            })()}
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

    // État vide (aucun compte d'investissement) et avertissements de synchronisation.
    emptyCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 14,
    },
    emptyTitle: { fontSize: 13, fontWeight: '700', color: c.text },
    emptyText: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    emptyLink: { fontSize: 12, fontWeight: '700' },
    warnCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12,
      backgroundColor: c.orange + '12', borderRadius: 12, borderWidth: 1, borderColor: c.orange + '55', padding: 12,
    },
    warnText: { flex: 1, fontSize: 12, color: c.orange, lineHeight: 17 },

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
    // Valeur affichée sans saisie possible, alignée sur `fieldInput` (même taille, même graisse).
    fieldReadonly: { flex: 1, minWidth: 0, color: c.textSecondary, fontSize: 16, fontWeight: '700' },
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
    tresoDetailBtnText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
    // ── Filtre par compte courant (onglet Trésorerie) ──
    tresoActionRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 14 },
    tresoFilterBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    tresoFilterCount: { fontSize: 11.5, fontWeight: '800', color: '#fff', includeFontPadding: false },
    tresoFilterPanel: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
    tresoFilterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    tresoFilterTitle: { fontSize: 13, fontWeight: '800', color: c.text },
    tresoFilterReset: { fontSize: 13, fontWeight: '600' },
    // Les puces s'enroulent : un nom de compte long ne doit pas pousser les autres hors de l'écran.
    tresoFilterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tresoFilterChip: { maxWidth: '100%', height: 36, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    tresoFilterChipText: { fontSize: 13, color: c.text, fontWeight: '500', includeFontPadding: false },
    tresoFilterNote: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 12 },
    // En-tête du graphique : titre à gauche, bascule d'horizon à droite.
    chartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
    horizonPills: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder },
    horizonPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
    horizonPillText: { fontSize: 11.5, fontWeight: '700' },
  });
}
