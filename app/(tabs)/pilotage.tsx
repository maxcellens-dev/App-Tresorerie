import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity, RefreshControl, Modal, TextInput, findNodeHandle, Pressable } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import PageIntroModal from '../../components/PageIntroModal';
import OnboardingHintBanner from '../../components/OnboardingHintBanner';
import MonthlyClosure from '../../components/MonthlyClosure';
import { useMonthlyClosure } from '../../hooks/useMonthlyClosure';
import { useTransactions } from '../../hooks/useTransactions';
import { tabRect } from '../../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../../lib/onbHighlight';
import { useUpdateOnboarding } from '../../hooks/useOnboarding';
import { supabase } from '../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { usePilotageData } from '../../hooks/usePilotageData';
import { signalAppReady } from '../../lib/splashGate';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useAccounts } from '../../hooks/useAccounts';
import { usePreSavings, useAddPreSavingEntry, useResetPreSaving, useSetPreSavingStatus } from '../../hooks/usePreSavings';
import { useReservations, useSetMonthlyReservation } from '../../hooks/useReservations';
import { useReleaseReservedByProject } from '../../hooks/useTransactions';
import { useRecoThresholds } from '../../hooks/useRecoThresholds';
import RecommendationCard from '../../components/RecommendationCard';
import ConseilsBanner from '../../components/ConseilsBanner';
import { usePilotageTips } from '../../hooks/useUiPrefs';
import AdSlot from '../../components/AdSlot';
import { useProjects } from '../../hooks/useProjects';
import { useCategories } from '../../hooks/useCategories';
import PreSavingsModal from '../../components/PreSavingsModal';
import CumulsPanel from '../../components/CumulsPanel';
import CategoryDonut from '../../components/CategoryDonut';
import { iconForTransaction, iconForCategory } from '../../lib/categoryIcons';
import { computeRecommendations, getCurrentTier, TIER_LABELS, TIER_COLORS, resolveConsumptionMode, getConsumptionOrder } from '../../lib/recommendationEngine';
import type { SmartRecommendation } from '../../lib/recommendationEngine';
import type { PreSavingType } from '../../types/database';
import { useRecommendationTiers } from '../../hooks/useRecommendationTiers';
import { useFinancialProfile } from '../../hooks/useFinancialProfile';
import { useAutoProfileEvaluation } from '../../hooks/useFinancialProfile';
import type { FinancialProfileId } from '../../types/database';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';
import { useAppColors } from '../../hooks/useAppColors';
import type { AppColors } from '../../theme/palette';
import { semanticText, pastelFill } from '../../theme/palette';
import { CURRENCY_SYMBOL, floorToTen, convertAmount } from '../../lib/currency';
import { useCurrencyRates } from '../../hooks/useCurrencyRates';

