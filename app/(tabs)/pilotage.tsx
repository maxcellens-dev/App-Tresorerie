import React, { useState, useMemo, useCallback } from 'react';
// ⚠️ Ne JAMAIS monter le <StatusBar> de react-native : react-native-keyboard-controller patche son
// module natif, et le défaut `translucent: false` de RN écrase alors le `statusBarTranslucent` du
// KeyboardProvider → barre blanche en haut + tout le contenu décalé. Utiliser expo-status-bar.
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Modal, findNodeHandle, Platform, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ScreenGradient from '../../components/layout/ScreenGradient';
import PageLoader from '../../components/layout/PageLoader';
import CalculatorButton from '../../components/transaction/CalculatorButton';
import RecurringTransactionsModal from '../../components/transaction/RecurringTransactionsModal';
import OnboardingHintBanner from '../../components/onboarding/OnboardingHintBanner';
import PilotageSimple from '../../components/pilotage/PilotageSimple';
import PilotageWelcome from '../../components/pilotage/PilotageWelcome';
import GuideModal from '../../components/guide/GuideModal';
/* Modales du Pilotage sorties du fichier : leur contenu est du RENDU pur, elles n'ont besoin que de
   leurs données en props (cf. docs/PLAN_REFACTOR_TESTS.md, phase C1). */
import TroughInfoModal from '../../components/pilotage/TroughInfoModal';
import RelykaShiftModal from '../../components/pilotage/RelykaShiftModal';
import PilotageInputModal from '../../components/pilotage/PilotageInputModal';
import SuiviTxSheet from '../../components/pilotage/SuiviTxSheet';
import ReservedModal from '../../components/pilotage/ReservedModal';
import DetailModal from '../../components/pilotage/DetailModal';
import MonthlyClosure from '../../components/closure/MonthlyClosure';
import { useMonthlyClosure } from '../../hooks/pilotage/useMonthlyClosure';
import { useTransactions } from '../../hooks/data/useTransactions';
import { useOnbHighlight } from '../../lib/engagement/onbHighlight';
import { useUpdateOnboarding } from '../../hooks/engagement/useOnboarding';
import { supabase } from '../../lib/platform/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/data/useProfile';
import { usePilotageData } from '../../hooks/pilotage/usePilotageData';
import { signalAppReady } from '../../lib/platform/splashGate';
import { useAccounts } from '../../hooks/data/useAccounts';
import { useSharedContribution } from '../../hooks/data/useSharedContribution';
import { useCreditPilotTemplates } from '../../hooks/data/useCreditFlows';
import { usePreSavings, useAddPreSavingEntry, useResetPreSaving, useSetPreSavingStatus } from '../../hooks/data/usePreSavings';
import { useReservations, useSetMonthlyReservation } from '../../hooks/data/useReservations';
import { useReleaseReservedByProject } from '../../hooks/data/useTransactions';
import { useRecoThresholds } from '../../hooks/pilotage/useRecoThresholds';
import ConseilsBanner from '../../components/ai/ConseilsBanner';
import { usePilotageTips } from '../../hooks/config/useUiPrefs';
import AdSlot from '../../components/marketing/AdSlot';
import { useProjects } from '../../hooks/data/useProjects';
import { useCategories } from '../../hooks/data/useCategories';
import PreSavingsModal from '../../components/pilotage/PreSavingsModal';
import CumulsPanel from '../../components/pilotage/CumulsPanel';
import type { SmartRecommendation } from '../../lib/finance/recommendationEngine';
import type { PreSavingType } from '../../types/database';
import { useRecommendationTiers } from '../../hooks/pilotage/useRecommendationTiers';
import { useFinancialProfile } from '../../hooks/pilotage/useFinancialProfile';
import { useAutoProfileEvaluation } from '../../hooks/pilotage/useFinancialProfile';
import { useGuide } from '../../contexts/GuideContext';
import { useIsFocused } from 'expo-router';
import { useAppColors } from '../../hooks/theme/useAppColors';
import type { AppColors } from '../../theme/palette';
import { CURRENCY_SYMBOL, convertAmount } from '../../lib/finance/currency';
import { sheetWidth, useSheetBottomPadding } from '../../lib/ui/appLayout';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { contentWidth } from '../../lib/ui/webLayout';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { useReliabilityConfig } from '../../hooks/pilotage/useReliability';
import { buildPerimeterCtx, transformFluxTransactions, splitPerimeterAccounts } from '../../lib/finance/perimeter';
/* Calculs dérivés du tableau de bord : purs dans lib/pilotageView, câblés par ce hook
   (cf. docs/PLAN_REFACTOR_TESTS.md, phase C2). L'écran ne fait plus que du rendu. */
import { usePilotageViewModel } from '../../hooks/pilotage/usePilotageViewModel';
import { shortDay, eur, computeRelykaBreakdown } from '../../lib/finance/pilotageView';


/**
 * Puces de filtre / de légende posées DANS une liste défilante.
 *
 * Le camembert, lui, est `pointerEvents="none"` (purement décoratif) : un glissement dessus part
 * droit au ScrollView, donc « ça scrolle ». Les puces, elles, sont des `TouchableOpacity` : elles
 * prennent le doigt dès qu'il se pose, et le ScrollView doit ensuite le leur reprendre — c'est ce
 * temps de négociation qu'on ressent comme un scroll qui « galère » quand on démarre le geste sur
 * la barre de filtres.
 *
 * `delayPressIn` diffère la prise : un glissement part directement au ScrollView, un vrai appui
 * reste parfaitement normal (le délai est sous le seuil de perception).
 */
const scrollFriendlyPress = { delayPressIn: 120 } as const;


/**
 * ⚠️ SEUL ÉCRAN LOURD VOLONTAIREMENT NON DIFFÉRÉ (pas de `withDeferredMount`), pour deux raisons :
 *
 *  1. C'est LUI qui lève le rideau. `signalAppReady()` est appelé depuis son corps : le différer
 *     retarderait d'autant la disparition du splash — on aurait allongé le démarrage en croyant
 *     accélérer la navigation.
 *  2. Il n'y a rien à accélérer. C'est la route initiale : elle se monte UNE fois, sous le splash,
 *     et `freezeOnBlur` la garde montée ensuite. Revenir sur l'onglet Pilotage ne la remonte jamais,
 *     donc aucun tap d'onglet ne paie son coût de montage.
 */
function PilotageScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ closure?: string }>();
  const { user } = useAuth();
  const COLORS = useAppColors();
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(28);
  // Web bureau : le tableau de bord se lit dans une colonne large centrée (pas la colonne
  // « téléphone » de 840 px), avec des gouttières de site. Faux sur natif → aucun impact.
  const { isDesktop, height: winHeight } = useResponsive();
  // Hauteur de défilement des modaux de détail : proportionnelle à la fenêtre, bornée. Une valeur
  // figée donnait une lucarne de 420 px aussi bien sur un téléphone que sur un écran 27 pouces.
  const detailScrollMaxHeight = Math.max(260, Math.min(isDesktop ? 620 : 460, winHeight - 240));
  const { enabled: tipsEnabled } = usePilotageTips(user?.id);
  const onbReserved = useOnbHighlight('reserved_consulted');
  const onbReco = useOnbHighlight('reco_validated');
  const [refreshing, setRefreshing] = useState(false);

  // Données principales
  const queryClient = useQueryClient();
  const pilotageQuery = usePilotageData(user?.id);
  const { data: reliabilityCfg } = useReliabilityConfig();

  // PERF : plus d'invalidation SYSTÉMATIQUE au focus (elle re-téléchargeait TOUTES les transactions
  // à chaque passage d'onglet → lenteur perçue). Les mutations (saisie, virement, régul, prudence…)
  // invalident déjà `pilotage_data`/`profile` ; le staleTime (45 s) couvre le reste. On garde un
  // refetch DOUX au focus : uniquement si les données sont périmées (respecte staleTime, pas de réseau sinon).
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      queryClient.refetchQueries({ queryKey: ['pilotage_data', user.id], stale: true });
    }, [user?.id, queryClient]),
  );
  const { data: projectsForConseils = [] } = useProjects(user?.id);
  const txPersoQuery = useTransactions(user?.id);
  const { data: txPersoForConseils = [] } = txPersoQuery;
  // #2/#5 — les modaux (Dépensé/Épargné/Investi/récurrentes) doivent inclure les opérations des comptes
  // partagés/joints, mises à l'échelle du % d'impact (et annotées du %). Exclues si 0%.
  const { data: sharedContrib } = useSharedContribution(user?.id);
  // C3/Pilotage — mensualités de crédit en dépense récurrente synthétique (cohérent avec les cursors).
  const creditPilotTx = useCreditPilotTemplates(user?.id);
  // Échéances de crédit MATÉRIALISÉES (credit_kind, migration 143) exclues : la charge crédit est déjà
  // représentée par les synthétiques creditPilotTx (tous les mois) — sinon double compte.
  const txForConseils = useMemo(
    () => [
      ...txPersoForConseils.filter((t: any) => !t.credit_kind),
      ...(sharedContrib?.transactions ?? []).filter((t: any) => !t.credit_kind),
      ...creditPilotTx,
    ],
    [txPersoForConseils, sharedContrib, creditPilotTx],
  );
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
  /* « Ouverture de l'app » = ce MONTAGE de l'écran (le Pilotage est la porte d'entrée). Un simple
     changement d'onglet ne le remonte pas, donc la clôture ne se rouvre pas en boucle pendant la
     session — elle revient à la prochaine ouverture, tant qu'un mois reste dû. */
  const [appJustOpened] = useState(true);
  const { data: customTiers } = useRecommendationTiers();
  const { data: financialProfile } = useFinancialProfile(user?.id);
  const autoEval = useAutoProfileEvaluation(user?.id);

  // ── Données recos évoluées : cumuls, réservations, seuils, comptes ──
  const accountsQuery = useAccounts(user?.id);
  const { data: accountsPerso = [] } = accountsQuery;
  // Inclure les comptes partagés (pondérés) pour que les modaux du suivi connaissent leurs types.
  const accounts = useMemo(
    () => [...accountsPerso, ...(sharedContrib?.accounts ?? [])],
    [accountsPerso, sharedContrib],
  );
  // Périmètre quotidien appliqué aux données des MODAUX du Suivi (mêmes règles que le moteur
  // usePilotageData) : joints « contribution » hors flux, virements trans-frontière → dépenses/recettes.
  const perimeterCtx = useMemo(
    () => buildPerimeterCtx(accounts.map((a: any) => ({
      id: a.id,
      isShared: !!(sharedContrib?.factorByAccount && a.id in sharedContrib.factorByAccount),
      shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
      factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
      type: a.type,
    }))),
    [accounts, sharedContrib],
  );
  const txForSuivi = useMemo(() => transformFluxTransactions(txForConseils as any[], perimeterCtx), [txForConseils, perimeterCtx]);
  const accountsForSuivi = useMemo(() => splitPerimeterAccounts(accounts, perimeterCtx).perimeter, [accounts, perimeterCtx]);
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
  // `planned_simple` : version « vue simplifiée » de la ligne « Tu devrais encore dépenser ». Elle
  // couvre variables ET récurrentes à venir — un modal à part, pour ne pas toucher à celui de la
  // vue détaillée (`planned`), qui répond à une autre question.
  const [detailKey, setDetailKey] = useState<'checking' | 'savings' | 'invest' | 'spent' | 'planned' | 'planned_simple' | 'relyka' | null>(null);
  const [plannedTab, setPlannedTab] = useState<'recurrentes' | 'variables'>('recurrentes');
  // Détail d'une transaction depuis les modaux Épargné/Investi (feuille « Fermer / Modifier »).
  const [suiviTx, setSuiviTx] = useState<any | null>(null);
  const [showTroughInfo, setShowTroughInfo] = useState(false); // popup « point bas de trésorerie » (§N8)
  /* Les filtres des modaux de détail (« Récurrentes », « À venir », catégorie du camembert) vivent
     désormais DANS les sous-blocs qui les pilotent. Un effet de remise à zéro les suivait ici : il
     n'a plus d'objet, puisque changer de vue démonte le sous-bloc et emporte son état avec lui.
     La règle qu'il portait reste vraie et reste tenue : les filtres d'un modal ne survivent pas à
     sa fermeture — rouvrir « Dépensé ce mois » sur un « À venir » resté actif afficherait une liste
     vide sans qu'on comprenne pourquoi. */
  const [showRecurringModal, setShowRecurringModal] = useState(false); // modal « Transactions récurrentes » (toutes récurrences)
  const releaseReserved = useReleaseReservedByProject(user?.id);
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const openReservedModal = () => { setShowReservedModal(true); updateOnboarding.mutate({ flags: { reserved_consulted: true } }); };
  // Modale de saisie de l'estimation hebdo des dépenses variables (alimente q9)
  const { data: profile } = useProfile(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [weeklyVariableInput, setWeeklyVariableInput] = useState('');
  const updateProfileVar = useUpdateProfile(user?.id);
  /* ── Référence des dépenses variables : Auto / Estimation / Réel (migration 164) ────────────────
     Le choix est LOCAL tant qu'il n'est pas enregistré (bouton dédié) : on ne veut pas qu'un tap
     d'exploration réécrive le profil et fasse bouger le Relyka sous les yeux. À l'enregistrement,
     on annonce le nouveau Relyka dans une pop-up — c'est la conséquence visible du choix, et elle
     serait sinon noyée dans le tableau de bord derrière la modale. */
  const [varModeDraft, setVarModeDraft] = useState<'auto' | 'estimate' | 'real' | null>(null);
  const [savingVarMode, setSavingVarMode] = useState(false);
  const [relykaShift, setRelykaShift] = useState<null | { before: number; after: number }>(null);
  // Modale d'édition de la marge de sécurité (comme dans Paramètres → profiles.safety_margin_amount)
  const [showMarginModal, setShowMarginModal] = useState(false);
  const [marginInput, setMarginInput] = useState('');
  // Conservation manuelle (sans passer par la recommandation « Conserver »).
  const [showConserveModal, setShowConserveModal] = useState(false);
  const [conserveInput, setConserveInput] = useState('');

  /** Guide utilisateur (parcours de démarrage) — lu très tôt : il conditionne aussi la découverte. */
  const userGuide = useGuide();

  /* ── UNE SEULE VUE DU TABLEAU DE BORD ─────────────────────────────────────────────────────────
     Il y avait deux mises en page du même écran (« complète » et « simplifiée ») et une bascule.
     La complète a été retirée : deux tableaux de bord à maintenir sur les mêmes chiffres, c'était
     deux fois le risque de divergence pour une information que la simplifiée rend déjà — chaque
     ligne y ouvre le MÊME modal de détail. Ce qu'elle seule affichait encore (colonnes, curseurs
     « dont récurrentes / variables », bandeaux de cumuls, pilule du mois) a été volontairement
     abandonné ; ce qui comptait (fourchette, messages du Relyka) a été repris dans le bloc
     principal. Les modaux de détail, eux, n'ont pas bougé d'une ligne. */

  const fmtMain = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

  /* ── GUIDE UTILISATEUR (démarrage) ─────────────────────────────────────────────────────────────
     Le Pilotage porte les DEUX DERNIÈRES étapes du parcours : l'estimation des dépenses variables et
     la marge de sécurité. Elles se jouent ICI, et pas dans un écran de réglages à part, parce que
     ces deux montants n'ont de sens qu'au regard des lignes qu'ils pilotent : on fait donc défiler
     la page jusqu'à la ligne concernée, le tableau de bord reste visible derrière, et le modal
     explique ce qu'on renseigne et à quel endroit. */
  const pilotFocused = useIsFocused();
  const recoCardRef = React.useRef<any>(null);
  const monthCardRef = React.useRef<any>(null);
  const variableLineRef = React.useRef<any>(null);
  const marginLineRef = React.useRef<any>(null);
  // Réglage OBLIGATOIRE en cours (le modal correspondant perd son « Annuler » et sa fermeture
  // au tap à côté : l'étape se termine par une valeur enregistrée, pas par un abandon).
  const requireVariable = userGuide.is('pilotage_variable');
  const requireMargin = userGuide.is('pilotage_margin');

  const scrollRef = React.useRef<ScrollView>(null);

  /* Amène une ligne du tableau de bord à l'écran. Sert à la checklist « Pour bien démarrer » ET aux
     deux dernières étapes du parcours : on ne demande pas un montant dans le vide, on fait défiler
     jusqu'à la ligne qu'il pilote pour qu'on voie ce qu'on renseigne et à quel endroit.
     WEB : `findNodeHandle` LÈVE une exception sur react-native-web → on y passe par le DOM
     (défilement courant + position mesurée dans la fenêtre), même résultat sans crash. */
  const scrollToRow = React.useCallback((target: React.RefObject<any>) => {
    if (Platform.OS === 'web') {
      const el: any = (scrollRef.current as any)?.getScrollableNode?.();
      if (el && target.current?.measureInWindow) {
        const currentY = Number(el.scrollTop) || 0;
        target.current.measureInWindow((_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, currentY + y - 90), animated: true });
        });
      }
      return;
    }
    const node = scrollRef.current ? findNodeHandle(scrollRef.current) : null;
    if (node && target.current?.measureLayout) {
      target.current.measureLayout(node, (_x: number, y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
      }, () => {});
    }
  }, []);

  /* Mise en évidence de la checklist « Pour bien démarrer » (arrivée via ?onb=…). */
  React.useEffect(() => {
    const target = onbReco ? recoCardRef : onbReserved ? monthCardRef : null;
    if (!target) return;
    const t = setTimeout(() => scrollToRow(target), 350);
    return () => clearTimeout(t);
  }, [onbReco, onbReserved, scrollToRow]);

  /* Étapes 3 et 4 du parcours : la ligne concernée est amenée à l'écran AVANT que le modal
     n'explique quoi y mettre. Le tableau de bord reste visible derrière (voile allégé) : c'est tout
     l'intérêt de faire ces deux réglages ici plutôt que dans un écran de réglages isolé. */
  React.useEffect(() => {
    if (!pilotFocused) return;
    const target = requireVariable ? variableLineRef : requireMargin ? marginLineRef : null;
    if (!target) return;
    const t = setTimeout(() => scrollToRow(target), 420);
    return () => clearTimeout(t);
  }, [pilotFocused, requireVariable, requireMargin, scrollToRow]);


  // Évaluation automatique mensuelle (silencieuse, 1er du mois)
  React.useEffect(() => {
    if (financialProfile) autoEval.mutate();
  }, [financialProfile?.last_auto_evaluation]);

  // (Le PROFIL VIVANT n'est plus déclenché depuis cet écran : un observateur global surveille les
  //  comptes et les transactions, cf. components/LiveProfileSync.)

  const { data: pilotageData, isLoading: pilotageLoading, error: pilotageError } = pilotageQuery;
  const isLoading = pilotageLoading;
  // Hors-ligne, la requête est « en pause » (onlineManager/NetInfo) : ni données, ni erreur.
  const isOffline = pilotageQuery.fetchStatus === 'paused';

  /* ── PAS D'ÉCRAN QUI SAUTE À L'OUVERTURE ────────────────────────────────────────────────────────
     L'accueil (« crée ton premier compte ») se déduit de l'ABSENCE de comptes et d'opérations. Or
     une lecture EN COURS rend exactement la même chose qu'un compte neuf : une liste vide. Un
     utilisateur installé voyait donc l'accueil du tout début clignoter avant que son tableau de
     bord ne le remplace. Même garde que le guide (contexts/GuideContext.dataReady) : tant que les
     deux lectures n'ont pas ABOUTI, on ne conclut rien et on reste sur le chargement.
     ⚠️ Filet OBLIGATOIRE : hors-ligne les requêtes restent « en pause » et n'aboutissent jamais →
     sans borne de temps, l'écran resterait bloqué sur le rond de chargement. */
  const baseDataReady = accountsQuery.isSuccess && txPersoQuery.isSuccess;
  const baseDataPaused = accountsQuery.fetchStatus === 'paused' || txPersoQuery.fetchStatus === 'paused';
  const [bootTimedOut, setBootTimedOut] = useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setBootTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const stillBooting = !baseDataReady && !baseDataPaused && !bootTimedOut;

  // Signale au splash animé que l'app peut s'afficher : dès que les données sont là OU en erreur,
  // sinon au bout de 900 ms MAX. On n'attend plus la fin du (lourd) chargement pour OUVRIR l'app :
  // l'utilisateur voit le tableau de bord tout de suite, les données finissent d'arriver derrière
  // (indicateur de chargement in-app). Crucial hors-ligne : plus de splash bloqué ~15 s.
  // (Le splash couvre aussi la lecture des comptes/opérations quand elle arrive dans les temps :
  //  sinon on enchaînait splash → rond de chargement. Le plafond de 900 ms reste le même.)
  React.useEffect(() => {
    if ((pilotageData && baseDataReady) || pilotageError || isOffline) { signalAppReady(); return; }
    const t = setTimeout(signalAppReady, 900);
    return () => clearTimeout(t);
  }, [pilotageData, baseDataReady, pilotageError, isOffline]);

  /* ── TOUS LES CALCULS DÉRIVÉS DE L'ÉCRAN ────────────────────────────────────────────────────────
     Relyka affiché et sa décomposition, phrase du point bas, messages, listes des modaux de suivi,
     état d'installation, recommandations. C'était ~400 lignes ici même — donc intestables autrement
     qu'à l'œil, sur l'écran. Les calculs sont désormais purs (lib/pilotageView, horloge injectable)
     et ce hook ne fait que les mémoïser. Cf. docs/PLAN_REFACTOR_TESTS.md, phase C2. */
  const vm = usePilotageViewModel({
    pilotageData,
    accounts,
    accountsForSuivi,
    txForSuivi,
    txPerso: txPersoForConseils as any[],
    reservations,
    preSavings,
    profile,
    rates,
    reliabilityCfg,
    financialProfile,
    recoThresholds,
    customTiers,
    colors: COLORS,
    baseDataReady,
    guideIs: (s) => userGuide.is(s as any),
  });
  const {
    preEpargneTotal, preInvestTotal, reservationsTotal, mainCheckingId,
    cumulsTotal, safetyMarginDisplay, variableEnvelopeRemaining, monthExpensesPast,
    resteDisponible, relykaAffiche, troughDate, troughExplain, nextIncomeDate, nextIncomeAmount,
    misDeCoteTotal, relykaAlloueVolontairement, baseADepenser, enDepassement,
    setupIncomplete, setupHint, firstName, welcomeStep, welcomeRoute,
    relConf, recoList, recoMessages, relykaMessages, suiviDetail, recurUpcoming,
  } = vm;

  /* Mode affiché = brouillon local s'il existe, sinon celui du profil. */
  const varMode: 'auto' | 'estimate' | 'real' = varModeDraft ?? (pilotageData?.variable_envelope_mode ?? 'auto');
  const setVarMode = (m: 'auto' | 'estimate' | 'real') => setVarModeDraft(m);
  const varModeDirty = varModeDraft != null && varModeDraft !== (pilotageData?.variable_envelope_mode ?? 'auto');

  async function saveVariableMode() {
    if (!varModeDraft || savingVarMode) return;
    setSavingVarMode(true);
    const before = relykaAffiche;
    try {
      await updateProfileVar.mutateAsync({ variable_envelope_mode: varModeDraft });
      // Le Relyka dépend de l'enveloppe : on attend la donnée RECALCULÉE pour l'annoncer, sinon on
      // afficherait l'ancien chiffre comme s'il était le nouveau.
      const fresh = await pilotageQuery.refetch();
      const d: any = fresh.data;
      if (d) {
        /* MÊME formule que le Relyka affiché, et pas une copie : cette soustraction à huit termes
           était recopiée ici, si bien qu'ajouter un terme au Relyka faisait annoncer une variation
           que la carte ne montrait pas. Cf. computeRelykaBreakdown (lib/pilotageView). */
        const { relykaAffiche: after } = computeRelykaBreakdown(d, {
          reservationsTotal, preEpargneTotal, preInvestTotal,
        });
        setRelykaShift({ before, after });
      }
      setVarModeDraft(null);
    } catch (e) {
      // Un échec silencieux laisserait l'utilisateur croire que son choix est enregistré alors que
      // le Relyka ne bouge pas — exactement le symptôme « impossible d'enregistrer autre chose ».
      Alert.alert('Un souci', e instanceof Error ? e.message : "Ton choix n'a pas pu être enregistré.");
    } finally {
      setSavingVarMode(false);
    }
  }

  /** Ouvre la SAISIE de l'estimation des dépenses variables (et non sa fiche de lecture). */
  const openVariableInput = () => {
    setWeeklyVariableInput(profile?.weekly_variable_budget ? String(profile.weekly_variable_budget) : '');
    setShowVariableModal(true);
  };


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

  // Ouvrir le virement pré-rempli pour une reco épargne/invest.
  // Pré-rempli avec le montant ACTIONNABLE (borne basse « minimum sûr » en fourchette) : on ne
  // pousse pas à virer de l'argent dont on n'est pas sûr — même chiffre que dans les textes.
  const openRecoTransfer = (reco: SmartRecommendation, dest: 'savings' | 'investment') => {
    markRecoUsed();
    const label = dest === 'savings' ? 'Épargne' : 'Investissement';
    router.push(buildTransferUrl({ dest, amount: reco.actionAmount ?? reco.amount, label: `${label} ${monthYearLabel()}`, recoComplete: reco.type }) as any);
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

  // Chargement actif (en ligne, données en route) : cercle. Hors-ligne, on ne « charge » pas → on
  // saute ce bloc pour afficher le message de connexion (ci-dessous).
  // `stillBooting` : les comptes / opérations ne sont pas encore lus → on ne sait pas ENCORE s'il
  // faut afficher le tableau de bord ou l'accueil. On attend plutôt que de montrer l'un puis
  // l'autre (borné à 4 s, cf. bootTimedOut).
  if (((isLoading && !pilotageData) || stillBooting) && !isOffline) {
    return <PageLoader />;
  }

  // Écran d'erreur UNIQUEMENT s'il n'y a AUCUNE donnée (cache compris). Si des données existent —
  // même anciennes/hors-ligne (cache persisté) — on affiche le tableau de bord malgré l'erreur de
  // fond : mieux vaut des infos datées qu'un écran vide. La reconnexion rafraîchira.
  if (!pilotageData) {
    const isNetwork = isOffline
      || (pilotageError && /network|fetch|timeout|failed/i.test((pilotageError as Error).message ?? ''));
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right']}>
          <View style={styles.loader}>
            <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 21 }}>
              {isNetwork
                ? 'Pas de connexion Internet.\nVérifie ta connexion — la page se rechargera automatiquement.'
                : pilotageError ? `Une erreur est survenue : ${(pilotageError as Error).message}` : 'Données indisponibles'}
            </Text>
            {/* Hors-ligne : reprise automatique à la reconnexion (onlineManager) → pas de bouton. */}
            {!isNetwork && (
              <TouchableOpacity onPress={() => pilotageQuery.refetch()}>
                <Text style={{ color: COLORS.emerald, textAlign: 'center', fontWeight: '600' }}>Réessayer</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        {/* Bandeau marge de sécurité */}
        {(pilotageData.safety_margin_amount ?? 0) > 0 &&
         pilotageData.total_checking < (pilotageData.safety_margin_amount ?? 0) && (
          <View style={styles.safetyBanner}>
            <Ionicons name="warning-outline" size={18} color={COLORS.yellow} />
            <Text style={styles.safetyBannerText}>
              Tes comptes courants ({pilotageData.total_checking.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}) sont en dessous de ta marge de sécurité ({(pilotageData.safety_margin_amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}).
            </Text>
          </View>
        )}

        {/* Main Content */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          // Bureau : colonne de tableau de bord centrée (max 1180) + gouttières ; plus de réserve
          // de 80 px en bas puisqu'il n'y a plus de barre d'onglets flottante.
          contentContainerStyle={[styles.scrollContent, contentWidth(isDesktop), isDesktop && styles.scrollContentDesktop]}
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
          {/* ── ACCUEIL tant que le tableau de bord n'a rien à dire ───────────────────────────────
              Tant qu'il manque les comptes ou les flux du mois, le Relyka ne peut pas être calculé :
              on remplace TOUT le contenu par l'accueil, dont le bouton porte la prochaine action
              (créer un compte, puis saisir une récurrente). Dès que les deux sont là, le tableau de
              bord reprend sa place — et les deux derniers réglages se font PAR-DESSUS lui. */}
          {welcomeStep ? (
            <PilotageWelcome
              step={welcomeStep}
              firstName={firstName}
              onPress={() => router.push(welcomeRoute as any)}
            />
          ) : (
          <>
          {/* Zone conseils / clôture (priorité à la clôture si mois en attente) */}
          {showClosure ? (
            <MonthlyClosure
              surplusEstimate={Math.max(0, variableEnvelopeRemaining) + Math.max(0, resteDisponible)}
              checkingAccounts={accounts.filter((a) => a.type === 'checking').map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance) }))}
              /* La clôture s'ouvre d'elle-même À CHAQUE OUVERTURE de l'app tant qu'un mois reste à
                 clôturer : une bannière qu'on peut ignorer indéfiniment ne fait pas le travail, et
                 chaque mois non clôturé dégrade les moyennes de tous les suivants. Elle reste
                 refermable — c'est une invitation insistante, pas un mur. */
              autoOpen={routeParams.closure === '1' || appJustOpened}
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

          <PilotageSimple
              relykaAmount={relykaAffiche}
              relykaColor={
                relykaAffiche > 0 ? COLORS.emerald
                : relykaAlloueVolontairement ? COLORS.blue
                : relykaAffiche < 0 ? COLORS.danger
                : COLORS.orange
              }
              confidenceLevel={relConf?.result.level ?? 'high'}
              daysSinceVerification={relConf?.result.daysSinceVerification ?? 0}
              recommendations={recoList}
              // Le POURQUOI des montants, un message à la fois, sous les quatre décisions.
              recoMessages={recoMessages}
              overspending={enDepassement}
              checkingBalance={pilotageData.current_checking_balance ?? 0}
              spentThisMonth={monthExpensesPast}
              variableRemaining={pilotageData.variable_envelope_remaining ?? 0}
              recurringUpcoming={recurUpcoming.amount}
              recurringUpcomingCount={recurUpcoming.count}
              safetyMargin={pilotageData.safety_margin_amount ?? 0}
              // `null` = jamais renseignée → « à définir ». 0 enregistré = un choix, on l'affiche.
              marginSet={(profile as any)?.safety_margin_amount != null}
              // Un Relyka à 0 € n'a pas la même signification selon qu'il MANQUE des données ou que
              // tout est déjà alloué. Sur un compte neuf, « ce qu'il te reste à décider ce mois-ci »
              // était incompréhensible : il n'y avait encore rien à décider, et rien ne le disait.
              heroHint={setupIncomplete ? setupHint : undefined}
              // Ce qui commente le CHIFFRE PRINCIPAL : garde-fou, solde à vérifier, explication —
              // déroulés un à la fois sous le montant, séparément des décisions.
              relykaMessages={relykaMessages}
              // Fourchette : sous le montant, jamais à sa place.
              relykaRange={relConf?.relykaRange}
              recoRef={recoCardRef}
              monthRef={monthCardRef}
              variableLineRef={variableLineRef}
              marginLineRef={marginLineRef}
              // Mises en évidence de la checklist « Pour bien démarrer » (arrivée via ?onb=…).
              recoHighlight={onbReco}
              reservedHighlight={onbReserved}
              // « Réservé » inclut les cumuls en attente.
              reservedTotal={(pilotageData.monthly_reserve_planned ?? 0) + reservationsTotal + cumulsTotal}
              savedTotal={pilotageData.month_savings_total ?? 0}
              investedTotal={pilotageData.month_invest_total ?? 0}
              onOpenRelyka={() => setDetailKey('relyka')}
              // « Tu devrais encore dépenser » : pendant l'étape du guide, ce tap ouvre directement la
              // SAISIE de l'estimation (ce qu'on lui demande de faire), pas la fiche de lecture.
              onOpenDetail={(k) => {
                if (k === 'planned') {
                  if (requireVariable) { openVariableInput(); return; }
                  setDetailKey('planned_simple');
                  return;
                }
                setDetailKey(k);
              }}
              onOpenMargin={() => { setMarginInput(String(Math.round(pilotageData.safety_margin_amount ?? 0))); setShowMarginModal(true); }}
              onOpenReserved={openReservedModal}
              onUpdateBalance={() => router.push('/(tabs)/comptes/solde' as any)}
              onEpargner={(reco) => openRecoTransfer(reco, 'savings')}
              onInvestir={(reco) => openRecoTransfer(reco, 'investment')}
              // « Reporter » NE réserve pas au tap : on ouvre la modale de validation, pré-remplie
              // avec le nouveau total. Mettre de l'argent de côté est une décision — elle se
              // confirme, et le montant doit rester modifiable (0 = tout libérer).
              onReserver={(reco) => {
                markRecoUsed();
                setConserveInput(String(Math.round(reservationsTotal + (reco.actionAmount ?? reco.amount))));
                setShowConserveModal(true);
              }}
          />

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <AdSlot placement="pilotage" />
          </>
          )}

        </ScrollView>
      </SafeAreaView>


      {/* ══════════ GUIDE UTILISATEUR ══════════ */}

      {/* Les écrans de présentation (1ʳᵉ ouverture) sont montés À LA RACINE — cf. AppIntroGate dans
          app/_layout : ils ne doivent pas attendre le chargement de ce tableau de bord. */}

      {/* LA présentation du tableau de bord — une seule séquence, cinq zones. */}

      {/* 3. Dépenses variables — la bulle scrolle jusqu'à la ligne et l'ouvre. */}

      {/* 4. Marge de sécurité. */}

      {/* 6. Tout à la fin : le menu de l'entête. L'avatar trace lui-même son anneau (rond), donc
             le cadre tombe pile dessus quelle que soit la hauteur de la barre de statut. */}

      {/* 5. Ouvrir le détail du Relyka (remonte en haut de page). */}

      {/* ══ PARCOURS DE DÉMARRAGE — étapes 3 et 4, les deux derniers repères ══════════════════════
          Elles se jouent SUR le tableau de bord, pas dans un écran de réglages : la page a défilé
          jusqu'à la ligne concernée (cf. `scrollToRow`) et le voile du modal est allégé, donc on
          voit la ligne qu'on est en train de renseigner. Ces deux montants sont les derniers qui
          manquent au profil financier — une fois saisis, le parcours se termine et le profil est
          présenté (components/ProfileTourConclusion). */}
      <GuideModal
        visible={requireVariable && pilotFocused && !showVariableModal && detailKey === null}
        icon="cart-outline"
        iconColor={COLORS.orange}
        eyebrow="Étape 3 · Tes dépenses variables"
        step={{ index: 3, total: 4 }}
        title="Évalue ton budget mensuel"
        text={"Courses, essence, restos, imprévus : tout ce qui n'est pas une charge fixe. Donne un ordre de grandeur.\n\nDès que tu auras deux mois de saisies, Relyka remplacera cette estimation par ton vrai rythme."}
        cta={{ label: 'Renseigner', icon: 'arrow-forward', onPress: openVariableInput }}
      />

      <GuideModal
        visible={requireMargin && pilotFocused && !showMarginModal && detailKey === null}
        icon="shield-checkmark-outline"
        iconColor={COLORS.teal}
        eyebrow="Étape 4 · Ta marge de sécurité"
        step={{ index: 4, total: 4 }}
        title="Fixe un solde minimum à ne pas dépasser"
        text={"Le montant sous lequel tu ne veux pas voir tes comptes courants. \n\nRelyka te fera des recommandations pour ne pas tomber sous ce chiffre."}
        cta={{
          label: 'Renseigner',
          icon: 'arrow-forward',
          onPress: () => {
            setMarginInput(String(Math.round(pilotageData.safety_margin_amount ?? 0)));
            setShowMarginModal(true);
          },
        }}
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
      <ReservedModal
        visible={showReservedModal}
        onClose={() => setShowReservedModal(false)}
        colors={COLORS}
        reservationsTotal={reservationsTotal}
        preEpargneTotal={preEpargneTotal}
        preInvestTotal={preInvestTotal}
        reservedByProject={pilotageData.reserved_by_project}
        fmtMain={fmtMain}
        onEditConserve={(prefill) => { setConserveInput(prefill); setShowReservedModal(false); setShowConserveModal(true); }}
        onOpenPreSaving={(type) => { setShowReservedModal(false); setPreModalAmount(0); setPreModal(type); }}
        onReleaseConserve={() => { setMonthlyReservation.mutate({ montant: 0 }); }}
        onReleaseProject={(id) => { releaseReserved.mutate(id); }}
        onTransferProject={(r) => {
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
      />

      {/* Modaux détail du « Suivi du mois » (centrés, fermeture au tap extérieur, §3/§8) */}
      <DetailModal
        detailKey={detailKey}
        onClose={() => setDetailKey(null)}
        plannedTab={plannedTab}
        suiviDetail={suiviDetail}
        recurUpcoming={recurUpcoming}
        pilotageData={pilotageData}
        profile={profile}
        accounts={accounts}
        rates={rates}
        catParentName={catParentName}
        reservationsTotal={reservationsTotal}
        cumulsTotal={cumulsTotal}
        resteDisponible={resteDisponible}
        relykaAffiche={relykaAffiche}
        troughDate={troughDate}
        troughExplain={troughExplain}
        varMode={varMode}
        onVarMode={setVarMode}
        varModeDirty={varModeDirty}
        savingVarMode={savingVarMode}
        onSaveVarMode={saveVariableMode}
        scrollMaxHeight={detailScrollMaxHeight}
        isDesktop={isDesktop}
        colors={COLORS}
        onPressTx={setSuiviTx}
        onShowRecurring={() => { setDetailKey(null); setShowRecurringModal(true); }}
        onShowTroughInfo={() => setShowTroughInfo(true)}
        onEditEstimate={() => { setDetailKey(null); openVariableInput(); }}
        onSetMargin={() => { setDetailKey(null); setMarginInput(''); setShowMarginModal(true); }}
        onOpenProfile={() => { setDetailKey(null); router.push('/(tabs)/(secondary)/profil-financier?edit=1' as any); }}
      />

      {/* Détail d'une transaction depuis Épargné/Investi — feuille du bas « Fermer / Modifier »,
          comme au clic d'une transaction dans un compte. */}
      <SuiviTxSheet
        tx={suiviTx}
        onClose={() => setSuiviTx(null)}
        accounts={accounts}
        rates={rates}
        refCurrency={profile?.currency_code ?? 'EUR'}
        userId={user?.id}
        sheetPad={sheetPad}
        colors={COLORS}
        onEdit={(route) => { setSuiviTx(null); setDetailKey(null); router.push(route as any); }}
      />

      {/* Popup explicative « point bas de trésorerie » (§N8) */}
      <TroughInfoModal
        visible={showTroughInfo}
        onClose={() => setShowTroughInfo(false)}
        colors={COLORS}
        currentBalance={pilotageData.current_checking_balance ?? 0}
        trough={pilotageData.cashflow_trough ?? 0}
        troughDate={troughDate}
        nextIncomeDate={nextIncomeDate}
        nextIncomeAmount={nextIncomeAmount}
        safetyMargin={pilotageData.safety_margin_amount ?? 0}
        shortDay={shortDay}
        eur={eur}
      />

      {/* Nouveau Relyka après changement de référence des variables — la conséquence du choix,
          annoncée franchement plutôt que noyée derrière la modale de détail. */}
      <RelykaShiftModal shift={relykaShift} onClose={() => setRelykaShift(null)} colors={COLORS} />

      {/* Estimation hebdo des dépenses variables (alimente q9).
          ÉTAPE 3 du parcours de démarrage quand `requireVariable` : ni fermeture au tap à côté, ni
          « Annuler », et un montant > 0 exigé — à 0 €, l'app présenterait comme disponible de
          l'argent déjà mangé par le quotidien. */}
      <PilotageInputModal
        visible={showVariableModal}
        title="Dépenses variables"
        hint={<>
          Combien dépenses-tu environ pour tes courses, loisirs et dépenses variables ?
          {requireVariable
            ? '\n\nUne estimation suffit : Relyka l\'ajustera à ton réel au fil des mois. \n\nCette somme sera déduite de ton Relyka en anticipation.'
            : ''}
        </>}
        value={weeklyVariableInput}
        onChangeValue={setWeeklyVariableInput}
        unit={`${CURRENCY_SYMBOL} / sem.`}
        canCancel={!requireVariable}
        saveDisabled={requireVariable && (parseFloat(weeklyVariableInput.replace(',', '.')) || 0) <= 0}
        onCancel={() => setShowVariableModal(false)}
        onSave={async () => {
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
          if (requireVariable && weekly > 0) userGuide.done('g2_variable');
        }}
        colors={COLORS}
      >
        {weeklyVariableInput ? (
          <Text style={styles.varModalMonthly}>
            ≈ {Math.round((parseFloat(weeklyVariableInput.replace(',', '.')) || 0) * 4.33).toLocaleString('fr-FR')} {CURRENCY_SYMBOL} / mois
          </Text>
        ) : null}
      </PilotageInputModal>

      {/* Modale : marge de sécurité (identique à Paramètres → profiles.safety_margin_amount) */}
      {/* ÉTAPE 4 du parcours de démarrage quand `requireMargin` : 0 € est une réponse valable,
          mais il faut l'ENREGISTRER — refermer sans rien décider laisserait l'app calculer avec
          une marge qu'on n'a jamais choisie. */}
      <PilotageInputModal
        visible={showMarginModal}
        title="Ta marge de sécurité"
        /* Formulation essentielle : c'est l'UTILISATEUR qui décide d'avoir ce montant sur son
           compte — l'app ne met rien de côté à sa place. Elle s'en sert seulement pour ne jamais
           lui proposer d'y toucher. L'ancien texte (« montant conservé… déduit de ton budget
           libre ») laissait croire à une action automatique d'épargne. */
        hint="Le montant que tu veux avoir au minimum sur tes comptes courants à la fin du mois. Relyka ne le déplace nulle part : il te dit simplement ce que tu peux utiliser avant d’entamer cette somme."
        value={marginInput}
        onChangeValue={setMarginInput}
        unit={CURRENCY_SYMBOL}
        canCancel={!requireMargin}
        onCancel={() => setShowMarginModal(false)}
        onSave={() => {
          const val = Math.max(0, parseFloat(marginInput.replace(',', '.')) || 0);
          /* La modale se ferme TOUT DE SUITE : la mise à jour du profil est optimiste
             (useUpdateProfile.onMutate écrit la nouvelle marge dans le cache avant le réseau) et
             son succès invalide déjà `pilotage_data`. On attendait ici, en plus, un rechargement
             COMPLET du tableau de bord dont on ne lisait même pas le résultat. */
          updateProfileVar.mutate({ safety_margin_amount: val });
          setShowMarginModal(false);
          if (requireMargin) userGuide.done('g2_margin');
        }}
        colors={COLORS}
      />

      {/* Conserver manuellement un montant ce mois (déduit du Relyka, reste sur le compte courant). */}
      {/* « Conserver ce mois » — coquille de saisie partagée (components/pilotage/PilotageInputModal) */}
      <PilotageInputModal
        visible={showConserveModal}
        title="Conserver ce mois"
        hint={<>
          Montant à garder en réserve sur ton compte courant ce mois-ci. Il est déduit de ton
          « Budget libre » (Relyka) mais reste sur ton compte. Se réinitialise chaque mois.
          {'\n'}C'est le TOTAL réservé : baisse-le pour en libérer une partie, mets 0 pour tout libérer.
        </>}
        value={conserveInput}
        onChangeValue={setConserveInput}
        unit={CURRENCY_SYMBOL}
        onCancel={() => setShowConserveModal(false)}
        onSave={() => {
          const val = Math.max(0, Math.round(parseFloat(conserveInput.replace(',', '.')) || 0));
          setMonthlyReservation.mutate({ montant: val, libelle: `Réservé ${monthYearLabel()}` });
          setShowConserveModal(false);
        }}
        colors={COLORS}
      />
      <CalculatorButton page="pilotage" />
      <RecurringTransactionsModal visible={showRecurringModal} onClose={() => setShowRecurringModal(false)} userId={user?.id} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 8, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 24,
    paddingBottom: 80,
  },
  // Web bureau : pas de barre d'onglets flottante à dégager, mais un peu d'air en bas de page.
  scrollContentDesktop: { paddingBottom: 56, paddingTop: 8 },
  loader: { marginVertical: 40 },
  safetyBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.yellow + '1A', borderWidth: 1, borderColor: c.yellow + '40',
    borderRadius: 12, marginHorizontal: 8, marginBottom: 8,
    padding: 12,
  },
  safetyBannerText: { flex: 1, fontSize: 12, color: c.yellow, lineHeight: 18 },





  /* Feuille du bas — détail d'une transaction depuis les modaux Épargné/Investi */
  txSheetOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  txSheet: { ...sheetWidth, backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  txSheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.cardBorder, marginBottom: 14 },
  txSheetAmount: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  txSheetLabel: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginTop: 2 },
  txSheetDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 14 },
  txSheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  txSheetKey: { fontSize: 13.5, color: c.textSecondary },
  txSheetVal: { fontSize: 13.5, fontWeight: '600', color: c.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  txSheetBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  txSheetClose: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
  txSheetCloseText: { fontSize: 15, fontWeight: '700', color: c.text },
  txSheetEdit: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald },
  txSheetEditText: { fontSize: 15, fontWeight: '700', color: c.bg },



  envRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  envLabel: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600', flexShrink: 1 },
  envVal: { fontSize: 13, fontWeight: '800' },
  relykaShiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 },
  relykaShiftOld: { fontSize: 15, color: c.textSecondary, textDecorationLine: 'line-through' },
  relykaShiftNew: { fontSize: 26, fontWeight: '800', color: c.emerald },

  troughInfoText: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },


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

  });
}

export default PilotageScreen;