/** Divise par 2 l'alpha d'une couleur rgb(a)/hex (#RRGGBBAA) — pour atténuer un fond translucide. */
function halfAlpha(color: string): string {
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  if (rgba) {
    const a = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${(a / 4).toFixed(3)})`;
  }
  const hex8 = /^(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/.exec(color);
  if (hex8) return hex8[1] + Math.round(parseInt(hex8[2], 16) / 4).toString(16).padStart(2, '0');
  const hex6 = /^#[0-9A-Fa-f]{6}$/.test(color);
  if (hex6) return color + '80'; // opaque → 50 %
  return color;
}

/** Remplissage des curseurs « Dépenses » à opacité RÉDUITE de moitié (pastelFill ≈ 60 % → ~30 %). */
function halfFill(hex: string): string {
  const full = pastelFill(hex); // '#RRGGBBAA'
  const m = /^(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/.exec(full);
  if (!m) return full;
  const a = Math.round(parseInt(m[2], 16) / 4);
  return m[1] + a.toString(16).padStart(2, '0');
}

/** Assombrit une couleur hex (#RRGGBB) vers le noir d'un facteur 0-1 (pour les encadrés « accent plus foncé »). */
function darken(hex: string, factor: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const f = Math.min(1, Math.max(0, factor));
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - f));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - f));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - f));
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function PilotageScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const COLORS = useAppColors();
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  const { enabled: tipsEnabled } = usePilotageTips(user?.id);
  const onbReserved = useOnbHighlight('reserved_consulted');
  const onbReco = useOnbHighlight('reco_validated');
  const [refreshing, setRefreshing] = useState(false);

  // Données principales
  const queryClient = useQueryClient();
  const pilotageQuery = usePilotageData(user?.id);

  // À chaque fois qu'on (re)vient sur le Pilotage, on rafraîchit les données qui pilotent les recos.
  // Garantit que tout changement fait sur un autre écran (prudence du budget, nouvelle dépense…) est
  // reflété immédiatement : nouveau budget/dépassement (pilotage_data) + nouvelle prudence (profile).
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      queryClient.invalidateQueries({ queryKey: ['pilotage_data', user.id] });
      queryClient.invalidateQueries({ queryKey: ['profile', user.id] });
      queryClient.invalidateQueries({ queryKey: ['recommendation_settings'] });
    }, [user?.id, queryClient]),
  );
  const { data: projectsForConseils = [] } = useProjects(user?.id);
  const { data: txForConseils = [] } = useTransactions(user?.id);
  const { data: categoriesList = [] } = useCategories(user?.id);
  // Map nom de (sous-)catégorie → nom de la catégorie PARENTE (pour regrouper les récurrentes par catégorie).
  const catParentName = useMemo(() => {
    const byId: Record<string, any> = {};
    for (const c of categoriesList as any[]) byId[c.id] = c;
    const map: Record<string, string> = {};
    for (const c of categoriesList as any[]) {
      const parentName = c.parent_id && byId[c.parent_id] ? byId[c.parent_id].name : c.name;
      if (c.name) map[String(c.name).toLowerCase()] = parentName;
    }
    return map;
  }, [categoriesList]);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const showClosure = closureEnabled && pendingMonths.length > 0;
  const { data: customTiers } = useRecommendationTiers();
  const { data: financialProfile } = useFinancialProfile(user?.id);
  const autoEval = useAutoProfileEvaluation(user?.id);

  // ── Données recos évoluées : cumuls, réservations, seuils, comptes ──
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: recoThresholds } = useRecoThresholds();
  const addPreSaving = useAddPreSavingEntry(user?.id);
  const resetPreSaving = useResetPreSaving(user?.id);
  const setPreSavingStatus = useSetPreSavingStatus(user?.id);
  const setMonthlyReservation = useSetMonthlyReservation(user?.id);

  // Modale pré-épargne/pré-invest + panneau cumuls
  const [preModal, setPreModal] = useState<PreSavingType | null>(null);
  const [preModalAmount, setPreModalAmount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showReservedModal, setShowReservedModal] = useState(false);
  // Modaux détail du « Suivi du mois » (toutes les zones sont cliquables, §3)
  const [detailKey, setDetailKey] = useState<'checking' | 'savings' | 'invest' | 'spent' | 'planned' | 'relyka' | null>(null);
  const [plannedTab, setPlannedTab] = useState<'recurrentes' | 'variables'>('recurrentes');
  const [showTroughInfo, setShowTroughInfo] = useState(false); // popup « point bas de trésorerie » (§N8)
  const [spentFilter, setSpentFilter] = useState<string | null>(null); // filtre sous-catégorie du camembert (§N2)
  const [recurFilter, setRecurFilter] = useState<string | null>(null); // filtre catégorie du camembert des récurrentes
  const releaseReserved = useReleaseReservedByProject(user?.id);
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const openReservedModal = () => { setShowReservedModal(true); updateOnboarding.mutate({ flags: { reserved_consulted: true } }); };
  // Modale de saisie de l'estimation hebdo des dépenses variables (alimente q9)
  const { data: profile } = useProfile(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [weeklyVariableInput, setWeeklyVariableInput] = useState('');
  const updateProfileVar = useUpdateProfile(user?.id);
  // Modale d'édition de la marge de sécurité (comme dans Paramètres → profiles.safety_margin_amount)
  const [showMarginModal, setShowMarginModal] = useState(false);
  const [marginInput, setMarginInput] = useState('');

  const fmtMain = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
  const preEpargneTotal = preSavings?.epargne.total_cumule ?? 0;
  const preInvestTotal = preSavings?.invest.total_cumule ?? 0;
  // Réservations « Conserver pour plus tard » : seulement celles du mois courant (réinitialisé chaque mois).
  const reservationsTotal = React.useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return reservations
      .filter((r) => (r.created_at ?? '').slice(0, 7) === monthKey)
      .reduce((s, r) => s + Number(r.montant), 0);
  }, [reservations]);

  // Compte courant principal (solde le plus élevé) + présence des comptes cibles
  const mainCheckingId = [...accounts]
    .filter((a) => a.type === 'checking')
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id;
  const hasSavingsAccount = accounts.some((a) => a.type === 'savings');
  const hasInvestmentAccount = accounts.some((a) => a.type === 'investment');

  // ── Guide "bulles" ──
  const guide = useScreenGuide('pilotage', user?.id);
  const scrollRef = React.useRef<ScrollView>(null);
  const reservedRef = React.useRef<any>(null);
  const overviewRef = React.useRef<View>(null); // conservé pour compatibilité guide
  const suiviRef = React.useRef<View>(null);
  const monthRef = React.useRef<View>(null);
  const projectsObjectivesRef = React.useRef<View>(null);

  // Scroll vers la zone mise en évidence par le guide « Pour bien démarrer ».
  React.useEffect(() => {
    const target = onbReco ? monthRef : onbReserved ? reservedRef : null;
    if (!target) return;
    const t = setTimeout(() => {
      const node = scrollRef.current ? findNodeHandle(scrollRef.current) : null;
      if (node && target.current?.measureLayout) {
        target.current.measureLayout(node, (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
        }, () => {});
      }
    }, 350);
    return () => clearTimeout(t);
  }, [onbReco, onbReserved]);

  const PILOTAGE_GUIDE: BubbleStep[] = [
    {
      getRect: () => tabRect(2),
      icon: 'home',
      iconColor: COLORS.green,
      title: 'Onglet Pilotage',
      description: 'Touchez « Pilotage » dans la barre du bas : c\'est votre tableau de bord.',
    },
    {
      getRef: () => suiviRef,
      icon: 'wallet-outline',
      iconColor: COLORS.green,
      title: 'Suivi du mois',
      description: 'Vos engagements du mois (épargne, investissement, réservé) et vos dépenses. En bas, le « Budget libre à allouer » : ce qu\'il vous reste à dépenser librement.',
    },
    {
      getRef: () => monthRef,
      icon: 'bulb-outline',
      iconColor: '#f59e0b',
      title: 'Recommandations',
      description: 'Des conseils personnalisés selon votre profil financier pour optimiser votre mois : épargne, investissement, réserve…',
    },
  ];

  // Évaluation automatique mensuelle (silencieuse, 1er du mois)
  React.useEffect(() => {
    if (financialProfile) autoEval.mutate();
  }, [financialProfile?.last_auto_evaluation]);

  const { data: pilotageData, isLoading: pilotageLoading, error: pilotageError } = pilotageQuery;
  const isLoading = pilotageLoading;

  // Signale au splash animé que la page de destination est prête (données chargées, ou erreur) →
  // il ne s'efface qu'à ce moment, jamais sur le cercle de chargement de pilotage.
  React.useEffect(() => {
    if (pilotageData || pilotageError) signalAppReady();
  }, [pilotageData, pilotageError]);

  // Messages contextuels des recos (projection invest, économie…) — activables en admin (défaut : oui).
  const { data: featureFlags } = useFeatureFlags();
  const recoContextEnabled = featureFlags?.reco_context_enabled !== false;

  // ── Reste disponible = Courant − tout ce qui est affiché ──
  // Formule directe depuis les valeurs affichées pour cohérence avec l'UI.
  const cumulsTotal = preEpargneTotal + preInvestTotal;
  const safetyMarginDisplay = pilotageData?.safety_margin_amount ?? 0;
  // Enveloppe variable restante (estimation des dépenses variables non encore engagées ce mois)
  const variableEnvelopeRemaining = pilotageData?.variable_envelope_remaining ?? 0;
  // Budget libre : on déduit uniquement ce qui n'est pas encore sorti du solde courant
  // (épargne/invest déjà validée est déjà reflétée dans current_checking_balance).
  // Épargne / Investissement : on déduit la part FUTURE (non encore sortie du solde) pour
  // éviter de recompter les virements déjà passés (déjà reflétés dans le solde courant).
  const savingsRemaining = pilotageData?.month_savings_future ?? 0;
  const investRemaining = pilotageData?.month_invest_future ?? 0;
  // Dépenses : seules les dépenses à venir (date > aujourd'hui) sont déduites.
  // Les dépenses déjà passées sont déjà dans le solde courant → affichées en info uniquement.
  const monthExpensesRemaining = pilotageData?.month_expenses_remaining ?? 0;
  const monthExpensesPast = pilotageData?.month_expenses_past ?? 0;
  // « Reste à vivre » (Option B) : on part du solde courant à date et on ne déduit
  // QUE ce qui n'est pas encore sorti du compte (à venir / non exécuté) + la marge.
  const monthIncomeRemaining = pilotageData?.month_income_remaining ?? 0;
  // Budget libre = POINT BAS de trésorerie d'ici la prochaine rentrée (revenus + dépenses réelles,
  // dans l'ordre des dates → on ne libère JAMAIS un revenu pas encore reçu). On en retire ensuite
  // les engagements volontaires (virements épargne/invest prévus, réservations), la marge et
  // l'enveloppe de dépenses variables estimée (qui, elle, n'est pas une transaction).
  const cashflowTrough = pilotageData?.cashflow_trough ?? (pilotageData?.current_checking_balance ?? 0);
  // Les cumuls manuels (pré-épargne / pré-invest) sont de l'argent « réservé mentalement »
  // en attente de virement → on les retire aussi du budget libre (Relyka) tant qu'ils ne sont
  // pas libérés ou transformés en virement (auquel cas ils sont remis à 0 et déduits via les
  // virements). Ils apparaissent également dans la ligne « Réservé » du Suivi du mois.
  const resteDisponible = Math.max(0,
    cashflowTrough
    - savingsRemaining
    - investRemaining
    - (pilotageData?.monthly_reserve_planned ?? 0)
    - reservationsTotal
    - cumulsTotal
    - variableEnvelopeRemaining
    - safetyMarginDisplay
  );
  const baseADepenser = pilotageData?.safe_to_spend ?? 0;
  const enDepassement = cumulsTotal > baseADepenser && baseADepenser > 0;

  // ── Budget de recommandation (§P7) ──
  // Budget BRUT invariant = argent libre AVANT répartition volontaire (= point bas − dépenses
  // variables estimées − marge). Il ne bouge PAS quand on cumule/réserve : on déduit ensuite
  // SPÉCIFIQUEMENT de chaque catégorie ce qui y a déjà été affecté (`alreadyAllocated`).
  // → cumuler 411 € d'invest met la reco invest à 0 sans toucher la reco « plaisir ».
  const recoGrossBudget = Math.max(0, cashflowTrough - variableEnvelopeRemaining - safetyMarginDisplay);
  // Dépassement de l'enveloppe variable : ce qui a été dépensé en plus des dépenses variables
  // habituelles estimées (l'enveloppe restante est alors à 0). Ce surplus grignote les recos en
  // cascade (« Confort » d'abord) au lieu de réduire toutes les recos au prorata.
  const variableOverspend = Math.max(0,
    (pilotageData?.variable_envelope_spent ?? 0) - (pilotageData?.variable_envelope_initial ?? 0),
  );
  // Budget « enveloppe juste atteinte » : on rajoute le dépassement (le moteur le re-déduira en
  // cascade). Quand il n'y a pas de dépassement, ce budget est identique à recoGrossBudget.
  const recoBaselineBudget = recoGrossBudget + variableOverspend;
  // Ordre de consommation selon la prudence du budget (Auto → dérivé du profil financier).
  const consumptionMode = resolveConsumptionMode(
    ((profile as any)?.prudence_level ?? null) as number | null,
    financialProfile?.profile_id as FinancialProfileId | undefined,
    recoThresholds?.auto_profile_map,
  );
  const consumptionOrder = getConsumptionOrder(consumptionMode, recoThresholds?.consumption_orders);
  const recoAlreadyAllocated = {
    // Épargne / invest : virements prévus ce mois (non exécutés) + cumuls fléchés.
    save: savingsRemaining + preEpargneTotal,
    invest: investRemaining + preInvestTotal,
    // Conserver : réservations + réservé projets du mois (PAS les cumuls épargne/invest).
    keep: reservationsTotal + (pilotageData?.monthly_reserve_planned ?? 0),
  };
  // Couleur d'affichage par type de reco — alignée sur les couleurs sémantiques du thème
  // (clair/sombre) plutôt que sur les teintes fixes de l'engine, qui restaient trop claires
  // en mode clair (ex. épargne #34d399 au lieu du vert défini #059669).
  const recoColorByType: Record<string, string> = {
    save:   COLORS.green,
    invest: COLORS.violet,
    enjoy:  COLORS.orange,
    keep:   COLORS.blue,
  };
  // Garde-fou : aucune reco ne peut dépasser le reste réellement disponible (Ton Relyka).
  const recoList = pilotageData
    ? computeRecommendations(pilotageData, {
        customTierAllocations: customTiers,
        financialProfileId: financialProfile?.profile_id as FinancialProfileId | undefined,
        budget: recoBaselineBudget,
        alreadyAllocated: recoAlreadyAllocated,
        thresholds: recoThresholds,
        overspend: variableOverspend,
        consumptionOrder,
      }).map((r) => ({
        ...r,
        color: recoColorByType[r.type] ?? r.color,
        // Plafonné au reste réellement disponible, lui aussi arrondi à la dizaine inférieure
        // (cohérent avec l'affichage « Ton Relyka »). r.amount est déjà arrondi par le moteur.
        amount: Math.min(r.amount, Math.max(0, floorToTen(resteDisponible))),
      }))
    : [];

  // ── Détails du « Suivi du mois » (listes pour les modaux au clic, §3) ──
  const suiviDetail = React.useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = `${monthPrefix}-${String(now.getDate()).padStart(2, '0')}`;
    const typeById: Record<string, string> = {};
    accounts.forEach((a) => { typeById[a.id] = a.type; });
    const checkingIds = new Set(accounts.filter((a) => a.type === 'checking').map((a) => a.id));
    const inMonth = (d: string) => (d ?? '').slice(0, 7) === monthPrefix;

    const savings: any[] = [], invest: any[] = [], spent: any[] = [], recurrentes: any[] = [];
    for (const t of txForConseils as any[]) {
      const amt = Number(t.amount);
      const src = typeById[t.account_id];
      const linked = t.linked_account_id ? typeById[t.linked_account_id] : null;
      const draft = Boolean(t.is_draft);
      const recurring = Boolean(t.is_recurring) && Boolean(t.recurrence_rule);
      const isProjectDraft = draft && !!t.project_id;
      // Virements épargne / investissement du mois : récurrents + futurs + brouillons de projet
      // inclus (comme le total affiché), on exclut les « conservés »/réservés.
      if (amt < 0 && linked && (!draft || isProjectDraft) && !t.is_reserved && (recurring || inMonth(t.date))) {
        if (linked === 'investment' && (src === 'checking' || src === 'savings')) invest.push(t);
        else if (linked === 'savings' && src === 'checking') savings.push(t);
      }
      // Vraies dépenses depuis un compte courant (hors virements / projets / régul)
      if (!t.linked_account_id && !t.project_id && checkingIds.has(t.account_id) && !draft) {
        const cat = t.category;
        // « Dépensé ce mois » = dépenses (catégorie de dépense) et remboursements (montant positif
        // sur une catégorie de dépense). Les recettes (catégorie income) sont exclues — §1.
        const isExpenseOrRefund = !cat || cat.type === 'expense';
        // On NE doit PAS exclure les réguls : un « Solde initial » / « régularisation » qui RÉDUIT le
        // solde (négatif) compte comme dépensé — exactement comme « Total dépensé » (month_expenses_past).
        // Seul exclu : un régul qui AUGMENTE le solde (catégorie nulle, montant positif) → pas une dépense.
        const isNamedRegul = !!(cat?.name && /r[ée]gularisation|ajustement de solde/i.test(cat.name));
        const isNullCatIncome = !cat && amt > 0;
        const isInMonth = inMonth(t.date) && t.date <= todayStr;
        if (isExpenseOrRefund && !isNamedRegul && !isNullCatIncome) {
          // Récurrentes actives (template) → liste récurrentes (pour le modal plannifié)
          if (recurring && amt < 0) recurrentes.push(t);
          // Toute dépense/remboursement passé(e) dans le mois → liste spent (modal « Dépensé ce mois »)
          // Inclut les récurrentes matérialisées (plus marquées recurring après migration 030).
          if (isInMonth) spent.push(t);
        }
      }
    }
    const byDateDesc = (a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? '');

    // Récurrentes du mois : total projeté + part déjà passée (pour le curseur passé/total, §N5).
    const y = now.getFullYear(), mo = now.getMonth() + 1, dToday = now.getDate();
    const daysInMonth = new Date(y, mo, 0).getDate();
    const monthStart = new Date(y, mo - 1, 1), monthEnd = new Date(y, mo, 0);
    // NB : la matérialisation (migration 030) avance la date du template après chaque occurrence
    // passée. On compte donc aussi le total quand le template a été avancé d'une période (= déjà
    // passé ce mois), pour que « total » = passées + futures.
    const thisIdx = y * 12 + (mo - 1);
    const recurForMonth = (t: any): { total: number; passed: number } => {
      const amt = Math.abs(Number(t.amount));
      const start = new Date((t.date ?? '').slice(0, 10) + 'T00:00:00');
      const end = t.recurrence_end_date ? new Date(String(t.recurrence_end_date).slice(0, 10) + 'T00:00:00') : null;
      if (end && end < monthStart) return { total: 0, passed: 0 };
      const rule = t.recurrence_rule;
      const startIdx = start.getFullYear() * 12 + start.getMonth();
      const day = Math.min(start.getDate(), daysInMonth);
      const single = (periodMonths: number) => {
        // Démarre trop loin dans le futur (au-delà d'une période = pas une avance de matérialisation).
        if (startIdx > thisIdx + periodMonths) return { total: 0, passed: 0 };
        const advanced = startIdx > thisIdx; // template avancé → occurrence de ce mois déjà passée
        return { total: amt, passed: advanced || day <= dToday ? amt : 0 };
      };
      if (rule === 'monthly') return single(1);
      if (rule === 'yearly') {
        if (start.getMonth() !== mo - 1) return { total: 0, passed: 0 };
        return single(12);
      }
      if (rule === 'quarterly') {
        if ((((thisIdx - startIdx) % 3) + 3) % 3 !== 0) return { total: 0, passed: 0 };
        return single(3);
      }
      if (rule === 'weekly') {
        let total = 0, passed = 0; const d = new Date(start);
        while (d < monthStart) d.setDate(d.getDate() + 7);
        while (d <= monthEnd && (!end || d <= end)) { total += amt; if (d.getDate() <= dToday) passed += amt; d.setDate(d.getDate() + 7); }
        if (total === 0 && startIdx > thisIdx) { total = amt * 4; passed = amt * 4; } // avancé hors du mois → ~4 passées
        return { total, passed };
      }
      return { total: 0, passed: 0 };
    };
    // On ne garde que les récurrences réellement actives CE mois (ex. une annuelle datée en juillet
    // ne compte pas en juin) → le modal et le curseur « dont récurrentes » affichent le même total.
    // `_monthTotal` / `_monthPassed` : montant projeté du mois et part déjà échue (pour griser les
    // occurrences à venir dans le modal et alimenter le filtre « À venir »).
    let recurringTotal = 0, recurringPassed = 0;
    const recurrentesApplicable: any[] = [];
    for (const t of recurrentes) {
      const r = recurForMonth(t);
      if (r.total <= 0) continue;
      recurringTotal += r.total;
      recurringPassed += r.passed;
      // Date d'occurrence DANS le mois courant (le template d'une récurrente échue est avancé au mois
      // suivant → sans ça le tri par date la renverrait tout en bas). Sert au tri ET à l'affichage.
      const startDay = new Date((t.date ?? '').slice(0, 10) + 'T00:00:00').getDate() || 1;
      const monthDate = `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(startDay, daysInMonth)).padStart(2, '0')}`;
      recurrentesApplicable.push({ ...t, _monthTotal: r.total, _monthPassed: r.passed, _monthDate: monthDate });
    }

    // Virements épargne / invest : on ne garde que l'occurrence DU mois courant (date dans le mois).
    // Un template récurrent dont la date est avancée au mois suivant (occurrence de ce mois déjà
    // matérialisée et affichée à part) est ainsi exclu → cohérent avec le curseur « Épargné / Investi ».
    const transferAppliesThisMonth = (t: any) => inMonth(t.date);

    return {
      checking: accounts.filter((a) => a.type === 'checking'),
      savings: savings.filter(transferAppliesThisMonth).sort(byDateDesc),
      invest: invest.filter(transferAppliesThisMonth).sort(byDateDesc),
      spent: spent.sort(byDateDesc),
      recurrentes: recurrentesApplicable.sort((a, b) => (b._monthDate ?? '').localeCompare(a._monthDate ?? '')),
      recurringTotal,
      recurringPassed,
    };
  }, [txForConseils, accounts]);

  // Synchroniser le statut des cumuls (actif / en_depassement)
  React.useEffect(() => {
    if (!preSavings) return;
    const wanted = enDepassement ? 'en_depassement' : 'actif';
    (['epargne', 'invest'] as PreSavingType[]).forEach((t) => {
      const row = preSavings[t];
      if (row.total_cumule > 0 && row.statut !== wanted) {
        setPreSavingStatus.mutate({ type: t, statut: wanted });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enDepassement, preSavings?.epargne.total_cumule, preSavings?.invest.total_cumule]);

  // Construit l'URL de virement pré-rempli (query-string fiable + retour vers Pilotage)
  const buildTransferUrl = (opts: {
    dest: 'savings' | 'investment'; amount: number; label: string;
    recoComplete?: string; resetPreSaving?: PreSavingType;
  }) => {
    // Le montant de reco est en devise de RÉFÉRENCE ; on le convertit dans la devise du compte
    // SOURCE (courant principal) pour pré-remplir le bon montant. Si la destination est dans une
    // autre devise, l'écran Virement demandera ensuite le « montant reçu » (au taux du jour).
    const refCode = profile?.currency_code ?? 'EUR';
    const srcCur = accounts.find((a) => a.id === mainCheckingId)?.currency || refCode;
    const amountSrc = convertAmount(opts.amount, refCode, srcCur, rates) ?? opts.amount;
    const q = new URLSearchParams({
      from: mainCheckingId ?? '',
      destType: opts.dest,
      amount: String(Math.round(amountSrc)),
      label: opts.label,
      origin: 'pilotage',
      ...(opts.recoComplete ? { recoComplete: opts.recoComplete } : {}),
      ...(opts.resetPreSaving ? { resetPreSaving: opts.resetPreSaving } : {}),
    });
    return `/(tabs)/comptes/transfer?${q.toString()}`;
  };

  const monthYearLabel = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // Étape « Suivre une recommandation » validée dès qu'on utilise un bouton de reco.
  const markRecoUsed = () => updateOnboarding.mutate({ flags: { reco_validated: true } });

  // Ouvrir le virement pré-rempli pour une reco épargne/invest
  const openRecoTransfer = (reco: SmartRecommendation, dest: 'savings' | 'investment') => {
    markRecoUsed();
    const label = dest === 'savings' ? 'Épargne' : 'Investissement';
    router.push(buildTransferUrl({ dest, amount: reco.amount, label: `${label} ${monthYearLabel()}`, recoComplete: reco.type }) as any);
  };

  // Ouvrir le virement global d'un cumul (depuis la modale)
  const openCumulTransfer = (type: PreSavingType, montant: number) => {
    setPreModal(null);
    const dest = type === 'epargne' ? 'savings' : 'investment';
    const label = type === 'epargne' ? 'Épargne' : 'Investissement';
    router.push(buildTransferUrl({ dest, amount: montant, label: `${label} ${monthYearLabel()} (cumul)`, resetPreSaving: type }) as any);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await pilotageQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading && !pilotageData) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safe} edges={['left', 'right']}>
          <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
        </SafeAreaView>
      </View>
    );
  }

  if (pilotageError || !pilotageData) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safe} edges={['left', 'right']}>
          <View style={styles.loader}>
            <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginBottom: 16 }}>
              {pilotageError ? `Erreur : ${(pilotageError as Error).message}` : 'Données indisponibles'}
            </Text>
            <TouchableOpacity onPress={() => pilotageQuery.refetch()}>
              <Text style={{ color: COLORS.emerald, textAlign: 'center' }}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScreenGradient />
      <PageIntroModal pageKey="pilotage" />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        {/* Bandeau marge de sécurité */}
        {(pilotageData.safety_margin_amount ?? 0) > 0 &&
         pilotageData.total_checking < (pilotageData.safety_margin_amount ?? 0) && (
          <View style={styles.safetyBanner}>
            <Ionicons name="warning-outline" size={18} color={COLORS.yellow} />
            <Text style={styles.safetyBannerText}>
              Vos comptes courants ({pilotageData.total_checking.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}) sont en dessous de votre marge de sécurité ({(pilotageData.safety_margin_amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}).
            </Text>
          </View>
        )}

        {/* Main Content */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.emerald}
              progressBackgroundColor={COLORS.card}
            />
          }
        >
          {/* Zone conseils / clôture (priorité à la clôture si mois en attente) */}
          {showClosure ? (
            <MonthlyClosure
              surplusEstimate={Math.max(0, variableEnvelopeRemaining) + Math.max(0, resteDisponible)}
              checkingAccounts={accounts.filter((a) => a.type === 'checking').map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance) }))}
            />
          ) : tipsEnabled ? (
            <ConseilsBanner
              userId={user?.id}
              pilotage={pilotageData}
              transactions={txForConseils}
              projects={projectsForConseils}
              accounts={accounts}
            />
          ) : null}

          {/* ═══════════ SECTION : « Ton Relyka » + Recommandations (carrousel) ═══════════
              Plus de titre « Recommandations » : la jauge Relyka est la 1ʳᵉ slide, les recos
              suivent. On garde uniquement l'accès aux cumuls en haut à droite. */}
          <View style={[styles.section, onbReco ? onbGlow(COLORS, true) : null]} ref={monthRef}>
            {/* Alerte de dépassement (§8) */}
            {enDepassement && (
              <View style={styles.overspendBox}>
                <Ionicons name="warning-outline" size={16} color={COLORS.danger} />
                <Text style={styles.overspendText}>
                  Vos réservations mentales dépassent votre reste disponible. Réduisez ou annulez un cumul.
                </Text>
              </View>
            )}

            <RecommendationCard
              hideTitle
              showRelykaSlide
              onOpenRelyka={() => setDetailKey('relyka')}
              // Montant affiché arrondi à la dizaine inférieure ; le détail « Ton Relyka » (au clic) garde le vrai calcul.
              relykaAmount={floorToTen(resteDisponible)}
              relykaColor={resteDisponible < 0 ? COLORS.danger : Math.round(resteDisponible) <= 0 ? COLORS.orange : COLORS.emerald}
              relykaMessage={
                resteDisponible < 0
                  ? 'Budget dépassé ce mois-ci — mieux vaut lever le pied sur les dépenses.'
                  : Math.round(resteDisponible) <= 0
                  ? (Math.round(Math.max(0, variableEnvelopeRemaining)) > 0
                      ? 'Ton Relyka est épuisé - tout ton argent est alloué, donc reste prudent.'
                      : 'Plus de marge ce mois — évite de dépenser avant ta prochaine rentrée d\'argent.')
                  : 'Voici ce qu\'il devrait te rester après tes dépenses habituelles. Utilise-le sagement, idéalement en suivant tes recommandations ;)'
              }
              recommendations={recoList}
              financials={recoContextEnabled && pilotageData ? { totalInvested: pilotageData.total_invested, currentChecking: pilotageData.current_checking_balance } : undefined}
              tierLabel={pilotageData ? TIER_LABELS[getCurrentTier(pilotageData)] : ''}
              tierColor={pilotageData ? TIER_COLORS[getCurrentTier(pilotageData)] : '#94a3b8'}
              hasSavingsAccount={hasSavingsAccount}
              hasInvestmentAccount={hasInvestmentAccount}
              onCreateAccount={() => router.push('/(tabs)/comptes/add')}
              onEpargner={(reco) => openRecoTransfer(reco, 'savings')}
              onInvestir={(reco) => openRecoTransfer(reco, 'investment')}
              onCumuler={(type, reco) => { markRecoUsed(); setPreModalAmount(reco.amount); setPreModal(type); }}
              reservedThisMonth={reservationsTotal}
              onReserver={(reco, amount) => {
                markRecoUsed();
                // `amount` = nouveau TOTAL conservé du mois (incluant cette reco) → on remplace.
                const monthYear = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                const newTotal = Math.round(amount ?? (reservationsTotal + reco.amount));
                setMonthlyReservation.mutate({ montant: newTotal, libelle: `Réservé ${monthYear}` });
              }}
            />

            {/* Cumuls en attente — bandeau (ouvre « Réservé » où on gère/saisit les cumuls, §N).
                Plus de bouton « Gérer » : tout le bandeau est cliquable. */}
            {(preEpargneTotal > 0 || preInvestTotal > 0) && (
              <TouchableOpacity style={[styles.cumulsBanner, { marginTop: -4, marginBottom: 0 }]} onPress={openReservedModal} activeOpacity={0.8}>
                {preEpargneTotal > 0 && (
                  <Text style={styles.cumulsBannerItem}>🛡 En attente d'épargne : {Math.round(preEpargneTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}</Text>
                )}
                {preInvestTotal > 0 && (
                  <Text style={styles.cumulsBannerItem}>📈 En attente d'invest : {Math.round(preInvestTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          {/* Bandeau pub (maison) — juste au-dessus du Suivi du mois (espace au-dessus réduit) */}
          <AdSlot placement="pilotage_suivi" style={{ marginTop: -18 }} />

          {/* ═══════════ SUIVI DU MOIS ═══════════ */}
          <View style={styles.section} ref={suiviRef}>
            <View style={[styles.sectionHeader, { justifyContent: 'space-between' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Suivi du mois</Text>
              </View>
              <View style={styles.monthPill}>
                <Text style={styles.monthPillText}>
                  {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                </Text>
              </View>
            </View>
            <View style={styles.sectionDivider} />

            <View style={styles.suiviSingleCard}>
            {(() => {
              const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
              const savings = pilotageData.month_savings_total ?? 0;
              const invest = pilotageData.month_invest_total ?? 0;
              // Réservé = réservations projets (même compte) + conservé du mois (recos) + cumuls manuels
              const reserve = pilotageData.monthly_reserve_planned + reservationsTotal + cumulsTotal;
              const safetyMargin = pilotageData.safety_margin_amount ?? 0;
              const checkingBalance = pilotageData.current_checking_balance ?? 0;
              // Dépenses (§N5) : 3 indicateurs.
              const depPast = monthExpensesPast; // dépensé ce mois (déjà passé)
              // Variables : reste estimé sur l'enveloppe (curseur inversé = restant / total estimé).
              const varRemaining = pilotageData.variable_envelope_remaining ?? 0;
              const varInitial = Math.max(varRemaining, pilotageData.variable_envelope_initial ?? 0);
              // Récurrentes : total projeté du mois + part déjà DÉPENSÉE (curseur = dépensé / total, monte au
              // fil du mois ; le dépensé ne peut pas dépasser le total attendu).
              const recurTotal = suiviDetail.recurringTotal ?? 0;
              const recurSpent = Math.min(recurTotal, suiviDetail.recurringPassed ?? 0);
              // Variables : tout le dépensé NON récurrent (= total dépensé − récurrentes passées). Monte de 0
              // jusqu'à l'estimé et peut le DÉPASSER (curseur plafonné à 100 %). Invariant : récur. + var. = total.
              const varSpent = Math.max(0, depPast - recurSpent);

              const rest = resteDisponible;

              // Accent « plus foncé » pour les encadrés (pills) : en clair on assombrit, en sombre on
              // garde la teinte (déjà lisible sur fond sombre).
              const isLight = COLORS.mode === 'light';
              const accentDeep = isLight ? darken(COLORS.emerald, 0.18) : COLORS.emerald;
              // « Ce mois » : % des DÉPENSES PRÉVUES ESTIMÉES (récurrentes du mois + enveloppe variable
              // estimée). Part de 0 %, peut DÉPASSER 100 % (dépassement) ; le curseur reste plafonné à 100 %.
              const plannedEstimated = recurTotal + varInitial;
              const spentPctRaw = plannedEstimated > 0 ? (depPast / plannedEstimated) * 100 : 0;
              const spentPct = Math.round(spentPctRaw);
              const spentFillW = Math.min(100, spentPctRaw);

              return (
                <View style={{ gap: 10 }}>
                  {/* 1. Solde courant actuel — label + « Prochaine recette » encadrés en accent foncé */}
                  <TouchableOpacity style={styles.suiviBlock} activeOpacity={0.7} onPress={() => setDetailKey('checking')}>
                    <View style={styles.accentPillRow}>
                      <View style={[styles.accentPill, { backgroundColor: accentDeep + '1F', borderColor: accentDeep + '55' }]}>
                        <MaterialCommunityIcons name="scale-balance" size={13} color={COLORS.text} />
                        <Text style={[styles.accentPillText, { color: COLORS.text, fontSize: 14 }]}>Solde courant actuel</Text>
                      </View>
                    </View>
                    <View style={styles.budgetValueRow}>
                      <Text style={[styles.suiviBlockValue, { color: COLORS.text }]}>{fmt(checkingBalance)}</Text>
                      {(pilotageData.month_income_remaining ?? 0) > 0 && (
                        <View style={styles.incomeInline}>
                          <Ionicons name="time" size={13} color={COLORS.text} />
                          <Text style={{ color: COLORS.text, flexShrink: 1 }} numberOfLines={2}>
                            <Text style={styles.accentPillText}>Prochaine recette </Text>
                            <Text style={styles.accentPillStrong}>+{fmt(pilotageData.month_income_remaining)}</Text>
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>

                  {/* 2. Épargné + Investi — mini-curseurs « identité » (couleur pleine si > 0 €, sinon gris clair) */}
                  <View style={styles.suiviRow2}>
                    {([
                      { key: 'savings', label: 'Épargné', value: savings, icon: 'shield', color: COLORS.green },
                      { key: 'invest', label: 'Investi', value: invest, icon: 'trending-up', color: COLORS.violet },
                    ] as const).map((b) => (
                      <TouchableOpacity key={b.key} style={styles.suiviCursorMini} activeOpacity={0.7} onPress={() => setDetailKey(b.key)}>
                        <View style={[styles.suiviCursorFill, { width: b.value > 0 ? '100%' : 0, backgroundColor: halfFill(b.color) }]} />
                        <View style={styles.suiviCursorContent}>
                          <View style={styles.suiviMiniHead}>
                            <Ionicons name={b.icon as any} size={16} color={b.color} />
                            <Text style={styles.suiviMiniLabel} numberOfLines={1}>{b.label}</Text>
                          </View>
                          <Text style={[styles.suiviMiniValue, { color: b.value > 0 ? semanticText(b.color, COLORS) : COLORS.textSecondary }]}>{fmt(b.value)}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.sectionDivider} />
                  {/* 3. Dépenses — « Ce mois » (montant + % des dépenses prévues) puis récurrentes / variables */}
                  <View style={styles.suiviBlock}>
                    <View style={styles.suiviBlockHead}>
                      <Ionicons name="card" size={18} color={COLORS.danger} />
                      <Text style={styles.suiviBlockTitle}>Dépenses du mois</Text>
                    </View>
                    {/* Ce mois : montant à gauche, % des dépenses prévues estimées à droite (curseur = % plafonné à 100 %) */}
                    <TouchableOpacity style={styles.depBandBig} activeOpacity={0.7} onPress={() => { setSpentFilter(null); setDetailKey('spent'); }}>
                      <View style={[styles.depBandFill, { width: `${spentFillW}%`, backgroundColor: halfFill(COLORS.danger) }]} />
                      <View style={styles.depBandBigContent}>
                        <Text style={styles.depBandBigLabel}>Total dépensé</Text>
                        <View style={styles.depBandBigRow}>
                          <Text style={[styles.depBandBigValue, { color: semanticText(COLORS.danger, COLORS) }]}>{fmt(depPast)}</Text>
                          <Text style={styles.depBandBigPct} numberOfLines={2}>{spentPct}% des dépenses prévues estimées</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    {/* Récurrentes + Variables prévues : montant à gauche, /total à droite (curseur = restant / total) */}
                    <View style={styles.suiviRow2}>
                      <TouchableOpacity style={styles.depMini} activeOpacity={0.7} onPress={() => { setRecurFilter(null); setPlannedTab('recurrentes'); setDetailKey('planned'); }}>
                        <View style={[styles.depBandFill, { width: `${recurTotal > 0 ? Math.min(100, (recurSpent / recurTotal) * 100) : 0}%`, backgroundColor: halfFill(COLORS.orange) }]} />
                        <View style={styles.depMiniContent}>
                          <Text style={styles.depMiniLabel} numberOfLines={1}>dont récurrentes</Text>
                          <View style={styles.depMiniValueRow}>
                            <Text style={[styles.depMiniValue, { color: semanticText(COLORS.orange, COLORS) }]}>{fmt(recurSpent)}</Text>
                            <Text style={styles.depMiniTotal}>/ {fmt(recurTotal)}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.depMini} activeOpacity={0.7} onPress={() => { setPlannedTab('variables'); setDetailKey('planned'); }}>
                        <View style={[styles.depBandFill, { width: `${varInitial > 0 ? Math.min(100, (varSpent / varInitial) * 100) : 0}%`, backgroundColor: halfFill(COLORS.yellow) }]} />
                        <View style={styles.depMiniContent}>
                          <Text style={styles.depMiniLabel} numberOfLines={1}>dont variables</Text>
                          <View style={styles.depMiniValueRow}>
                            <Text style={[styles.depMiniValue, { color: semanticText(COLORS.yellow, COLORS) }]}>{fmt(varSpent)}</Text>
                            <Text style={styles.depMiniTotal}>/ {fmt(varInitial)}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.sectionDivider} />
                  {/* 4. Réserve & Marge de sécurité — mini-curseurs « identité » */}
                  <View style={styles.suiviBlock}>
                    <Text style={[styles.suiviBlockTitle, { marginBottom: 2 }]}>Réserve & Marge de sécurité</Text>
                    <View style={styles.suiviRow2}>
                      <TouchableOpacity ref={reservedRef} style={[styles.suiviCursorMini, onbReserved ? onbGlow(COLORS, true) : null]} activeOpacity={0.7} onPress={openReservedModal}>
                        <View style={[styles.suiviCursorFill, { width: reserve > 0 ? '100%' : 0, backgroundColor: halfFill(COLORS.blue) }]} />
                        <View style={styles.suiviCursorContent}>
                          <View style={styles.suiviMiniHead}>
                            <Ionicons name="lock-closed" size={16} color={COLORS.blue} />
                            <Text style={styles.suiviMiniLabel} numberOfLines={1}>Réservé</Text>
                          </View>
                          <Text style={[styles.suiviMiniValue, { color: reserve > 0 ? semanticText(COLORS.blue, COLORS) : COLORS.textSecondary }]}>{fmt(reserve)}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.suiviCursorMini} activeOpacity={0.7} onPress={() => { setMarginInput(String(Math.round(safetyMargin))); setShowMarginModal(true); }}>
                        <View style={[styles.suiviCursorFill, { width: safetyMargin > 0 ? '100%' : 0, backgroundColor: halfFill(COLORS.teal) }]} />
                        <View style={styles.suiviCursorContent}>
                          <View style={styles.suiviMiniHead}>
                            <Ionicons name="shield" size={16} color={COLORS.teal} />
                            <Text style={styles.suiviMiniLabel} numberOfLines={1}>Marge sécu.</Text>
                          </View>
                          <Text style={[styles.suiviMiniValue, { color: safetyMargin > 0 ? semanticText(COLORS.teal, COLORS) : COLORS.textSecondary }]}>{fmt(safetyMargin)}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.sectionDivider} />
                  {/* 5. Ton Relyka — « Budget libre » encadré en accent foncé */}
                  <TouchableOpacity style={styles.suiviBlock} activeOpacity={0.7} onPress={() => setDetailKey('relyka')}>
                    <View style={styles.suiviBlockHead}>
                      <View style={styles.relykaTitleRow}>
                        <View style={[styles.accentPill, { backgroundColor: accentDeep + '1F', borderColor: accentDeep + '55' }]}>
                          <Ionicons name="sparkles" size={13} color={COLORS.text} />
                          <Text style={[styles.accentPillText, { color: COLORS.text, fontSize: 14 }]} numberOfLines={1}>Ton Relyka</Text>
                        </View>
                        <Text style={[styles.relykaTitle, { flexShrink: 1, fontSize: 12 }]} numberOfLines={1}>Budget libre</Text>
                      </View>
                    </View>
                    {/* « Ton Relyka » arrondi à la dizaine inférieure (proposition générique). Le détail au clic montre le vrai calcul. */}
                    <Text style={[styles.suiviBlockValue, { color: COLORS.text }]}>{floorToTen(rest).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
            </View>
          </View>

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <AdSlot placement="pilotage" />

        </ScrollView>
      </SafeAreaView>

      <GuideOverlay
        visible={guide.visible}
        steps={PILOTAGE_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(PILOTAGE_GUIDE.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Pilotage"
      />

      {/* Modale pré-épargne / pré-invest */}
      <PreSavingsModal
        visible={preModal !== null}
        type={preModal ?? 'epargne'}
        recoAmount={preModalAmount}
        total={preModal === 'invest' ? preInvestTotal : preEpargneTotal}
        base={baseADepenser}
        onClose={() => setPreModal(null)}
        onSave={(montant) => {
          if (preModal) addPreSaving.mutate({ type: preModal, montant });
          setPreModal(null);
        }}
        onCreateTransfer={(montant) => { if (preModal) openCumulTransfer(preModal, montant); }}
        onReset={() => { if (preModal) resetPreSaving.mutate(preModal); setPreModal(null); }}
      />

      {/* Panneau d'accès aux cumuls */}
      <CumulsPanel
        visible={panelOpen}
        epargneTotal={preEpargneTotal}
        investTotal={preInvestTotal}
        onClose={() => setPanelOpen(false)}
        onOpen={(type) => {
          setPanelOpen(false);
          setPreModalAmount(0);
          setPreModal(type);
        }}
      />

      {/* Modal des montants réservés */}
      <Modal visible={showReservedModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowReservedModal(false)}>
        <Pressable style={styles.reservedOverlay} onPress={() => setShowReservedModal(false)}>
          <Pressable style={styles.reservedSheet} onPress={() => {}}>
            <View style={styles.reservedHeader}>
              <Text style={styles.reservedTitle}>Montants réservés</Text>
              <TouchableOpacity onPress={() => setShowReservedModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {/* Conservé du mois (recommandations) */}
              {reservationsTotal > 0 && (
                <View style={styles.reservedProjectBlock}>
                  <View style={styles.reservedItem}>
                    <View style={[styles.reservedItemIcon, { backgroundColor: COLORS.yellow + '22' }]}>
                      <Ionicons name="hourglass-outline" size={16} color={COLORS.yellow} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservedItemName}>Conservé ce mois (recommandations)</Text>
                      <Text style={styles.reservedItemHint}>Se réinitialise chaque mois</Text>
                    </View>
                    <Text style={[styles.reservedItemAmount, { color: COLORS.yellow }]}>{fmtMain(reservationsTotal)}</Text>
                  </View>
                  <View style={styles.reservedActions}>
                    <TouchableOpacity
                      style={styles.reservedReleaseBtn}
                      activeOpacity={0.7}
                      onPress={() => { setMonthlyReservation.mutate({ montant: 0 }); }}
                    >
                      <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                      <Text style={styles.reservedReleaseText}>Libérer</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Cumuls manuels (pré-épargne / pré-invest) — TOUJOURS visibles (même à 0) pour
                  permettre la saisie manuelle. Tap → modale du cumul (ajout / reset / virement). */}
              <Text style={styles.reservedSectionLabel}>Cumuls (saisie manuelle)</Text>
              {([
                { type: 'epargne' as PreSavingType, label: 'Pré-épargne', total: preEpargneTotal, icon: 'shield-outline', color: COLORS.green },
                { type: 'invest' as PreSavingType, label: 'Pré-invest', total: preInvestTotal, icon: 'trending-up-outline', color: COLORS.violet },
              ]).map((c) => (
                <TouchableOpacity
                  key={c.type}
                  style={styles.reservedItem}
                  activeOpacity={0.7}
                  onPress={() => { setShowReservedModal(false); setPreModalAmount(0); setPreModal(c.type); }}
                >
                  <View style={[styles.reservedItemIcon, { backgroundColor: c.color + '22' }]}>
                    <Ionicons name={c.icon as any} size={16} color={c.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reservedItemName}>{c.label}</Text>
                    <Text style={styles.reservedItemHint}>
                      {c.total > 0 ? 'En attente de virement · appuyez pour gérer' : 'Appuyez pour ajouter un montant'}
                    </Text>
                  </View>
                  <Text style={[styles.reservedItemAmount, { color: c.total > 0 ? c.color : COLORS.textSecondary }]}>{fmtMain(c.total)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}

              {/* Réservé par projet */}
              {pilotageData.reserved_by_project.map((r) => (
                <View key={r.id} style={styles.reservedProjectBlock}>
                  <View style={styles.reservedItem}>
                    <View style={[styles.reservedItemIcon, { backgroundColor: COLORS.blue + '22' }]}>
                      <Ionicons name="bookmark" size={16} color={COLORS.blue} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservedItemName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.reservedItemHint}>Projet · réservé jusqu'à utilisation</Text>
                    </View>
                    <Text style={[styles.reservedItemAmount, { color: COLORS.blue }]}>{fmtMain(r.total)}</Text>
                  </View>
                  <View style={styles.reservedActions}>
                    <TouchableOpacity
                      style={styles.reservedReleaseBtn}
                      activeOpacity={0.7}
                      onPress={() => { releaseReserved.mutate(r.id); }}
                    >
                      <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                      <Text style={styles.reservedReleaseText}>Libérer</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reservedTransferBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        setShowReservedModal(false);
                        const q = new URLSearchParams({
                          from: r.source_account_id ?? '',
                          to: r.linked_account_id ?? '',
                          amount: String(Math.round(r.total)),
                          label: r.name,
                          origin: 'pilotage',
                          releaseProject: r.id,
                        });
                        router.push(`/(tabs)/comptes/transfer?${q.toString()}` as any);
                      }}
                    >
                      <Ionicons name="swap-horizontal" size={14} color={COLORS.green} />
                      <Text style={styles.reservedTransferText}>Créer un virement</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modaux détail du « Suivi du mois » (centrés, fermeture au tap extérieur, §3/§8) */}
      <Modal visible={detailKey !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setDetailKey(null)}>
        <Pressable style={styles.detailOverlay} onPress={() => setDetailKey(null)}>
          <Pressable style={styles.detailBox} onPress={() => {}}>
            {(() => {
              const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
              // Montant d'une transaction CONVERTI dans la devise de référence (comme les curseurs).
              // Sans ça, un virement cross-devises (ex. −999,50 ¥) s'affichait « 1000 € » au lieu de ≈ 6 €,
              // d'où l'écart modal/curseur sur Épargné / Investi / Dépensé.
              const refCode = profile?.currency_code ?? 'EUR';
              const curByAcc: Record<string, string> = {};
              accounts.forEach((a) => { curByAcc[a.id] = a.currency; });
              const toRefAmt = (amt: number, accountId: string) => convertAmount(amt, curByAcc[accountId] || refCode, refCode, rates) ?? amt;
              const toRef = (t: any) => toRefAmt(Math.abs(Number(t.amount)), t.account_id);
              // Dépensé récurrent / variable du mois (mêmes valeurs que les curseurs « dont … »).
              const recurSpentMonth = Math.min(suiviDetail.recurringTotal ?? 0, suiviDetail.recurringPassed ?? 0);
              const varSpentMonth = Math.max(0, (pilotageData.month_expenses_past ?? 0) - recurSpentMonth);
              const dts = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
              const lbl = (t: any) => t.note || t.category?.name || 'Opération';
              const titles: Record<string, string> = {
                checking: 'Budget courant actuel', savings: 'Épargne du mois', invest: 'Investissement du mois',
                spent: 'Dépensé ce mois', planned: 'Dépenses prévues restantes', relyka: 'Ton Relyka (Budget libre)',
              };
              const txList = (list: any[], color: string, empty: string, dim?: (t: any) => boolean) => (
                list.length === 0 ? <Text style={styles.detailEmpty}>{empty}</Text> :
                list.map((t, i) => {
                  // Remboursement = montant positif (argent qui revient) → vert avec « + ».
                  const amt = Number(t.amount);
                  const isRefund = amt > 0;
                  // « Grisé » = occurrence à venir (non encore échue) → non comptée dans le total.
                  const dimmed = dim ? dim(t) : false;
                  const valColor = dimmed ? COLORS.textSecondary : (isRefund ? semanticText(COLORS.green, COLORS) : color);
                  return (
                    <View key={t.id ?? i} style={[styles.detailRow, dimmed && { opacity: 0.5 }]}>
                      <Ionicons name={iconForTransaction(t) as any} size={16} color={isRefund && !dimmed ? semanticText(COLORS.green, COLORS) : COLORS.textSecondary} style={{ marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailRowLabel} numberOfLines={1}>{lbl(t)}</Text>
                        {/* Date de la transaction (au lieu de la périodicité). */}
                        <Text style={styles.detailRowSub}>{dts(t._monthDate ?? t.date)}{dimmed ? ' · à venir' : ''}</Text>
                      </View>
                      <Text style={[styles.detailRowValue, { color: valColor }]}>{(isRefund ? '+' : '') + fmt(toRef(t))}</Text>
                    </View>
                  );
                })
              );
              return (
                <>
                  <View style={styles.detailHeader}>
                    <Text style={styles.detailTitle}>{detailKey === 'planned' ? (plannedTab === 'recurrentes' ? 'Dépenses récurrentes' : 'Dépenses variables prévues restantes') : (detailKey ? titles[detailKey] : '')}</Text>
                    <TouchableOpacity onPress={() => setDetailKey(null)} style={{ padding: 4 }}>
                      <Ionicons name="close" size={22} color={COLORS.text} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                    {detailKey === 'checking' && (
                      <>
                        {suiviDetail.checking.map((a) => (
                          <View key={a.id} style={styles.detailRow}>
                            <Text style={[styles.detailRowLabel, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                            <Text style={[styles.detailRowValue, { color: COLORS.text }]}>{fmt(Number(a.balance))}</Text>
                          </View>
                        ))}
                        {(pilotageData.month_income_remaining ?? 0) > 0 && (
                          <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder }]}>
                            <Text style={[styles.detailRowLabel, { flex: 1 }]}>Recettes prévues restantes</Text>
                            <Text style={[styles.detailRowValue, { color: COLORS.green }]}>+{fmt(pilotageData.month_income_remaining)}</Text>
                          </View>
                        )}
                      </>
                    )}
                    {detailKey === 'savings' && txList(suiviDetail.savings, semanticText(COLORS.green, COLORS), 'Aucun virement d\'épargne ce mois.')}
                    {detailKey === 'invest' && txList(suiviDetail.invest, semanticText(COLORS.violet, COLORS), 'Aucun virement d\'investissement ce mois.')}
                    {detailKey === 'spent' && (() => {
                      // Répartition par CATÉGORIE PARENTE (camembert cliquable → filtre la liste, §N2)
                      const parentOf = (t: any) => {
                        const sub = t.category?.name || 'Autre';
                        return catParentName[String(sub).toLowerCase()] || sub;
                      };
                      const groups: Record<string, { key: string; total: number; icon: string; color: string }> = {};
                      for (const t of suiviDetail.spent) {
                        const key = parentOf(t);
                        (groups[key] ??= { key, total: 0, icon: iconForCategory(t.category), color: '' });
                        groups[key].total += toRef(t);
                      }
                      const palette = [COLORS.danger, COLORS.orange, COLORS.violet, COLORS.blue, COLORS.green, COLORS.teal, COLORS.yellow, COLORS.emerald, COLORS.checking];
                      const arr = Object.values(groups).sort((a, b) => b.total - a.total);
                      arr.forEach((g, i) => { g.color = palette[i % palette.length]; });
                      const totalSpent = arr.reduce((s, g) => s + g.total, 0);
                      const filtered = spentFilter ? suiviDetail.spent.filter((t) => parentOf(t) === spentFilter) : suiviDetail.spent;
                      return (
                        <>
                          {arr.length > 0 && (
                            <>
                              <View style={{ alignItems: 'center', marginBottom: 10 }}>
                                <CategoryDonut
                                  segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                                  size={150}
                                  strokeWidth={20}
                                  activeKey={spentFilter}
                                  centerLabel={fmt(spentFilter ? (groups[spentFilter]?.total ?? 0) : totalSpent)}
                                  centerColor={COLORS.text}
                                />
                              </View>
                              <View style={styles.pieLegend}>
                                {arr.map((g) => {
                                  const active = spentFilter === g.key;
                                  return (
                                    <TouchableOpacity
                                      key={g.key}
                                      style={[styles.pieLegendItem, active && { borderColor: g.color, backgroundColor: g.color + '1A' }]}
                                      onPress={() => setSpentFilter(active ? null : g.key)}
                                      activeOpacity={0.7}
                                    >
                                      <View style={[styles.pieDot, { backgroundColor: g.color }]} />
                                      <Ionicons name={g.icon as any} size={13} color={COLORS.textSecondary} />
                                      <Text style={styles.pieLegendText} numberOfLines={1}>{g.key}</Text>
                                      <Text style={[styles.pieLegendVal, { color: g.color }]}>{fmt(g.total)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                              <View style={styles.suiviDivider} />
                            </>
                          )}
                          {txList(filtered, semanticText(COLORS.danger, COLORS), 'Aucune dépense passée ce mois.')}
                        </>
                      );
                    })()}
                    {detailKey === 'planned' && (
                      <>
                        {plannedTab === 'recurrentes'
                          ? (() => {
                            // Échue (comptée) vs à venir (non échue ce mois) — `_monthPassed` = part déjà passée.
                            const UPCOMING_KEY = '__upcoming__';
                            const isUpcoming = (t: any) => (t._monthPassed ?? 0) <= 0;
                            const parentName = (t: any) => catParentName[String(t.category?.name || 'Autre').toLowerCase()] || (t.category?.name || 'Autre');
                            const viewingUpcoming = recurFilter === UPCOMING_KEY;
                            // Montant compté (échu) / à venir (non échu) de chaque récurrence, en devise de réf.
                            const passedAmt = (t: any) => toRefAmt(t._monthPassed ?? 0, t.account_id);
                            const upcomingAmt = (t: any) => toRefAmt(Math.max(0, (t._monthTotal ?? 0) - (t._monthPassed ?? 0)), t.account_id);
                            // Donut : par défaut les ÉCHUES (= ce qui est compté) ; les à-venir n'y figurent QUE
                            // si l'on sélectionne le filtre « À venir ».
                            const donutSource = suiviDetail.recurrentes.filter((t) => (viewingUpcoming ? isUpcoming(t) : !isUpcoming(t)));
                            const amtOf = viewingUpcoming ? upcomingAmt : passedAmt;
                            const groups: Record<string, { key: string; total: number; icon: string; color: string }> = {};
                            for (const t of donutSource) {
                              const key = parentName(t);
                              (groups[key] ??= { key, total: 0, icon: iconForCategory(t.category), color: '' });
                              groups[key].total += amtOf(t);
                            }
                            const palette = [COLORS.orange, COLORS.danger, COLORS.violet, COLORS.blue, COLORS.green, COLORS.teal, COLORS.yellow, COLORS.emerald, COLORS.checking];
                            const arr = Object.values(groups).filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
                            arr.forEach((g, i) => { g.color = palette[i % palette.length]; });
                            const totalDonut = arr.reduce((s, g) => s + g.total, 0);
                            const upcomingTotal = suiviDetail.recurrentes.reduce((s, t) => s + upcomingAmt(t), 0);
                            // Liste : « À venir » → seulement les non-échues ; catégorie → cette catégorie ; sinon tout.
                            const list = viewingUpcoming
                              ? suiviDetail.recurrentes.filter(isUpcoming)
                              : recurFilter
                                ? suiviDetail.recurrentes.filter((t) => parentName(t) === recurFilter)
                                : suiviDetail.recurrentes;
                            const centerVal = viewingUpcoming ? upcomingTotal : (recurFilter ? (groups[recurFilter]?.total ?? 0) : totalDonut);
                            return (
                              <>
                                {arr.length > 0 && (
                                  <View style={{ alignItems: 'center', marginBottom: 10 }}>
                                    <CategoryDonut
                                      segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                                      size={150}
                                      strokeWidth={20}
                                      activeKey={viewingUpcoming ? null : recurFilter}
                                      centerLabel={fmt(centerVal)}
                                      centerColor={COLORS.text}
                                    />
                                  </View>
                                )}
                                {(arr.length > 0 || upcomingTotal > 0) && (
                                  <>
                                    <View style={styles.pieLegend}>
                                      {arr.map((g) => {
                                        const active = recurFilter === g.key;
                                        return (
                                          <TouchableOpacity
                                            key={g.key}
                                            style={[styles.pieLegendItem, active && { borderColor: g.color, backgroundColor: g.color + '1A' }]}
                                            onPress={() => setRecurFilter(active ? null : g.key)}
                                            activeOpacity={0.7}
                                          >
                                            <View style={[styles.pieDot, { backgroundColor: g.color }]} />
                                            <Ionicons name={g.icon as any} size={13} color={COLORS.textSecondary} />
                                            <Text style={styles.pieLegendText} numberOfLines={1}>{g.key}</Text>
                                            <Text style={[styles.pieLegendVal, { color: g.color }]}>{fmt(g.total)}</Text>
                                          </TouchableOpacity>
                                        );
                                      })}
                                      {/* Chip « À venir » : occurrences non encore échues (non comptées). Filtre au clic. */}
                                      {upcomingTotal > 0 && (
                                        <TouchableOpacity
                                          style={[styles.pieLegendItem, viewingUpcoming && { borderColor: COLORS.textSecondary, backgroundColor: COLORS.textSecondary + '1A' }]}
                                          onPress={() => setRecurFilter(viewingUpcoming ? null : UPCOMING_KEY)}
                                          activeOpacity={0.7}
                                        >
                                          <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
                                          <Text style={styles.pieLegendText} numberOfLines={1}>À venir</Text>
                                          <Text style={[styles.pieLegendVal, { color: COLORS.textSecondary }]}>{fmt(upcomingTotal)}</Text>
                                        </TouchableOpacity>
                                      )}
                                    </View>
                                    <View style={styles.suiviDivider} />
                                  </>
                                )}
                                {txList(list, semanticText(COLORS.orange, COLORS), 'Aucune dépense récurrente.', isUpcoming)}
                              </>
                            );
                          })()
                          : (
                            <View style={{ gap: 6, paddingTop: 4 }}>
                              <Text style={styles.detailNote}>
                                {pilotageData.variable_envelope_source === 'history'
                                  ? `Estimation basée sur la moyenne de vos ${pilotageData.variable_envelope_months_used} derniers mois.`
                                  : pilotageData.variable_envelope_source === 'onboarding'
                                  ? 'Estimation basée sur le budget variable indiqué à l\'inscription.'
                                  : 'Pas encore assez d\'historique pour estimer vos dépenses variables.'}
                              </Text>
                              {[
                                { l: 'Enveloppe estimée', v: pilotageData.variable_envelope_initial, c: COLORS.text },
                                { l: 'Déjà dépensé ce mois', v: varSpentMonth, c: COLORS.textSecondary },
                                { l: 'Restant estimé', v: Math.max(0, (pilotageData.variable_envelope_initial ?? 0) - varSpentMonth), c: semanticText(COLORS.orange, COLORS) },
                              ].map((r) => (
                                <View key={r.l} style={styles.detailRow}>
                                  <Text style={[styles.detailRowLabel, { flex: 1 }]}>{r.l}</Text>
                                  <Text style={[styles.detailRowValue, { color: r.c }]}>{fmt(r.v)}</Text>
                                </View>
                              ))}
                              {pilotageData.variable_envelope_source !== 'history' && (
                                <TouchableOpacity
                                  style={styles.detailEditBtn}
                                  activeOpacity={0.7}
                                  onPress={() => {
                                    setDetailKey(null);
                                    setWeeklyVariableInput(profile?.weekly_variable_budget ? String(profile.weekly_variable_budget) : '');
                                    setShowVariableModal(true);
                                  }}
                                >
                                  <Ionicons name="create-outline" size={15} color={COLORS.emerald} />
                                  <Text style={styles.detailEditBtnText}>Modifier l'estimation</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          )}
                      </>
                    )}
                    {detailKey === 'relyka' && (
                      <View>
                        {[
                          { l: 'Point bas de trésorerie', v: pilotageData.cashflow_trough ?? pilotageData.current_checking_balance },
                          { l: 'Épargne à venir', v: -(pilotageData.month_savings_future ?? 0) },
                          { l: 'Investissement à venir', v: -(pilotageData.month_invest_future ?? 0) },
                          { l: 'Réservé (projets)', v: -(pilotageData.monthly_reserve_planned ?? 0) },
                          { l: 'Conservé + cumuls', v: -(reservationsTotal + cumulsTotal) },
                          { l: 'Dépenses variables estimées', v: -(pilotageData.variable_envelope_remaining ?? 0) },
                          { l: 'Marge de sécurité', v: -(pilotageData.safety_margin_amount ?? 0) },
                        ].filter((r) => Math.round(Math.abs(r.v)) > 0).map((r) => (
                          <View key={r.l} style={styles.detailRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                              <Text style={styles.detailRowLabel}>{r.l}</Text>
                              {r.l === 'Point bas de trésorerie' && (
                                <TouchableOpacity onPress={() => setShowTroughInfo(true)} hitSlop={8}>
                                  <Ionicons name="information-circle-outline" size={16} color={COLORS.emerald} />
                                </TouchableOpacity>
                              )}
                            </View>
                            <Text style={[styles.detailRowValue, { color: r.v < 0 ? COLORS.textSecondary : COLORS.text }]}>{fmt(r.v)}</Text>
                          </View>
                        ))}
                        <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, marginTop: 4 }]}>
                          <Text style={[styles.detailRowLabel, { flex: 1, fontWeight: '800' }]}>Ton Relyka</Text>
                          <Text style={[styles.detailRowValue, { color: semanticText(COLORS.emerald, COLORS), fontWeight: '800' }]}>{fmt(resteDisponible)}</Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Popup explicative « point bas de trésorerie » (§N8) */}
      <Modal visible={showTroughInfo} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowTroughInfo(false)}>
        <Pressable style={styles.detailOverlay} onPress={() => setShowTroughInfo(false)}>
          <Pressable style={styles.detailBox} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>Point bas de trésorerie</Text>
              <TouchableOpacity onPress={() => setShowTroughInfo(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.troughInfoText}>
              C'est le solde le plus bas qu'atteindront vos comptes courants d'ici votre prochaine rentrée d'argent, en simulant vos revenus et dépenses à venir dans l'ordre des dates.{'\n\n'}
              On se base dessus plutôt que sur votre solde actuel pour ne jamais vous laisser dépenser de l'argent que vous n'avez pas encore reçu : votre budget libre reste fiable même si une grosse dépense tombe avant votre prochaine paie.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modale : estimation hebdo des dépenses variables (alimente q9) */}
      <Modal visible={showVariableModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowVariableModal(false)}>
        <Pressable style={styles.varModalOverlay} onPress={() => setShowVariableModal(false)}>
          <Pressable style={styles.varModalBox} onPress={() => {}}>
            <Text style={styles.varModalTitle}>Dépenses variables</Text>
            <Text style={styles.varModalHint}>
              Combien dépensez-vous environ pour vos courses, loisirs et dépenses variables ?
            </Text>
            <View style={styles.varModalInputRow}>
              <TextInput
                style={styles.varModalInput}
                value={weeklyVariableInput}
                onChangeText={(v) => setWeeklyVariableInput(v.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="Ex. 120"
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
              />
              <Text style={styles.varModalUnit} numberOfLines={1}>{CURRENCY_SYMBOL} / sem.</Text>
            </View>
            {weeklyVariableInput ? (
              <Text style={styles.varModalMonthly}>
                ≈ {Math.round((parseFloat(weeklyVariableInput.replace(',', '.')) || 0) * 4.33).toLocaleString('fr-FR')} {CURRENCY_SYMBOL} / mois
              </Text>
            ) : null}
            <View style={styles.varModalActions}>
              <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowVariableModal(false)}>
                <Text style={styles.varModalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.varModalSave}
                onPress={async () => {
                  const weekly = parseFloat(weeklyVariableInput.replace(',', '.')) || 0;
                  try {
                    await updateProfileVar.mutateAsync({ weekly_variable_budget: weekly > 0 ? weekly : null });
                    // Sync best-effort de la réponse q9 (si la ligne existe déjà)
                    if (supabase && user?.id) {
                      await supabase.from('user_questionnaire_answers')
                        .update({ q9: weekly > 0 ? String(weekly) : '' })
                        .eq('user_id', user.id);
                    }
                  } catch (e) { console.warn('[pilotage] maj budget variable échouée:', e); }
                  setShowVariableModal(false);
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modale : marge de sécurité (identique à Paramètres → profiles.safety_margin_amount) */}
      <Modal visible={showMarginModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowMarginModal(false)}>
        <Pressable style={styles.varModalOverlay} onPress={() => setShowMarginModal(false)}>
          <Pressable style={styles.varModalBox} onPress={() => {}}>
            <Text style={styles.varModalTitle}>Marge de sécurité</Text>
            <Text style={styles.varModalHint}>
              Montant que vous souhaitez conserver au minimum sur vos comptes courants à la fin du mois, par sécurité. Il est déduit de votre « Budget libre ».
            </Text>
            <View style={styles.varModalInputRow}>
              <TextInput
                style={styles.varModalInput}
                value={marginInput}
                onChangeText={(v) => setMarginInput(v.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
              />
              <Text style={styles.varModalUnit} numberOfLines={1}>{CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.varModalActions}>
              <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowMarginModal(false)}>
                <Text style={styles.varModalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.varModalSave}
                onPress={async () => {
                  const val = Math.max(0, parseFloat(marginInput.replace(',', '.')) || 0);
                  try {
                    await updateProfileVar.mutateAsync({ safety_margin_amount: val });
                    await pilotageQuery.refetch?.();
                  } catch (e) { console.warn('[pilotage] maj marge de sécurité échouée:', e); }
                  setShowMarginModal(false);
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 8, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  settingsBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 24,
    paddingBottom: 80,
  },
  loader: { marginVertical: 40 },
  safetyBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.yellow + '1A', borderWidth: 1, borderColor: c.yellow + '40',
    borderRadius: 12, marginHorizontal: 8, marginBottom: 8,
    padding: 12,
  },
  safetyBannerText: { flex: 1, fontSize: 12, color: c.yellow, lineHeight: 18 },

  // Section Layout
  section: {
    gap: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: c.text,
    letterSpacing: -0.5,
  },
  sectionDivider: {
    height: 0.5,
    backgroundColor: c.cardBorder,
    marginHorizontal: 4,
  },
  monthPill: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  monthPillText: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  // Grid
  row2Col: { flexDirection: 'row', gap: 10 },
  col: {
    flex: 1,
  },

  // Account Summary Card
  accountSummary: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 16,
    gap: 4,
  },
  summaryItemEpargne: {
    flex: 1.4,
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 16,
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: c.savings,
  },
  summaryLabel: {
    fontSize: 11,
    color: c.textSecondary,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: c.checking,
  },
  gaugeBarOuter: {
    height: 5,
    backgroundColor: c.cardBorder,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  gaugeBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  thresholdDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  thresholdText: {
    fontSize: 8,
    color: c.textSecondary,
    marginRight: 4,
  },
  savingsStatusText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  profileCard: {
    padding: 16,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 10,
  },
  suiviCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    gap: 4,
  },
  suiviRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  suiviIcon: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  suiviIconSm: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  // ── Suivi du mois : carte UNIQUE de fond + blocs internes (§3) ──
  // Carte unique englobant tout le « Suivi du mois » (plus une carte par section).
  suiviSingleCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 14, gap: 12,
  },
  // Blocs internes : plus de chrome propre (fond/bordure) — ils vivent dans la carte unique.
  suiviBlock: {
    gap: 10,
  },
  suiviBlockHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suiviBlockTitle: { flex: 1, fontSize: 14, color: c.text, fontWeight: '600' },
  // Montants « majeurs » (Solde courant actuel + Ton Relyka) : grande taille, identique.
  suiviBlockValue: { fontSize: 28, fontWeight: '400', letterSpacing: -0.5 },
  budgetValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // Encadrés « accent foncé » (pills) : Solde courant actuel, Prochaine recette, Budget libre.
  accentPillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accentPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  accentPillText: { fontSize: 12, fontWeight: '600' },
  accentPillStrong: { fontSize: 13, fontWeight: '600' },
  // Prochaine recette : en ligne, sans cadre ni fond. flex:1 → prend l'espace restant pour rester
  // sur une ligne ; ne passe à la ligne (numberOfLines={2}) que si l'écran est trop étroit.
  incomeInline: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  relykaTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Titre « Ton Relyka » : taille de bloc sans flex (sinon il se réduit à 0 et disparaît à côté du pill).
  relykaTitle: { flexShrink: 0, fontSize: 14, color: c.text, fontWeight: '600' },
  suiviRow2: { flexDirection: 'row', gap: 10 },
  // Mini-cartes « identité » (Épargné, Investi, Réservé, Marge) = curseurs : piste gris clair à 0 €,
  // remplissage couleur du type (clair/atténué, même rendu que les curseurs Dépenses) sur 100 % dès > 0 €.
  suiviCursorMini: { flex: 1, borderRadius: 16, backgroundColor: halfAlpha(c.cardBorder), overflow: 'hidden' },
  suiviCursorFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 16 },
  suiviCursorContent: { padding: 14, gap: 8 },
  suiviMiniBlock: {
    flex: 1, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 14, gap: 8,
  },
  suiviMiniHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suiviMiniLabel: { flex: 1, fontSize: 12, color: c.textSecondary, fontWeight: '500' },
  // Montants « secondaires » (Épargne, Investissement, Réservé, Marge) : même taille, < majeurs.
  suiviMiniValue: { fontSize: 15, fontWeight: '600', letterSpacing: -0.5 },
  // « Dépenses » : remplissage (curseur) = proportion, texte par-dessus.
  depBandFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 12 },
  // Ce mois — grande bande : libellé, puis montant à gauche + % à droite.
  depBandBig: { minHeight: 54, borderRadius: 12, backgroundColor: halfAlpha(c.cardBorder), overflow: 'hidden', justifyContent: 'center' },
  depBandBigContent: { paddingHorizontal: 14, paddingVertical: 9, gap: 2 },
  depBandBigLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '500' },
  depBandBigRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  depBandBigValue: { fontSize: 15, fontWeight: '600', letterSpacing: -0.5 },
  depBandBigPct: { flexShrink: 1, fontSize: 11, fontWeight: '500', color: c.textSecondary, textAlign: 'right' },
  // Récurrentes / Variables — mini-cartes : libellé, puis montant à gauche + /total à droite.
  depMini: { flex: 1, minHeight: 54, borderRadius: 12, backgroundColor: halfAlpha(c.cardBorder), overflow: 'hidden', justifyContent: 'center' },
  depMiniContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  depMiniLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '500' },
  depMiniValueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  depMiniValue: { fontSize: 15, fontWeight: '600', letterSpacing: -0.5 },
  depMiniTotal: { fontSize: 11, fontWeight: '500', color: c.textSecondary },

  // ── Modaux détail (centrés) ──
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailBox: { width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailTitle: { fontSize: 17, fontWeight: '800', color: c.text, flex: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
  detailRowLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
  detailRowSub: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  detailRowValue: { fontSize: 15, fontWeight: '700' },
  detailEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 20 },
  troughInfoText: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  pieLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pieLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, maxWidth: '100%' },
  pieDot: { width: 9, height: 9, borderRadius: 5 },
  pieLegendText: { fontSize: 12, color: c.text, fontWeight: '600', flexShrink: 1 },
  pieLegendVal: { fontSize: 12, fontWeight: '800' },
  detailNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 4 },
  detailTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  detailTab: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  detailTabActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  detailTabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  detailTabTextActive: { color: c.bg },
  detailEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12' },
  detailEditBtnText: { fontSize: 13, fontWeight: '700', color: c.emerald },

  suiviLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
  suiviHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  suiviValue: { fontSize: 16, fontWeight: '700' },
  depLine: { flexDirection: 'row', alignItems: 'center' },
  depSubLabel: { fontSize: 11, color: c.textSecondary },
  depSubValue: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  suiviLabelBig: { fontSize: 16, color: c.text, fontWeight: '700' },
  suiviValueBig: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },

  // Recommandations — bandeau cumuls / alerte / bouton
  overspendBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.danger + '15', borderRadius: 10, borderWidth: 1, borderColor: c.danger + '40',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  overspendText: { flex: 1, fontSize: 12, color: c.danger, fontWeight: '500', lineHeight: 16 },
  cumulsBanner: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10,
    backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  cumulsBannerItem: { fontSize: 12, color: c.text, fontWeight: '600' },
  cumulsBannerLink: { marginLeft: 'auto', fontSize: 12, color: c.emerald, fontWeight: '700' },
  cumulsBtn: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 8 },
  cumulsTopRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  monthInline: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginLeft: 2 },
  cumulsBtnHeader: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
  cumulsBtnLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  suiviDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 6 },
  profileTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
  },
  profileSubtitle: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 8,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileEmoji: { fontSize: 32 },
  profileName: { fontSize: 17, fontWeight: '800', color: c.text },
  profileTier: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  profileSourceBadge: {
    backgroundColor: '#1e3a2f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  profileSourceText: { fontSize: 11, fontWeight: '600', color: c.emerald },
  profileDesc: {
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },
  profileAllocTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textSecondary,
    marginTop: 6,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  profileLabel: {
    fontSize: 13,
    color: c.textSecondary,
    flex: 1,
  },
  profileValue: {
    fontSize: 13,
    color: c.text,
    fontWeight: '700',
  },
  allocationBar: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 10,
    height: 28,
    marginTop: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  allocationSegment: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  allocationSegmentLabel: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  allocationLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  allocationLegend: {
    fontSize: 11,
    color: c.textSecondary,
  },
  // Modal Réservé
  reservedOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  reservedSheet: {
    width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20,
    padding: 18, borderWidth: 1, borderColor: c.cardBorder, gap: 8,
  },
  reservedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reservedTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  reservedSectionLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
  reservedItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  reservedItemIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reservedItemName: { fontSize: 14, fontWeight: '700', color: c.text },
  reservedItemHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  reservedItemAmount: { fontSize: 15, fontWeight: '800' },
  reservedProjectBlock: {
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14,
    paddingHorizontal: 12, marginTop: 8, backgroundColor: c.card,
  },
  reservedActions: { flexDirection: 'row', gap: 8, paddingBottom: 12, paddingTop: 2 },
  reservedReleaseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: c.danger + '44', backgroundColor: c.danger + '12',
  },
  reservedReleaseText: { fontSize: 12, fontWeight: '700', color: c.danger },
  reservedTransferBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: c.green + '44', backgroundColor: c.green + '12',
  },
  reservedTransferText: { fontSize: 12, fontWeight: '700', color: c.green },
  reservedEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 24 },
  // Modale enveloppe variable
  varModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  varModalBox: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22 },
  varModalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 8 },
  varModalHint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 18 },
  varModalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  varModalInput: {
    flexGrow: 0, flexShrink: 1, width: 150, maxWidth: '60%',
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: c.text,
  },
  varModalUnit: { fontSize: 14, color: c.textSecondary, fontWeight: '600', flexShrink: 0 },
  varModalMonthly: { fontSize: 13, color: c.emerald, fontWeight: '600', marginTop: 10 },
  varModalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  varModalCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  varModalCancelText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  varModalSave: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center' },
  varModalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  heroCard: { backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14 },
  heroLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 4 },
  heroAmount: { fontSize: 38, fontWeight: '900', marginBottom: 4 },
  heroSub: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  heroEstimate: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.cardBorder },
  heroEstimateText: { flex: 1, fontSize: 12, color: c.text, lineHeight: 16 },
  });
}
