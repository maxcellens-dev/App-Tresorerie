import React, { useState, useMemo, useCallback } from 'react';
// ⚠️ Ne JAMAIS monter le <StatusBar> de react-native : react-native-keyboard-controller patche son
// module natif, et le défaut `translucent: false` de RN écrase alors le `statusBarTranslucent` du
// KeyboardProvider → barre blanche en haut + tout le contenu décalé. Utiliser expo-status-bar.
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl, Modal, TextInput, findNodeHandle, Pressable, Platform, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ScreenGradient from '../../components/ScreenGradient';
import CalculatorButton from '../../components/CalculatorButton';
import RecurringTransactionsModal from '../../components/RecurringTransactionsModal';
import OnboardingHintBanner from '../../components/OnboardingHintBanner';
import PilotageSimple from '../../components/PilotageSimple';
import PilotageWelcome from '../../components/PilotageWelcome';
import GuideModal from '../../components/guide/GuideModal';
import TroughChart from '../../components/TroughChart';
import InfoDot from '../../components/InfoDot';
import type { GlossaryTerm } from '../../lib/glossary';
import MonthlyClosure from '../../components/MonthlyClosure';
import { useMonthlyClosure } from '../../hooks/useMonthlyClosure';
import { useTransactions } from '../../hooks/useTransactions';
import { useOnbHighlight } from '../../lib/onbHighlight';
import { useUpdateOnboarding } from '../../hooks/useOnboarding';
import { supabase } from '../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { usePilotageData } from '../../hooks/usePilotageData';
import { signalAppReady } from '../../lib/splashGate';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useAccounts } from '../../hooks/useAccounts';
import { useSharedContribution } from '../../hooks/useSharedContribution';
import { useCreditPilotTemplates } from '../../hooks/useCreditFlows';
import { usePreSavings, useAddPreSavingEntry, useResetPreSaving, useSetPreSavingStatus } from '../../hooks/usePreSavings';
import { useReservations, useSetMonthlyReservation } from '../../hooks/useReservations';
import { useReleaseReservedByProject } from '../../hooks/useTransactions';
import { useRecoThresholds } from '../../hooks/useRecoThresholds';
import ConseilsBanner from '../../components/ConseilsBanner';
import { usePilotageTips } from '../../hooks/useUiPrefs';
import AdSlot from '../../components/AdSlot';
import { useProjects } from '../../hooks/useProjects';
import { useCategories } from '../../hooks/useCategories';
import PreSavingsModal from '../../components/PreSavingsModal';
import CumulsPanel from '../../components/CumulsPanel';
import CategoryDonut from '../../components/CategoryDonut';
import { iconForTransaction, iconForCategory } from '../../lib/categoryIcons';
import { computeRecommendations } from '../../lib/recommendationEngine';
import { buildRecoOptions } from '../../lib/recoInputs';
import type { SmartRecommendation } from '../../lib/recommendationEngine';
import { buildRecoMessages, buildRelykaMessages, composeGuardMessage } from '../../lib/recoMessages';
import { unverifiedSincePhrase } from '../../lib/confidenceEngine';
import type { PreSavingType } from '../../types/database';
import { useRecommendationTiers } from '../../hooks/useRecommendationTiers';
import { useFinancialProfile } from '../../hooks/useFinancialProfile';
import { useAutoProfileEvaluation } from '../../hooks/useFinancialProfile';
import type { FinancialProfileId } from '../../types/database';
import { useGuide } from '../../contexts/GuideContext';
import { useIsFocused } from '@react-navigation/native';
import { useAppColors } from '../../hooks/useAppColors';
import type { AppColors } from '../../theme/palette';
import { semanticText } from '../../theme/palette';
import { CURRENCY_SYMBOL, floorToTen, convertAmount } from '../../lib/currency';
import { sheetWidth, useSheetBottomPadding } from '../../lib/appLayout';
import { useResponsive } from '../../hooks/useResponsive';
import { contentWidth, hoverRow } from '../../lib/webLayout';
import { useCurrencyRates } from '../../hooks/useCurrencyRates';
import { useReliabilityConfig, deriveRelykaConfidence } from '../../hooks/useReliability';
import { buildPerimeterCtx, transformFluxTransactions, splitPerimeterAccounts } from '../../lib/perimeter';
import { buildMaterializedIndex, recurrenceForMonth } from '../../lib/recurrenceMonth';


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

/** « 24 juillet » — date lisible, pour situer le point bas de trésorerie dans le temps. */
function shortDay(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
/** Montant arrondi en devise — usage hors des blocs de rendu qui définissent leur propre `fmt`. */
function eur(n: number): string { return Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL; }

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
  const [spentFilter, setSpentFilter] = useState<string | null>(null); // filtre sous-catégorie du camembert (§N2)
  const [spentRecurOnly, setSpentRecurOnly] = useState(false); // « Dépensé » : ne garder que les récurrentes
  // « Dépensé » : basculer sur les récurrentes du mois PAS ENCORE prélevées (grisées, hors totaux).
  // Exclusif avec les deux filtres ci-dessus — on ne regarde pas du passé et du futur en même temps.
  const [spentUpcomingOnly, setSpentUpcomingOnly] = useState(false);
  const [recurFilter, setRecurFilter] = useState<string | null>(null); // filtre catégorie du camembert des récurrentes
  // Les filtres d'un modal ne survivent pas à sa fermeture : rouvrir « Dépensé ce mois » sur un
  // « À venir » resté actif de la fois d'avant afficherait une liste vide sans qu'on comprenne
  // pourquoi. On repart toujours de la liste NON filtrée.
  React.useEffect(() => {
    if (detailKey === 'spent') return;
    setSpentFilter(null); setSpentRecurOnly(false); setSpentUpcomingOnly(false);
  }, [detailKey]);
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

  // Compte courant principal (solde le plus élevé) — cible du lien « Vérifier mon solde ».
  const mainCheckingId = [...accounts]
    .filter((a) => a.type === 'checking')
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id;

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
  // Les dépenses déjà passées sont déjà dans le solde courant → affichées en info uniquement.
  const monthExpensesPast = pilotageData?.month_expenses_past ?? 0;
  // Budget libre = POINT BAS de trésorerie d'ici la prochaine rentrée (revenus + dépenses réelles,
  // dans l'ordre des dates → on ne libère JAMAIS un revenu pas encore reçu). On en retire ensuite
  // les engagements volontaires (virements épargne/invest prévus, réservations), la marge et
  // l'enveloppe de dépenses variables estimée (qui, elle, n'est pas une transaction).
  const cashflowTrough = pilotageData?.cashflow_trough ?? (pilotageData?.current_checking_balance ?? 0);
  // Les cumuls manuels (pré-épargne / pré-invest) sont de l'argent « réservé mentalement »
  // en attente de virement → on les retire aussi du budget libre (Relyka) tant qu'ils ne sont
  // pas libérés ou transformés en virement (auquel cas ils sont remis à 0 et déduits via les
  // virements). Ils apparaissent également dans la ligne « Réservé » du Suivi du mois.
  // Valeur BRUTE (peut être négative) : sert à savoir si le Relyka est à 0 par CHOIX (mises de côté)
  // ou par manque d'argent — les deux méritent des messages opposés.
  const resteDisponibleBrut =
    cashflowTrough
    - savingsRemaining
    - investRemaining
    - (pilotageData?.monthly_reserve_planned ?? 0)
    - reservationsTotal
    - cumulsTotal
    - variableEnvelopeRemaining
    - safetyMarginDisplay;
  const resteDisponible = Math.max(0, resteDisponibleBrut);
  // Montant Relyka tel qu'AFFICHÉ (dizaine inférieure). C'est LUI qui décide de la couleur et du
  // message, jamais le montant brut : entre 1 € et 9 €, la carte affichait « 0 € » tout en servant
  // le message « utilise ton Relyka librement » en vert (ex. 154 € − 150 € réservés = 4 €).
  const relykaAffiche = floorToTen(resteDisponible);
  // ── Le point bas est une info À UNE DATE, pas un état permanent ──────────────────────────────
  // Un salarié payé le 25 a mécaniquement un point bas faible le 24 : c'est normal, mais son Relyka
  // ne concerne alors QUE la période d'ici là. Sans le dire, le chiffre paraît faux — et il remonte
  // « tout seul » le lendemain de la paie, ce qui achève de casser la confiance. On expose donc la
  // date du point bas et la rentrée qui le suit, dès que le point bas est réellement CONTRAIGNANT
  // (c.-à-d. plus bas que le solde d'aujourd'hui : une dépense creuse le compte avant la rentrée).
  const troughDate = pilotageData?.cashflow_trough_date ?? null;
  const nextIncomeDate = pilotageData?.next_income_date ?? null;
  const nextIncomeAmount = pilotageData?.next_income_amount ?? 0;
  const troughLimits =
    !!pilotageData && !!troughDate
    && cashflowTrough < (pilotageData.current_checking_balance ?? 0) - 1
    && (!nextIncomeDate || troughDate <= nextIncomeDate);
  /** Phrase d'explication du point bas, ajoutée au message de la carte et affichée dans le détail. */
  const troughExplain = troughLimits
    ? `Le ${shortDay(troughDate)} : c'est le jour où ton solde sera au plus bas (${eur(cashflowTrough)}).`
      + (nextIncomeDate && nextIncomeAmount > 0
        ? ` Ta rentrée d'argent du ${shortDay(nextIncomeDate)} (+${eur(nextIncomeAmount)}) le fera remonter.`
        : '')
    : '';
  // Revenu non déclaré en récurrent → le moteur l'INFÈRE et ne le compte que partiellement (pondéré
  // par la prudence) : le Relyka est durablement sous-évalué. On le dit, avec l'action qui corrige.
  const incomeIsGuessed = !!pilotageData && pilotageData.expected_income_source !== 'explicit';
  // Tout ce que l'utilisateur a MIS DE CÔTÉ ce mois-ci et qu'il POSSÈDE ENCORE : épargne et
  // investissement (déjà virés — donc déjà dans le point bas — ou seulement prévus), réservé de
  // projet, réservations et cumuls. À distinguer de l'argent DÉPENSÉ, lui vraiment parti.
  const misDeCoteTotal =
    (pilotageData?.month_savings_total ?? 0)
    + (pilotageData?.month_invest_total ?? 0)
    + (pilotageData?.monthly_reserve_planned ?? 0)
    + reservationsTotal
    + cumulsTotal;
  // Le Relyka est à 0 parce que cet argent est RANGÉ AILLEURS, et non parce que l'utilisateur est à
  // sec : on remet tout ce qu'il a mis de côté et on regarde s'il lui resterait quelque chose.
  // Sans ce test, quelqu'un à −1 000 € qui a 100 € réservés lirait « rien d'inquiétant ».
  const relykaAlloueVolontairement =
    misDeCoteTotal > 0 && resteDisponibleBrut + misDeCoteTotal > 0;
  const baseADepenser = pilotageData?.safe_to_spend ?? 0;
  const enDepassement = cumulsTotal > baseADepenser && baseADepenser > 0;

  // ── Compte encore vide : un Relyka à 0 € doit DIRE POURQUOI ────────────────────────────────────
  // Sur un compte neuf, « ce qu'il te reste à décider ce mois-ci » ne veut rien dire : il n'y a
  // encore rien à décider, et le chiffre à 0 passe pour une mauvaise nouvelle alors qu'il n'est
  // qu'un calcul sans données. On nomme la donnée manquante, et le geste qui la fournit.
  const hasRecurringTx = (txPersoForConseils as any[]).some((t) => t.is_recurring && t.recurrence_rule);

  /* ── Le tableau de bord a-t-il quelque chose à dire ? ───────────────────────────────────────────
     Sans compte : rien du tout (tous les chiffres valent 0) → accueil à la place.
     Sans opération : les soldes existent, mais ni les entrées ni les sorties → accueil aussi.
     ⚠️ Une régularisation de solde n'est PAS une saisie de l'utilisateur : la création d'un compte
     avec un solde en produit une, et elle ferait disparaître le message alors qu'il reste vrai. */
  const noAccountsYet = accounts.length === 0;
  const hasAnyTx = (txPersoForConseils as any[]).some(
    (t) => !(typeof t.note === 'string' && /r[ée]gularisation|ajustement de solde/i.test(t.note)),
  );
  const firstName = ((profile as any)?.full_name ?? '').trim().split(/\s+/)[0] || null;
  const setupIncomplete = relykaAffiche <= 0 && (accounts.length === 0 || !hasRecurringTx);
  const setupHint = accounts.length === 0
    ? "Ton Relyka est à 0 € : il n'a encore rien à calculer. Crée tes comptes avec leur solde d'aujourd'hui pour le faire apparaître."
    : "Ton Relyka est à 0 € : Relyka ne sait pas encore ce qui rentre ni ce qui part. Enregistre ta rentrée d'argent et tes charges fixes en récurrentes — il se calculera tout seul.";

  /* ── PENDANT L'INSTALLATION, PAS DE TABLEAU DE BORD ────────────────────────────────────────────
     Le Relyka n'est pas calculable tant qu'il manque les comptes ou les flux du mois : le montrer
     à 0 € avec ses quatre recommandations vides ferait croire que l'app ne sert à rien, au moment
     précis où il faut au contraire dire quoi faire ensuite. On remplace donc TOUT le contenu par
     l'accueil, dont le bouton porte la prochaine action.
     Deux façons d'y entrer, et c'est voulu : le PARCOURS de démarrage (guide.inSetup, qui suit ses
     propres étapes), et le simple constat « aucun compte / aucune opération » — qui vaut aussi pour
     un compte ancien vidé de ses données, lequel n'est plus dans le parcours. */
  const welcomeStep: import('../../components/PilotageWelcome').WelcomeStep | null =
    userGuide.is('accounts') ? 'accounts'
    : userGuide.is('accounts_checking') ? 'checking'
    : userGuide.is('accounts_savings') ? 'savings'
    : userGuide.is('tx_recurring') ? 'recurring'
    // Constat « aucun compte / aucune opération » : ne vaut que sur des lectures ABOUTIES
    // (cf. baseDataReady) — sinon l'accueil s'affiche pendant le chargement d'un compte installé.
    : !baseDataReady ? null
    : noAccountsYet ? 'accounts'
    : !hasAnyTx ? 'recurring'
    : null;
  /** Où le bouton de l'accueil emmène : là où l'étape se joue réellement. */
  const welcomeRoute = welcomeStep === 'recurring' ? '/(tabs)/transactions' : '/(tabs)/comptes';

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
        const trough = d.cashflow_trough ?? d.current_checking_balance ?? 0;
        const after = floorToTen(Math.max(0,
          trough - (d.month_savings_future ?? 0) - (d.month_invest_future ?? 0)
          - (d.monthly_reserve_planned ?? 0) - reservationsTotal - cumulsTotal
          - (d.variable_envelope_remaining ?? 0) - (d.safety_margin_amount ?? 0)));
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

  // ── Confiance (fourchettes) : une seule fonction de doute, alimentée par le VRAI Relyka. ──
  const relConf = React.useMemo(
    () => (reliabilityCfg && pilotageData ? deriveRelykaConfidence(pilotageData, resteDisponible, reliabilityCfg) : null),
    [reliabilityCfg, pilotageData, resteDisponible],
  );

  // ── Budget de recommandation (§P7) ──
  // Options du moteur construites par lib/recoInputs (budget brut reconstitué, alreadyAllocated,
  // cascade, garde-fou projection, plafond Relyka) — PARTAGÉES avec le Pouls (capacité de la carte
  // « Investissement du mois ») : les deux écrans racontent la même histoire.
  // MÉMOÏSÉ (perf) : ces deux blocs faisaient tourner le moteur de recos À CHAQUE re-rendu de
  // l'écran (le plus lourd de l'app) — y compris au rattrapage post-gel du changement d'onglet.
  const recoOptions = React.useMemo(() => (
    pilotageData
      ? buildRecoOptions(pilotageData, {
          reservationsTotal,
          preEpargneTotal,
          preInvestTotal,
          prudenceLevel: ((profile as any)?.prudence_level ?? null) as number | null,
          financialProfileId: financialProfile?.profile_id as FinancialProfileId | undefined,
          thresholds: recoThresholds,
          customTierAllocations: customTiers,
        })
      : null
  ), [pilotageData, reservationsTotal, preEpargneTotal, preInvestTotal, profile, financialProfile, recoThresholds, customTiers]);
  // Garde-fou : aucune reco ne peut dépasser le reste réellement disponible (Ton Relyka).
  // Plafond passé AU MOTEUR (maxAmount) et non appliqué après coup : sinon la description et les
  // conseils interpolent le montant d'avant-plafond (ex. « Conserve 600 € » avec un titre à 270 €).
  const recoList = React.useMemo(() => {
    if (!pilotageData || !recoOptions) return [];
    // Couleur d'affichage par type de reco — alignée sur les couleurs sémantiques du thème
    // (clair/sombre) plutôt que sur les teintes fixes de l'engine, qui restaient trop claires
    // en mode clair (ex. épargne #34d399 au lieu du vert défini #059669).
    const recoColorByType: Record<string, string> = {
      save:   COLORS.green,
      invest: COLORS.violet,
      enjoy:  COLORS.orange,
      keep:   COLORS.blue,
    };
    return computeRecommendations(pilotageData, {
      ...recoOptions,
      // Montant « actionnable » (textes + CTA). Le doute est DIRECTIONNEL :
      //  • épargner / investir SORTENT l'argent du compte (irréversible) → borne basse « minimum
      //    sûr », mais planchée (relConf.actionable) pour ne jamais proposer 0 € ;
      //  • « Conserver » ne sort rien du compte : en cas de doute il faut en garder PLUS, pas moins
      //    → montant plein. Proposer la borne basse revenait à conseiller de mettre moins de côté
      //    justement parce qu'on est moins sûr de soi.
      actionAmountFor: (amount, type) => {
        if (type === 'keep') return { value: amount, isRange: false };
        const r = relConf?.actionable(amount);
        return r?.isRange
          ? { value: Math.max(0, floorToTen(r.low)), isRange: true }
          : { value: amount, isRange: false };
      },
    }).map((r) => ({
      ...r,
      color: recoColorByType[r.type] ?? r.color,
    }));
  }, [pilotageData, recoOptions, relConf, COLORS]);

  /* ── Message de BASE du Relyka : ce qu'EST le chiffre ──────────────────────────────────────────
     Quand le Relyka est POSITIF, la phrase est passe-partout (« voici ce qu'il devrait te rester…
     utilise-le librement ») : elle ne vaut que si elle est seule à l'écran — d'où `isGeneric`, que
     buildRelykaMessages utilise pour l'effacer dès qu'un autre message a du concret à dire.
     Les autres variantes QUALIFIENT le montant (budget dépassé, plus de marge, tout est rangé
     ailleurs) : elles restent toujours affichées, en tête.
     Le point bas et le revenu deviné ne sont PLUS collés à cette phrase : ce sont des messages à
     part entière, chacun son tour de carrousel. */
  const relykaBase = React.useMemo(() => {
    if (relykaAffiche < 0) {
      return { text: 'Budget dépassé ce mois-ci — mieux vaut lever le pied sur les dépenses.', isGeneric: false };
    }
    if (relykaAffiche <= 0) {
      // Relyka à 0 par CHOIX (réservations / cumuls) : c'est le geste qu'on a recommandé — on le
      // salue au lieu d'alerter. Sinon seulement, on met en garde.
      if (relykaAlloueVolontairement) {
        return {
          text: `Rien d'inquiétant : tu as mis ${Math.round(misDeCoteTotal).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL} de côté ce mois-ci (épargne, investissement, réservé).`,
          isGeneric: false,
        };
      }
      return {
        text: Math.round(Math.max(0, variableEnvelopeRemaining)) > 0
          ? 'Ton Relyka est épuisé - tout ton argent est alloué, donc reste prudent.'
          : 'Pas de marge — évite de dépenser avant ta prochaine rentrée d\'argent.',
        isGeneric: false,
      };
    }
    return {
      text: relConf?.relykaRange.isRange
        ? 'Voici ce qu\'il devrait te rester à la fin du mois. Tu peux suivre les recommandations — vérifie ton solde pour affiner l\'estimation.'
        : 'Voici ce qu\'il devrait te rester à la fin du mois. Utilise ton Relyka librement, idéalement en suivant les recommandations.',
      isGeneric: true,
    };
  }, [relykaAffiche, relykaAlloueVolontairement, misDeCoteTotal, variableEnvelopeRemaining, relConf]);

  /** Données de projection alimentant l'encadré contextuel des recos (les deux vues). */
  const recoFinancials = recoContextEnabled && pilotageData
    ? { currentChecking: pilotageData.current_checking_balance, projectedEndChecking: pilotageData.projection_balances_6m?.[0] }
    : undefined;

  /* Les messages des DÉCISIONS (description + projection de chaque reco), à plat : ils défilent
     sous les quatre tuiles, au lieu de n'afficher que des montants nus. */
  const recoMessages = React.useMemo(() => buildRecoMessages({
    recommendations: recoList,
    financials: recoFinancials,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [recoList, recoContextEnabled, pilotageData]);

  /* Les messages du CHIFFRE PRINCIPAL, déroulés sous le montant : garde-fou marge × projection,
     consigne « solde non vérifié » (que portait le bandeau ambre), point bas de trésorerie, revenu
     deviné — et la phrase de base seulement si elle a quelque chose à apporter (cf. isGeneric).
     Ils ne se mélangent pas aux décisions : ils commentent tout l'écran, pas une tuile. */
  const relykaMessages = React.useMemo(() => buildRelykaMessages({
    baseMessage: relykaBase.text,
    baseIsGeneric: relykaBase.isGeneric,
    troughMessage: troughExplain,
    incomeGuessedMessage: incomeIsGuessed
      ? 'Ta rentrée d\'argent principale est estimée à partir de ton historique : enregistre-la en récurrente pour un Relyka plus juste.'
      : null,
    guardMessage: composeGuardMessage(recoList.filter((r) => r.amount > 0)),
    unverifiedMessage: relConf?.result.level === 'low'
      ? `Solde non vérifié ${unverifiedSincePhrase(relConf.result.daysSinceVerification)} — fais une régul ou saisis tes dépenses pour l'actualiser.`
      : null,
    relykaColor: relykaAffiche > 0 ? COLORS.emerald : relykaAlloueVolontairement ? COLORS.blue : relykaAffiche < 0 ? COLORS.danger : COLORS.orange,
    warnColor: COLORS.orange,
  }), [relykaBase, troughExplain, incomeIsGuessed, recoList, relConf, relykaAffiche, relykaAlloueVolontairement, COLORS]);

  // ── Détails du « Suivi du mois » (listes pour les modaux au clic, §3) ──
  const suiviDetail = React.useMemo(() => {
    // Données FILTRÉES par le périmètre quotidien (comme le moteur) : les modaux (dépenses, épargne,
    // investi, récurrentes) et le solde courant ne comptent QUE le périmètre du user.
    const accounts = accountsForSuivi;
    const txForConseils = txForSuivi;
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
    // Le PASSÉ se lit sur les VRAIES lignes matérialisées, jamais déduit de l'ancre du modèle —
    // voir lib/recurrenceMonth (testé) pour le pourquoi et les cas limites.
    const y = now.getFullYear(), mo = now.getMonth() + 1;
    const daysInMonth = new Date(y, mo, 0).getDate();
    const materializedThisMonth = buildMaterializedIndex(txForConseils as any[], monthPrefix);
    const recurForMonth = (t: any) => recurrenceForMonth(t, materializedThisMonth, now);
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
      // Quand l'occurrence est matérialisée, on prend SA date réelle plutôt que le jour du modèle.
      const startDay = new Date((t.date ?? '').slice(0, 10) + 'T00:00:00').getDate() || 1;
      const monthDate = materializedThisMonth.get(t.id)?.lastDate
        ?? `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(startDay, daysInMonth)).padStart(2, '0')}`;
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
  }, [txForSuivi, accountsForSuivi]);

  // Récurrentes du mois PAS ENCORE passées (montant restant + nombre). Elles sortiront du compte
  // exactement comme les dépenses variables : la vue simplifiée les additionne donc sur la ligne
  // « Tu devrais encore dépenser », et son modal les détaille.
  const recurUpcoming = React.useMemo(() => {
    const refCode = profile?.currency_code ?? 'EUR';
    const curByAcc: Record<string, string> = {};
    accounts.forEach((a: any) => { curByAcc[a.id] = a.currency; });
    let amount = 0;
    const list: any[] = [];
    for (const t of suiviDetail.recurrentes) {
      const left = Math.max(0, (t._monthTotal ?? 0) - (t._monthPassed ?? 0));
      if (left <= 0) continue;
      amount += convertAmount(left, curByAcc[t.account_id] || refCode, refCode, rates) ?? left;
      list.push({ ...t, _left: left });
    }
    return { amount, count: list.length, list };
  }, [suiviDetail, accounts, profile?.currency_code, rates]);

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
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right']}>
          <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
        </SafeAreaView>
      </View>
    );
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
              {/* Conservé du mois — même forme que les cumuls, tap → saisie manuelle (0 pour libérer). */}
              <Text style={styles.reservedSectionLabel}>Conservé ce mois</Text>
              <TouchableOpacity
                style={styles.reservedItem}
                activeOpacity={0.7}
                onPress={() => { setConserveInput(reservationsTotal > 0 ? String(Math.round(reservationsTotal)) : ''); setShowReservedModal(false); setShowConserveModal(true); }}
              >
                <View style={[styles.reservedItemIcon, { backgroundColor: COLORS.blue + '22' }]}>
                  <Ionicons name="hourglass-outline" size={16} color={COLORS.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reservedItemName}>Conservé sur le compte courant</Text>
                  <Text style={styles.reservedItemHint}>
                    {reservationsTotal > 0 ? 'Se réinitialise chaque mois · appuyez pour modifier' : 'Appuyez pour conserver un montant'}
                  </Text>
                </View>
                <Text style={[styles.reservedItemAmount, { color: reservationsTotal > 0 ? COLORS.blue : COLORS.textSecondary }]}>{fmtMain(reservationsTotal)}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
              {reservationsTotal > 0 && (
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
          <Pressable style={[styles.detailBox, isDesktop && styles.detailBoxDesktop]} onPress={() => {}}>
            {(() => {
              const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
              // Montant d'une transaction CONVERTI dans la devise de référence (comme les curseurs).
              // Sans ça, un virement cross-devises (ex. −999,50 ¥) s'affichait « 1000 € » au lieu de ≈ 6 €,
              // d'où l'écart modal/curseur sur Épargné / Investi / Dépensé.
              const refCode = profile?.currency_code ?? 'EUR';
              const curByAcc: Record<string, string> = {};
              accounts.forEach((a) => { curByAcc[a.id] = a.currency; });
              const toRefAmt = (amt: number, accountId: string) => convertAmount(amt, curByAcc[accountId] || refCode, refCode, rates) ?? amt;
              // Montant affiché = override mensuel du template s'il existe (occurrence modifiée pour CE
              // mois), sinon le montant brut. Sans ça le modal Épargne/Investi/Dépensé garde l'ancien
              // montant figé alors que le curseur (et les transactions) montrent déjà le bon.
              const ovrMap: Record<string, number> = (pilotageData as any).monthOverrides ?? {};
              const toRef = (t: any) => toRefAmt(ovrMap[t.id] != null ? ovrMap[t.id] : Math.abs(Number(t.amount)), t.account_id);
              // Dépensé récurrent / variable du mois (mêmes valeurs que les curseurs « dont … »).
              const recurSpentMonth = Math.min(suiviDetail.recurringTotal ?? 0, suiviDetail.recurringPassed ?? 0);
              // Même source unique que le curseur « dont variables » (cf. `varSpent`).
              const varSpentMonth = pilotageData.variable_envelope_spent
                ?? Math.max(0, (pilotageData.month_expenses_past ?? 0) - recurSpentMonth);
              const dts = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
              const lbl = (t: any) => t.note || t.category?.name || 'Opération';
              const titles: Record<string, string> = {
                checking: 'Budget courant actuel', savings: 'Épargne du mois', invest: 'Investissement du mois',
                spent: 'Dépensé ce mois', planned: 'Dépenses prévues restantes',
                planned_simple: 'Ce qui va encore sortir', relyka: 'Ton Relyka (Budget libre)',
              };
              // Une dépense est « récurrente » soit parce qu'elle a été matérialisée depuis un modèle
              // (`materialized_from` — la migration 030 retire alors `is_recurring`), soit parce que
              // c'est le modèle lui-même, encore ancré sur une date passée du mois.
              const isRecurringTx = (t: any) => !!t.materialized_from || (t.is_recurring && t.recurrence_rule);
              // Épargné / Investi : lignes CLIQUABLES → feuille de détail (Fermer / Modifier).
              // Lignes tapables (→ détail de la transaction) dans TOUS les modaux de suivi : épargné,
              // investi, total dépensé et dépenses prévues/récurrentes (§3).
              const rowsTappable = detailKey === 'savings' || detailKey === 'invest' || detailKey === 'spent' || detailKey === 'planned';
              // `amountOf` : montant à AFFICHER quand ce n'est pas celui de la ligne. Cas réel : une
              // récurrente hebdomadaire dont il reste 2 occurrences sur 4 — le modèle porte le montant
              // d'UNE occurrence, alors que le total « À venir » compte les deux. Sans ce crochet, la
              // somme des lignes ne tombait pas sur le total affiché juste au-dessus.
              const txList = (list: any[], color: string, empty: string, dim?: (t: any) => boolean, amountOf?: (t: any) => number) => (
                list.length === 0 ? <Text style={styles.detailEmpty}>{empty}</Text> :
                list.map((t, i) => {
                  // Remboursement = montant positif (argent qui revient) → vert avec « + ».
                  const amt = Number(t.amount);
                  const isRefund = amt > 0;
                  // « Grisé » = occurrence à venir (non encore échue) → non comptée dans le total.
                  const dimmed = dim ? dim(t) : false;
                  const valColor = dimmed ? COLORS.textSecondary : (isRefund ? semanticText(COLORS.green, COLORS) : color);
                  return (
                    <TouchableOpacity
                      key={t.id ?? i}
                      style={[styles.detailRow, dimmed && { opacity: 0.5 }]}
                      activeOpacity={rowsTappable ? 0.7 : 1}
                      disabled={!rowsTappable}
                      onPress={() => setSuiviTx(t)}
                    >
                      <Ionicons name={iconForTransaction(t) as any} size={16} color={isRefund && !dimmed ? semanticText(COLORS.green, COLORS) : COLORS.textSecondary} style={{ marginRight: 10 }} />
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailRowLabel} numberOfLines={1}>{lbl(t)}</Text>
                          {/* Date de la transaction (au lieu de la périodicité). */}
                          <Text style={styles.detailRowSub}>{dts(t._monthDate ?? t.date)}{dimmed ? ' · à venir' : ''}</Text>
                        </View>
                        {/* #2 — opération d'un compte partagé : mini-bulle indiquant le % d'impact appliqué. */}
                        {t._impact_pct != null && t._impact_pct < 100 && (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: COLORS.blue + '1A', borderWidth: 1, borderColor: COLORS.blue + '44' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.blue }}>{t._impact_pct}%</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.detailRowValue, { color: valColor }]}>{(isRefund ? '+' : '') + fmt(amountOf ? amountOf(t) : toRef(t))}</Text>
                    </TouchableOpacity>
                  );
                })
              );
              return (
                <>
                  <View style={styles.detailHeader}>
                    <Text style={[styles.detailTitle, isDesktop && styles.detailTitleDesktop]}>{detailKey === 'planned' ? (plannedTab === 'recurrentes' ? 'Dépenses récurrentes' : 'Dépenses variables prévues restantes') : (detailKey ? titles[detailKey] : '')}</Text>
                    {/* Raccourci → toutes les transactions récurrentes (dépenses + recettes + virements). */}
                    {/* Raccourci « toutes les récurrentes » : seulement sur « ce qui va encore
                        sortir », où il complète la lecture. Dans « Dépensé ce mois », il envoyait
                        vers une liste de MODÈLES alors qu'on regarde des opérations passées. */}
                    {detailKey === 'planned_simple' && (
                      <TouchableOpacity onPress={() => { setDetailKey(null); setShowRecurringModal(true); }} style={{ padding: 4, marginRight: 2 }} accessibilityLabel="Toutes les transactions récurrentes">
                        <Ionicons name="repeat" size={20} color={COLORS.orange} />
                      </TouchableOpacity>
                    )}
                    {detailKey === 'planned' && plannedTab === 'recurrentes' && (
                      <TouchableOpacity onPress={() => { setDetailKey(null); setShowRecurringModal(true); }} style={{ padding: 4, marginRight: 2 }} accessibilityLabel="Toutes les transactions récurrentes">
                        <Ionicons name="repeat" size={20} color={COLORS.emerald} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setDetailKey(null)} style={{ padding: 4 }}>
                      <Ionicons name="close" size={22} color={COLORS.text} />
                    </TouchableOpacity>
                  </View>
                  {/* Hauteur de lecture calée sur la FENÊTRE (et non figée à 420 px) : sur un grand
                      écran on voit enfin la liste sans défiler, sur un petit la feuille reste
                      entièrement visible. */}
                  <ScrollView style={{ maxHeight: detailScrollMaxHeight }} showsVerticalScrollIndicator={false}>
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
                      // Filtre « Récurrentes » : combiné au filtre par catégorie, il répond à la
                      // question « qu'est-ce que je paie tous les mois, là-dedans ? ».
                      const recurSpent = suiviDetail.spent.filter(isRecurringTx);
                      // Filtre « À venir » : les occurrences récurrentes du mois PAS ENCORE prélevées.
                      // Elles ne sont évidemment pas « dépensées » — elles ne comptent donc dans aucun
                      // total, et s'affichent grisées, exactement comme dans le modal des récurrentes.
                      // Mais c'est ici qu'on se pose la question « et qu'est-ce qui va encore tomber ? ».
                      const upcomingList = recurUpcoming.list;
                      const viewingUpcoming = spentUpcomingOnly && upcomingList.length > 0;

                      /* ⚠️ Le graphique se calcule sur la liste FILTRÉE, pas sur toutes les dépenses.
                         Seul le montant au centre suivait les filtres : l'anneau et sa légende
                         restaient ceux du mois entier, si bien qu'en cochant « Récurrentes » on
                         lisait un total récurrent posé sur une répartition qui ne l'était pas. */
                      const chartSource = viewingUpcoming ? upcomingList
                        : spentRecurOnly ? recurSpent
                        : suiviDetail.spent;

                      const groups: Record<string, { key: string; total: number; icon: string; color: string }> = {};
                      for (const t of chartSource) {
                        const key = parentOf(t);
                        (groups[key] ??= { key, total: 0, icon: iconForCategory(t.category), color: '' });
                        groups[key].total += toRef(t);
                      }
                      const palette = [COLORS.danger, COLORS.orange, COLORS.violet, COLORS.blue, COLORS.green, COLORS.teal, COLORS.yellow, COLORS.emerald, COLORS.checking];
                      const arr = Object.values(groups).sort((a, b) => b.total - a.total);
                      arr.forEach((g, i) => { g.color = palette[i % palette.length]; });
                      const totalSpent = arr.reduce((s, g) => s + g.total, 0);

                      /* Catégorie choisie AVANT de cocher « Récurrentes » : elle peut ne plus exister
                         dans la nouvelle répartition (rien de récurrent dans cette catégorie). On
                         l'ignore alors, au lieu d'afficher une liste vide et un total à 0. */
                      const effectiveFilter = spentFilter && groups[spentFilter] ? spentFilter : null;
                      const filtered = effectiveFilter
                        ? chartSource.filter((t) => parentOf(t) === effectiveFilter)
                        : chartSource;
                      // Centre de l'anneau : ce que la liste affichée représente réellement.
                      const centerVal = effectiveFilter ? (groups[effectiveFilter]?.total ?? 0) : totalSpent;
                      // Totaux des PASTILLES : ce qu'elles sélectionneraient, donc calculés hors filtre.
                      const recurSpentTotal = recurSpent.reduce((s, t) => s + toRef(t), 0);
                      const upcomingTotal = recurUpcoming.amount;
                      return (
                        <>
                          {arr.length > 0 && (
                            <>
                              <View style={isDesktop ? styles.chartBlockDesktop : undefined}>
                                <View style={{ alignItems: 'center', marginBottom: isDesktop ? 0 : 10 }}>
                                  <CategoryDonut
                                    segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                                    size={isDesktop ? 184 : 150}
                                    strokeWidth={isDesktop ? 24 : 20}
                                    activeKey={effectiveFilter}
                                    centerLabel={fmt(centerVal)}
                                    centerSub={viewingUpcoming ? 'à venir' : spentRecurOnly ? 'récurrent' : undefined}
                                    centerColor={COLORS.text}
                                    centerSubColor={COLORS.textSecondary}
                                  />
                                </View>
                                <View style={isDesktop ? styles.chartLegendDesktop : undefined}>
                                  <View style={styles.pieLegend}>
                                    {arr.map((g) => {
                                      const active = effectiveFilter === g.key;
                                      return (
                                        <TouchableOpacity
                                          key={g.key}
                                          style={[styles.pieLegendItem, active && { borderColor: g.color, backgroundColor: g.color + '1A' }]}
                                          onPress={() => { setSpentUpcomingOnly(false); setSpentFilter(active ? null : g.key); }}
                                          activeOpacity={0.7}
                                          {...hoverRow}
                                          {...scrollFriendlyPress}
                                        >
                                          <View style={[styles.pieDot, { backgroundColor: g.color }]} />
                                          <Ionicons name={g.icon as any} size={13} color={COLORS.textSecondary} />
                                          <Text style={styles.pieLegendText} numberOfLines={1}>{g.key}</Text>
                                          <Text style={[styles.pieLegendVal, { color: g.color }]}>{fmt(g.total)}</Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                  {/* Filtres TRANSVERSES, sur leur propre ligne : ce ne sont pas des
                                      parts du camembert, ils traversent toutes les catégories. */}
                                  {(recurSpent.length > 0 || upcomingList.length > 0) && (
                                    <View style={styles.filterBar}>
                                      <Text style={styles.filterBarLabel}>Filtres</Text>
                                      {recurSpent.length > 0 && (
                                        <TouchableOpacity
                                          style={[styles.filterChip, spentRecurOnly && { borderColor: COLORS.orange, backgroundColor: COLORS.orange + '1A' }]}
                                          onPress={() => { setSpentUpcomingOnly(false); setSpentRecurOnly((v) => !v); }}
                                          activeOpacity={0.7}
                                          {...hoverRow}
                                          {...scrollFriendlyPress}
                                        >
                                          <Ionicons name="repeat" size={13} color={COLORS.orange} />
                                          <Text style={styles.filterChipText} numberOfLines={1}>Récurrentes</Text>
                                          <Text style={[styles.filterChipVal, { color: semanticText(COLORS.orange, COLORS) }]}>{fmt(recurSpentTotal)}</Text>
                                        </TouchableOpacity>
                                      )}
                                      {upcomingList.length > 0 && (
                                        <TouchableOpacity
                                          style={[styles.filterChip, viewingUpcoming && { borderColor: COLORS.textSecondary, backgroundColor: COLORS.textSecondary + '1A' }]}
                                          onPress={() => { setSpentRecurOnly(false); setSpentFilter(null); setSpentUpcomingOnly((v: boolean) => !v); }}
                                          activeOpacity={0.7}
                                          {...hoverRow}
                                          {...scrollFriendlyPress}
                                        >
                                          <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
                                          <Text style={styles.filterChipText} numberOfLines={1}>À venir</Text>
                                          <Text style={[styles.filterChipVal, { color: COLORS.textSecondary }]}>{fmt(upcomingTotal)}</Text>
                                        </TouchableOpacity>
                                      )}
                                    </View>
                                  )}
                                </View>
                              </View>
                              <View style={styles.suiviDivider} />
                            </>
                          )}
                          {viewingUpcoming
                            ? txList(
                                filtered, COLORS.textSecondary, 'Aucune récurrente à venir ce mois.',
                                () => true,
                                // Montant RESTANT du mois (`_left`, posé par recurUpcoming) → Σ lignes = total du filtre.
                                (t: any) => toRefAmt(t._left ?? 0, t.account_id),
                              )
                            : txList(filtered, semanticText(COLORS.danger, COLORS), 'Aucune dépense passée ce mois.')}
                        </>
                      );
                    })()}
                    {/* ── Vue SIMPLIFIÉE : « Tu devrais encore dépenser » ──────────────────────────────
                        Modal DÉDIÉ (le modal `planned` de la vue détaillée répond à une autre
                        question, on n'y touche pas). Ici, une seule idée : ce qui va encore sortir
                        du compte d'ici la fin du mois — les dépenses variables estimées ET les
                        récurrentes qui n'ont pas encore été prélevées. */}
                    {detailKey === 'planned_simple' && (() => {
                      const varLeft = Math.max(0, pilotageData.variable_envelope_remaining ?? 0);
                      const recurLeft = Math.max(0, recurUpcoming.amount);
                      // CONTEXTE de l'enveloppe variable. Sans lui, la ligne affichait « 0 € » sans
                      // rien qui l'explique : l'enveloppe était simplement déjà consommée, mais ni le
                      // montant estimé ni ce qui avait été dépensé n'apparaissaient nulle part.
                      const varEnvelope = Math.max(0, pilotageData.variable_envelope_initial ?? 0);
                      const varUsed = Math.max(0, varSpentMonth);
                      const varRatio = varEnvelope > 0 ? Math.min(1, varUsed / varEnvelope) : 0;
                      const varExhausted = varEnvelope > 0 && varUsed >= varEnvelope;
                      const barColor = varExhausted ? semanticText(COLORS.danger, COLORS) : semanticText(COLORS.orange, COLORS);
                      return (
                        <View style={{ gap: 6, paddingTop: 4 }}>
                          <View style={styles.detailRow}>
                            <Text style={[styles.detailRowLabel, { flex: 1 }]}>Total à venir</Text>
                            <Text style={[styles.detailRowValue, { color: semanticText(COLORS.yellow, COLORS) }]}>{fmt(varLeft + recurLeft)}</Text>
                          </View>

                          <View style={styles.suiviDivider} />

                          <View style={styles.detailRow}>
                            <Text style={[styles.detailRowLabel, { flex: 1 }]}>Dépenses variables estimées</Text>
                            <Text style={[styles.detailRowValue, { color: semanticText(COLORS.orange, COLORS) }]}>{fmt(varLeft)}</Text>
                          </View>

                          {/* D'où sort ce chiffre — version COMPACTE : une barre, et l'enveloppe /
                              le dépensé / le reste sur UNE ligne au lieu de trois. Le modal tenait
                              sur deux écrans de haut ; il tient maintenant d'un coup d'œil. */}
                          {(varEnvelope > 0 || varUsed > 0) && (
                            <View style={styles.envBlock}>
                              {varEnvelope > 0 && (
                                <View style={styles.envBarTrack}>
                                  <View style={[styles.envBarFill, { width: `${Math.round(varRatio * 100)}%`, backgroundColor: barColor }]} />
                                </View>
                              )}
                              <View style={styles.envInline}>
                                <View style={styles.envInlineItem}>
                                  <Text style={styles.envInlineLabel}>Enveloppe</Text>
                                  <Text style={[styles.envInlineVal, { color: varEnvelope > 0 ? COLORS.text : COLORS.textSecondary }]}>
                                    {varEnvelope > 0 ? fmt(varEnvelope) : '—'}
                                  </Text>
                                </View>
                                <View style={styles.envInlineItem}>
                                  <Text style={styles.envInlineLabel}>Dépensé</Text>
                                  <Text style={[styles.envInlineVal, { color: barColor }]}>{fmt(varUsed)}</Text>
                                </View>
                                <View style={styles.envInlineItem}>
                                  <Text style={styles.envInlineLabel}>Reste</Text>
                                  <Text style={[styles.envInlineVal, { color: varLeft > 0 ? semanticText(COLORS.orange, COLORS) : COLORS.textSecondary }]}>{fmt(varLeft)}</Text>
                                </View>
                              </View>
                            </View>
                          )}

                          {/* ── D'OÙ VIENT L'ENVELOPPE : le choix appartient à l'utilisateur ──────
                              L'app décidait seule (réel dès 2 mois, sinon estimation). On expose les
                              trois positions, avec la valeur de CHACUNE : on voit immédiatement ce
                              qu'on gagnerait ou perdrait à basculer, au lieu de le deviner. */}
                          <View style={styles.varModeRow}>
                            {([
                              ['auto', 'Auto', pilotageData.variable_real_available ? pilotageData.variable_real_value : pilotageData.variable_estimate_value],
                              ['estimate', 'Estimation', pilotageData.variable_estimate_value],
                              // « Calculé » et non « Réel » : c'est une MOYENNE de tes mois passés,
                              // pas ce que tu as dépensé ce mois-ci. « Réel » laissait croire à un
                              // relevé du mois en cours.
                              ['real', 'Calculé', pilotageData.variable_real_value],
                            ] as [ 'auto' | 'estimate' | 'real', string, number ][]).map(([key, label, value]) => {
                              const on = varMode === key;
                              const unavailable = key === 'real' && !pilotageData.variable_real_available;
                              return (
                                <TouchableOpacity
                                  key={key}
                                  style={[styles.varModeChip, on && styles.varModeChipOn, unavailable && { opacity: 0.45 }]}
                                  onPress={() => !unavailable && setVarMode(key)}
                                  disabled={unavailable}
                                  activeOpacity={0.75}
                                  accessibilityRole="button"
                                >
                                  <Text style={[styles.varModeLabel, on && styles.varModeLabelOn]}>{label}</Text>
                                  <Text style={[styles.varModeValue, on && styles.varModeLabelOn]}>
                                    {unavailable ? '2 mois requis' : value > 0 ? fmt(value) : '—'}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          {/* D'où sort le chiffre du mode ACTIF — la question qu'on se pose en
                              voyant trois montants différents côte à côte. */}
                          <Text style={styles.detailNote}>
                            {varMode === 'auto'
                              ? (pilotageData.variable_real_available
                                  ? `Auto : dès que tu as 2 mois complets, Relyka bascule sur le calculé — ici la moyenne de tes ${pilotageData.variable_real_months} derniers mois (hors mois non clôturés).`
                                  : 'Auto : tant que tu n’as pas 2 mois complets derrière toi, Relyka s’en tient à ton estimation. Il passera au calculé tout seul ensuite.')
                              : varMode === 'real'
                              ? `Calculé : moyenne de tes ${pilotageData.variable_real_months} derniers mois de dépenses variables (les mois non clôturés sont exclus).`
                              : 'Estimation : le montant que tu as déclaré toi-même (ton budget hebdomadaire ramené au mois).'}
                          </Text>
                          <Text style={styles.detailNote}>
                            {varEnvelope <= 0
                              ? 'Aucun budget variable habituel n\'est encore estimé : tant qu\'il vaut 0 €, Relyka ne prévoit aucune dépense variable pour la fin du mois. Indique ton estimation pour que le calcul démarre.'
                              : varExhausted
                              ? `Enveloppe déjà consommée (${fmt(varUsed)} sur ${fmt(varEnvelope)}) : c'est pour ça qu'il ne reste rien à prévoir de ce côté.`
                              : ''}
                          </Text>

                          <View style={styles.varModeActions}>
                            <TouchableOpacity
                              style={styles.detailEditBtn}
                              activeOpacity={0.7}
                              onPress={() => { setDetailKey(null); openVariableInput(); }}
                            >
                              <Ionicons name="create-outline" size={15} color={COLORS.emerald} />
                              <Text style={styles.detailEditBtnText}>Modifier l'estimation</Text>
                            </TouchableOpacity>
                            {varModeDirty && (
                              <TouchableOpacity
                                style={styles.varModeSave}
                                activeOpacity={0.85}
                                onPress={saveVariableMode}
                                disabled={savingVarMode}
                              >
                                {savingVarMode
                                  ? <ActivityIndicator size="small" color={COLORS.bg} />
                                  : <><Ionicons name="checkmark" size={15} color={COLORS.bg} /><Text style={styles.varModeSaveText}>Enregistrer</Text></>}
                              </TouchableOpacity>
                            )}
                          </View>

                          <View style={styles.suiviDivider} />

                          <View style={styles.detailRow}>
                            <Text style={[styles.detailRowLabel, { flex: 1 }]}>
                              Récurrentes pas encore passées
                              {recurUpcoming.count > 0 ? ` (${recurUpcoming.count})` : ''}
                            </Text>
                            <Text style={[styles.detailRowValue, { color: semanticText(COLORS.orange, COLORS) }]}>{fmt(recurLeft)}</Text>
                          </View>
                          {recurUpcoming.count === 0 ? (
                            <Text style={styles.detailNote}>
                              Toutes tes dépenses récurrentes du mois sont déjà passées.
                            </Text>
                          ) : (
                            recurUpcoming.list.map((t: any, i: number) => (
                              <TouchableOpacity key={t.id ?? i} style={styles.detailRow} activeOpacity={0.7} onPress={() => setSuiviTx(t)}>
                                <Ionicons name={iconForTransaction(t) as any} size={16} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.detailRowLabel} numberOfLines={1}>{lbl(t)}</Text>
                                  <Text style={styles.detailRowSub}>{dts(t._monthDate ?? t.date)} · à venir</Text>
                                </View>
                                <Text style={[styles.detailRowValue, { color: COLORS.textSecondary }]}>
                                  {fmt(toRefAmt(t._left ?? 0, t.account_id))}
                                </Text>
                              </TouchableOpacity>
                            ))
                          )}
                          {/* Aucun bouton de renvoi en pied (« Voir toutes mes récurrentes »,
                              « Répartition par catégorie ») : ce modal répond à UNE question — ce
                              qui va encore sortir du compte d'ici la fin du mois. La liste complète
                              des récurrentes reste à un tap, par l'icône ↻ de l'entête.
                              ⚠️ Le camembert des récurrentes (branche `detailKey === 'planned'`
                              ci-dessous) n'avait que ce bouton comme entrée : il n'est plus atteint. */}
                        </View>
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
                            // Donut = répartition de TOUTES les récurrentes du mois (échues + à venir) → toujours
                            // visible dès qu'il y a ≥1 récurrente, et filtrable par catégorie même si tout est à venir.
                            const amtOfTotal = (t: any) => passedAmt(t) + upcomingAmt(t);
                            const groups: Record<string, { key: string; total: number; icon: string; color: string }> = {};
                            for (const t of suiviDetail.recurrentes) {
                              const key = parentName(t);
                              (groups[key] ??= { key, total: 0, icon: iconForCategory(t.category), color: '' });
                              groups[key].total += amtOfTotal(t);
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
                                {(arr.length > 0 || upcomingTotal > 0) && (
                                  <>
                                    <View style={isDesktop ? styles.chartBlockDesktop : undefined}>
                                      {arr.length > 0 && (
                                        <View style={{ alignItems: 'center', marginBottom: isDesktop ? 0 : 10 }}>
                                          <CategoryDonut
                                            segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                                            size={isDesktop ? 184 : 150}
                                            strokeWidth={isDesktop ? 24 : 20}
                                            activeKey={viewingUpcoming ? null : recurFilter}
                                            centerLabel={fmt(centerVal)}
                                            centerSub={viewingUpcoming ? 'à venir' : undefined}
                                            centerColor={COLORS.text}
                                            centerSubColor={COLORS.textSecondary}
                                          />
                                        </View>
                                      )}
                                      <View style={isDesktop ? styles.chartLegendDesktop : undefined}>
                                        <View style={styles.pieLegend}>
                                          {arr.map((g) => {
                                            const active = recurFilter === g.key;
                                            return (
                                              <TouchableOpacity
                                                key={g.key}
                                                style={[styles.pieLegendItem, active && { borderColor: g.color, backgroundColor: g.color + '1A' }]}
                                                onPress={() => setRecurFilter(active ? null : g.key)}
                                                activeOpacity={0.7}
                                                {...hoverRow}
                                          {...scrollFriendlyPress}
                                              >
                                                <View style={[styles.pieDot, { backgroundColor: g.color }]} />
                                                <Ionicons name={g.icon as any} size={13} color={COLORS.textSecondary} />
                                                <Text style={styles.pieLegendText} numberOfLines={1}>{g.key}</Text>
                                                <Text style={[styles.pieLegendVal, { color: g.color }]}>{fmt(g.total)}</Text>
                                              </TouchableOpacity>
                                            );
                                          })}
                                        </View>
                                        {/* « À venir » n'est pas une catégorie : c'est un filtre qui traverse
                                            tout le camembert. Il sort donc de la légende, sur sa propre ligne. */}
                                        {upcomingTotal > 0 && (
                                          <View style={styles.filterBar}>
                                            <Text style={styles.filterBarLabel}>Filtres</Text>
                                            <TouchableOpacity
                                              style={[styles.filterChip, viewingUpcoming && { borderColor: COLORS.textSecondary, backgroundColor: COLORS.textSecondary + '1A' }]}
                                              onPress={() => setRecurFilter(viewingUpcoming ? null : UPCOMING_KEY)}
                                              activeOpacity={0.7}
                                              {...hoverRow}
                                          {...scrollFriendlyPress}
                                            >
                                              <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
                                              <Text style={styles.filterChipText} numberOfLines={1}>À venir</Text>
                                              <Text style={[styles.filterChipVal, { color: COLORS.textSecondary }]}>{fmt(upcomingTotal)}</Text>
                                            </TouchableOpacity>
                                          </View>
                                        )}
                                      </View>
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
                                  ? `Estimation basée sur la moyenne de tes ${pilotageData.variable_envelope_months_used} derniers mois.`
                                  : pilotageData.variable_envelope_source === 'onboarding'
                                  ? 'Estimation basée sur le budget variable indiqué à l\'inscription.'
                                  : 'Pas encore assez d\'historique pour estimer tes dépenses variables.'}
                              </Text>
                              {/* Info non renseignée (ex. questionnaire passé) → estimation à 0 €. On renvoie
                                  vers « Mon profil financier » pour la compléter (profil fiable). */}
                              {pilotageData.variable_envelope_source !== 'history' && !profile?.weekly_variable_budget && (
                                <TouchableOpacity
                                  style={styles.varProfileBanner}
                                  activeOpacity={0.8}
                                  onPress={() => { setDetailKey(null); router.push('/(tabs)/(secondary)/profil-financier?edit=1' as any); }}
                                >
                                  <Ionicons name="alert-circle-outline" size={16} color={COLORS.orange} />
                                  <Text style={styles.varProfileBannerText}>
                                    Tu n'as pas encore indiqué tes dépenses variables — sans elles, l'estimation reste à 0 €. Complète ton profil pour un suivi fiable.
                                  </Text>
                                  <Ionicons name="chevron-forward" size={16} color={COLORS.orange} />
                                </TouchableOpacity>
                              )}
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
                    {detailKey === 'relyka' && (() => {
                      const sFut = pilotageData.month_savings_future ?? 0;
                      const iFut = pilotageData.month_invest_future ?? 0;
                      // Le point bas ENGLOBE déjà : dépenses récurrentes du mois, dépenses variables déjà
                      // dépensées, et épargne/invest déjà réalisés (sorties du solde courant). On les affiche
                      // en INFO (gris) pour que le user voie tout, puis on déduit ce qui n'y est pas encore.
                      const eiRealises = Math.max(0, (pilotageData.month_savings_total ?? 0) - sFut)
                        + Math.max(0, (pilotageData.month_invest_total ?? 0) - iFut);
                      const infos = [
                        { l: 'Dépenses récurrentes', v: suiviDetail.recurringTotal ?? 0 },
                        { l: 'Dépenses variables déjà dépensées', v: varSpentMonth },
                        { l: 'Épargne & investissement réalisés', v: eiRealises },
                      ];
                      // Chaque déduction porte sa fiche d'explication : c'est ici, dans le détail du
                      // calcul, que l'utilisateur rencontre pour la première fois « réservé »,
                      // « enveloppe variable » et « marge de sécurité ».
                      const deductions: { l: string; v: number; term?: GlossaryTerm }[] = [
                        { l: 'Épargne & investissement à venir', v: sFut + iFut },
                        { l: 'Dépenses variables restantes (estimées)', v: pilotageData.variable_envelope_remaining ?? 0, term: 'enveloppe_variable' },
                        { l: 'Somme réservée', v: (pilotageData.monthly_reserve_planned ?? 0) + reservationsTotal + cumulsTotal, term: 'reserve' },
                        { l: 'Marge de sécurité', v: pilotageData.safety_margin_amount ?? 0, term: 'marge_securite' },
                      ];
                      const pointBas = pilotageData.cashflow_trough ?? pilotageData.current_checking_balance ?? 0;
                      return (
                        <View>
                          {/* Point bas (trajectoire) + DATE + note */}
                          <View style={styles.detailRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                              <Text style={styles.detailRowLabel}>
                                Point bas de trésorerie
                                {troughDate ? <Text style={styles.detailRowSub}>{`  · ${shortDay(troughDate)}`}</Text> : null}
                              </Text>
                              <TouchableOpacity onPress={() => setShowTroughInfo(true)} hitSlop={8}>
                                <Ionicons name="information-circle-outline" size={16} color={COLORS.emerald} />
                              </TouchableOpacity>
                            </View>
                            <Text style={[styles.detailRowValue, { color: COLORS.text }]}>{fmt(pointBas)}</Text>
                          </View>
                          {/* Ce que ce point bas VEUT DIRE : jusqu'à quand le Relyka est contraint,
                              et ce qui le fera remonter. C'est la phrase qui évite le « c'est faux ». */}
                          {!!troughExplain && (
                            <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 2, lineHeight: 17 }]}>{troughExplain}</Text>
                          )}
                          {/* Déjà compris dans le point bas (info, non redéduit) */}
                          <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 2, marginBottom: 2 }]}>Déjà compris dans le point bas :</Text>
                          {infos.map((r) => (
                            <View key={r.l} style={[styles.detailRow, { paddingVertical: 3 }]}>
                              <Text style={[styles.detailRowSub, { flex: 1, paddingLeft: 12 }]} numberOfLines={1}>· {r.l}</Text>
                              <Text style={styles.detailRowSub}>{fmt(r.v)}</Text>
                            </View>
                          ))}
                          {/* Déduits du point bas pour donner le Relyka */}
                          <View style={{ height: 8 }} />
                          {deductions.map((r) => (
                            <View key={r.l} style={styles.detailRow}>
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={styles.detailRowLabel}>{r.l}</Text>
                                {!!r.term && <InfoDot term={r.term} size={14} />}
                              </View>
                              <Text style={[styles.detailRowValue, { color: COLORS.textSecondary }]}>{r.v > 0 ? '− ' + fmt(r.v) : fmt(0)}</Text>
                            </View>
                          ))}
                          {/* Marge non définie : on ne laisse pas un « − 0 € » muet. On dit ce que
                              ça implique (le Relyka est optimiste) et on offre de la définir. */}
                          {(pilotageData.safety_margin_amount ?? 0) <= 0 && (
                            <TouchableOpacity
                              style={styles.marginNudge}
                              activeOpacity={0.8}
                              onPress={() => { setDetailKey(null); setMarginInput(''); setShowMarginModal(true); }}
                            >
                              <Ionicons name="lock-closed-outline" size={14} color={COLORS.blue} />
                              <Text style={styles.marginNudgeText}>
                                Tu as une marge de sécurité à 0€. Il vaut mieux toujours garder une somme de côté sur tes comptes courants pour les imprévus.
                              </Text>
                              <Ionicons name="chevron-forward" size={15} color={COLORS.blue} />
                            </TouchableOpacity>
                          )}
                          <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, marginTop: 4 }]}>
                            <Text style={[styles.detailRowLabel, { flex: 1, fontWeight: '800' }]}>Ton Relyka</Text>
                            <Text style={[styles.detailRowValue, { color: semanticText(COLORS.emerald, COLORS), fontWeight: '800' }]}>{fmt(resteDisponible)}</Text>
                          </View>
                          {/* La carte affiche la dizaine INFÉRIEURE : sans cette ligne, le détail
                              (19 €) semblait contredire le chiffre mis en avant (10 €). */}
                          {relykaAffiche !== Math.round(resteDisponible) && (
                            <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 4 }]}>
                              {`Arrondi à ${fmt(relykaAffiche)} sur le tableau de bord (dizaine inférieure).`}
                            </Text>
                          )}
                        </View>
                      );
                    })()}
                  </ScrollView>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Détail d'une transaction depuis Épargné/Investi — feuille du bas « Fermer / Modifier »,
          comme au clic d'une transaction dans un compte. */}
      <Modal visible={!!suiviTx} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setSuiviTx(null)}>
        <Pressable style={styles.txSheetOverlay} onPress={() => setSuiviTx(null)}>
          <Pressable style={[styles.txSheet, { paddingBottom: sheetPad }]} onPress={() => {}}>
            {suiviTx && (() => {
              const t = suiviTx;
              const refCode = profile?.currency_code ?? 'EUR';
              const cur = accounts.find((a) => a.id === t.account_id)?.currency ?? refCode;
              const raw = Number(t.amount);
              const conv = convertAmount(Math.abs(raw), cur, refCode, rates) ?? Math.abs(raw);
              // Virement vers un compte d'ÉPARGNE / d'INVESTISSEMENT : ici on se place du point de vue du
              // compte de DESTINATION (l'argent y ENTRE) → montant affiché en POSITIF (épargné/investi).
              const linkedType = accounts.find((a) => a.id === t.linked_account_id)?.type;
              const isToSavInv = linkedType === 'savings' || linkedType === 'investment';
              const isIncome = isToSavInv ? true : raw > 0;
              const dateStr = new Date(t._monthDate ?? t.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
              const isCredit = !!t.is_credit_flow;
              const isMine = !t.profile_id || t.profile_id === user?.id;
              const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
              const canEdit = isMine && !!t.id && !t._perimeter_synthetic;
              const goEdit = () => {
                setSuiviTx(null);
                setDetailKey(null);
                if (isCredit) { router.push(`/(tabs)/comptes/credit/${t.credit_id}` as any); return; }
                const route = t.is_recurring
                  ? `/(tabs)/transactions/edit/${t.id}?instanceDate=${monthKey}`
                  : `/(tabs)/transactions/edit/${t.id}`;
                router.push(route as any);
              };
              const rows: [string, string][] = [
                ['Date', dateStr],
                ['Montant', `${isIncome ? '+' : '−'} ${conv.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL}`],
                ['Compte', accounts.find((a) => a.id === t.account_id)?.name ?? t.account?.name ?? ''],
              ];
              if (t.linked_account_id) rows.push(['Vers', accounts.find((a) => a.id === t.linked_account_id)?.name ?? '']);
              if (t.category?.name) rows.push(['Catégorie', t.category.name]);
              if (t._impact_pct != null && t._impact_pct < 100) rows.push(['Part appliquée', `${t._impact_pct} %`]);
              return (
                <>
                  <View style={styles.txSheetHandle} />
                  <Text style={[styles.txSheetAmount, { color: isIncome ? COLORS.green : COLORS.danger }]}>
                    {isIncome ? '+' : '−'} {conv.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                  <Text style={styles.txSheetLabel}>{t.note?.trim() || t.category?.name || 'Virement'}</Text>
                  <View style={styles.txSheetDivider} />
                  {rows.map(([k, v]) => (
                    <View key={k} style={styles.txSheetRow}>
                      <Text style={styles.txSheetKey}>{k}</Text>
                      <Text style={styles.txSheetVal} numberOfLines={2}>{v}</Text>
                    </View>
                  ))}
                  <View style={styles.txSheetBtns}>
                    <TouchableOpacity style={styles.txSheetClose} onPress={() => setSuiviTx(null)}>
                      <Text style={styles.txSheetCloseText}>Fermer</Text>
                    </TouchableOpacity>
                    {(canEdit || isCredit) && (
                      <TouchableOpacity style={styles.txSheetEdit} onPress={goEdit}>
                        <Ionicons name={isCredit ? 'card-outline' : 'create-outline'} size={16} color={COLORS.bg} />
                        <Text style={styles.txSheetEditText}>{isCredit ? 'Voir le crédit' : 'Modifier'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
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
            {/* Schéma avec TES chiffres : solde d'aujourd'hui → point bas (daté) → remontée après
                ta prochaine rentrée d'argent. Trois points réellement calculés, aucun décor. */}
            <TroughChart
              today={{ label: 'Aujourd’hui', amount: pilotageData.current_checking_balance ?? 0 }}
              trough={{
                label: troughDate ? shortDay(troughDate) : 'Point bas',
                amount: pilotageData.cashflow_trough ?? 0,
              }}
              recovery={nextIncomeDate && nextIncomeAmount > 0 ? {
                label: shortDay(nextIncomeDate),
                amount: (pilotageData.cashflow_trough ?? 0) + nextIncomeAmount,
              } : undefined}
              margin={pilotageData.safety_margin_amount ?? 0}
            />
            <Text style={styles.troughInfoText}>
              C'est le solde le plus bas qu'atteindront tes comptes courants d'ici ta prochaine rentrée d'argent, en simulant tes revenus et tes dépenses à venir jour après jour.
              {troughDate ? ` D'après tes opérations, ce sera le ${shortDay(troughDate)}.` : ''}{'\n\n'}
              C'est une info à une DATE, pas un jugement sur ton mois : si tu es payé le 25, ton point bas du 24 est normalement bas — et ton Relyka avec lui. Il ne dit qu'une chose : voilà ce que tu peux dépenser d'ici là.
              {nextIncomeDate && nextIncomeAmount > 0 ? ` Ta rentrée d'argent du ${shortDay(nextIncomeDate)} (+${eur(nextIncomeAmount)}) le fera remonter.` : ''}{'\n\n'}
              On se base dessus plutôt que sur ton solde actuel pour ne jamais te laisser dépenser de l'argent que tu n'as pas encore reçu.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Nouveau Relyka après changement de référence des variables — la conséquence du choix,
          annoncée franchement plutôt que noyée derrière la modale de détail. */}
      <Modal visible={!!relykaShift} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setRelykaShift(null)}>
        <Pressable style={styles.detailOverlay} onPress={() => setRelykaShift(null)}>
          <Pressable style={[styles.detailBox, { gap: 10 }]} onPress={() => {}}>
            <Text style={styles.detailTitle}>Ton Relyka a été recalculé</Text>
            <View style={styles.relykaShiftRow}>
              <Text style={styles.relykaShiftOld}>{`${Math.round(relykaShift?.before ?? 0).toLocaleString("fr-FR")} ${CURRENCY_SYMBOL}`}</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.textSecondary} />
              <Text style={styles.relykaShiftNew}>{`${Math.round(relykaShift?.after ?? 0).toLocaleString("fr-FR")} ${CURRENCY_SYMBOL}`}</Text>
            </View>
            <Text style={[styles.detailNote, { textAlign: 'center', marginTop: 8 }]}>
              {(relykaShift && relykaShift.after === relykaShift.before)
                ? 'Même montant : cette référence donnait déjà le même budget variable.'
                : (relykaShift && relykaShift.after > relykaShift.before)
                  ? 'Ta nouvelle référence prévoit moins de dépenses variables : il te reste donc plus à décider ce mois-ci.'
                  : 'Ta nouvelle référence prévoit plus de dépenses variables : Relyka met davantage de côté pour elles.'}
            </Text>
            <TouchableOpacity style={styles.varModeSave} onPress={() => setRelykaShift(null)} activeOpacity={0.85}>
              <Text style={styles.varModeSaveText}>Compris</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modale : estimation hebdo des dépenses variables (alimente q9) */}
      <Modal
        visible={showVariableModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!requireVariable) setShowVariableModal(false); }}
      >
        {/* Étape du guide : ni fermeture au tap à côté, ni « Annuler », et un montant > 0 exigé —
            à 0 €, l'app présenterait comme disponible de l'argent déjà mangé par le quotidien. */}
        <Pressable style={styles.varModalOverlay} onPress={() => { if (!requireVariable) setShowVariableModal(false); }}>
          <Pressable style={styles.varModalBox} onPress={() => {}}>
            <Text style={styles.varModalTitle}>Dépenses variables</Text>
            <Text style={styles.varModalHint}>
              Combien dépenses-tu environ pour tes courses, loisirs et dépenses variables ?
              {requireVariable
                ? '\n\nUne estimation suffit : Relyka l\'ajustera à ton réel au fil des mois. \n\nCette somme sera déduite de ton Relyka en anticipation.'
                : ''}
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
              {!requireVariable && (
                <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowVariableModal(false)}>
                  <Text style={styles.varModalCancelText}>Annuler</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.varModalSave,
                  requireVariable && (parseFloat(weeklyVariableInput.replace(',', '.')) || 0) <= 0 && { opacity: 0.45 },
                ]}
                disabled={requireVariable && (parseFloat(weeklyVariableInput.replace(',', '.')) || 0) <= 0}
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
                  if (requireVariable && weekly > 0) userGuide.done('g2_variable');
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modale : marge de sécurité (identique à Paramètres → profiles.safety_margin_amount) */}
      <Modal
        visible={showMarginModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!requireMargin) setShowMarginModal(false); }}
      >
        {/* Étape du guide : 0 € est une réponse valable, mais il faut l'ENREGISTRER — refermer sans
            rien décider laisserait l'app calculer avec une marge qu'on n'a jamais choisie. */}
        <Pressable style={styles.varModalOverlay} onPress={() => { if (!requireMargin) setShowMarginModal(false); }}>
          <Pressable style={styles.varModalBox} onPress={() => {}}>
            <Text style={styles.varModalTitle}>Ta marge de sécurité</Text>
            {/* Formulation essentielle : c'est l'UTILISATEUR qui décide d'avoir ce montant sur son
                compte — l'app ne met rien de côté à sa place. Elle s'en sert seulement pour ne
                jamais lui proposer d'y toucher. L'ancien texte (« montant conservé… déduit de ton
                budget libre ») laissait croire à une action automatique d'épargne. */}
            <Text style={styles.varModalHint}>
              Le montant que tu veux avoir au minimum sur tes comptes courants à la fin du mois.
              Relyka ne le déplace nulle part : il te dit simplement ce que tu peux utiliser avant
              d’entamer cette somme.
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
              {!requireMargin && (
                <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowMarginModal(false)}>
                  <Text style={styles.varModalCancelText}>Annuler</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.varModalSave}
                onPress={() => {
                  const val = Math.max(0, parseFloat(marginInput.replace(',', '.')) || 0);
                  /* La modale se ferme TOUT DE SUITE : la mise à jour du profil est optimiste
                     (useUpdateProfile.onMutate écrit la nouvelle marge dans le cache avant le
                     réseau) et son succès invalide déjà `pilotage_data`. On attendait ici, en plus,
                     un rechargement COMPLET du tableau de bord dont on ne lisait même pas le
                     résultat : l'utilisateur restait bloqué sur « Enregistrer » le temps du fetch le
                     plus lourd de l'app, après trois écritures en série. */
                  updateProfileVar.mutate({ safety_margin_amount: val });
                  setShowMarginModal(false);
                  if (requireMargin) userGuide.done('g2_margin');
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Conserver manuellement un montant ce mois (déduit du Relyka, reste sur le compte courant). */}
      <Modal visible={showConserveModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowConserveModal(false)}>
        <Pressable style={styles.varModalOverlay} onPress={() => setShowConserveModal(false)}>
          <Pressable style={styles.varModalBox} onPress={() => {}}>
            <Text style={styles.varModalTitle}>Conserver ce mois</Text>
            <Text style={styles.varModalHint}>
              Montant à garder en réserve sur ton compte courant ce mois-ci. Il est déduit de ton
              « Budget libre » (Relyka) mais reste sur ton compte. Se réinitialise chaque mois.
              {'\n'}C'est le TOTAL réservé : baisse-le pour en libérer une partie, mets 0 pour tout libérer.
            </Text>
            <View style={styles.varModalInputRow}>
              <TextInput
                style={styles.varModalInput}
                value={conserveInput}
                onChangeText={(v) => setConserveInput(v.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
              />
              <Text style={styles.varModalUnit} numberOfLines={1}>{CURRENCY_SYMBOL}</Text>
            </View>
            <View style={styles.varModalActions}>
              <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowConserveModal(false)}>
                <Text style={styles.varModalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.varModalSave}
                onPress={() => {
                  const val = Math.max(0, Math.round(parseFloat(conserveInput.replace(',', '.')) || 0));
                  setMonthlyReservation.mutate({ montant: val, libelle: `Réservé ${monthYearLabel()}` });
                  setShowConserveModal(false);
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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





  // ── Modaux détail (centrés) ──
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
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
  detailBox: { width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
  // Web bureau : une boîte de 460 px perdue au milieu d'un écran de 1500 flotte et oblige à faire
  // défiler pour deux lignes de liste. On l'élargit et on met le camembert et sa légende côte à côte.
  detailBoxDesktop: { maxWidth: 820, padding: 24, borderRadius: 18 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailTitle: { fontSize: 17, fontWeight: '800', color: c.text, flex: 1 },
  detailTitleDesktop: { fontSize: 20 },

  // ── Bloc « aperçu » d'un modal de détail : camembert + légende + filtres ──
  // Mobile : empilés (inchangé). Bureau : deux colonnes, l'anneau à gauche, tout le reste à droite.
  chartBlockDesktop: { flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 4 },
  chartLegendDesktop: { flex: 1, minWidth: 0 },

  /**
   * Barre des filtres TRANSVERSES (« Récurrentes », « À venir »). Ils ne sont pas des catégories :
   * mélangés aux pastilles de la légende, ils passaient pour une part du camembert de plus. On les
   * sort donc sur leur propre ligne, séparés par un filet, et avec une forme différente
   * (rectangle arrondi vs pastille ronde) pour qu'on lise « filtre » et non « catégorie ».
   */
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.cardBorder,
  },
  filterBarLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase',
    color: c.textSecondary, opacity: 0.7, marginRight: 2,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
    paddingVertical: 6, paddingHorizontal: 10,
  },
  filterChipText: { fontSize: 12, color: c.text, fontWeight: '700' },
  filterChipVal: { fontSize: 12, fontWeight: '800' },

  // ── Décomposition de l'enveloppe variable (modal « Ce qui va encore sortir ») ──
  // Une jauge + trois lignes : d'où vient le chiffre, ce qui a déjà été consommé, ce qui reste.
  envBlock: {
    gap: 5, marginTop: 8, marginBottom: 2,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  envBarTrack: { height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden', marginBottom: 4 },
  envBarFill: { height: '100%', borderRadius: 3 },
  envRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  envLabel: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600', flexShrink: 1 },
  envVal: { fontSize: 13, fontWeight: '800' },
  // Version compacte : enveloppe / dépensé / reste sur UNE ligne (au lieu de trois).
  envInline: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  envInlineItem: { flex: 1, gap: 1 },
  envInlineLabel: { fontSize: 10.5, color: c.textSecondary, fontWeight: '600' },
  envInlineVal: { fontSize: 13.5, fontWeight: '800' },
  // Sélecteur de référence (Auto / Estimation / Réel)
  varModeRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  varModeChip: {
    flex: 1, alignItems: 'center', gap: 1, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
  },
  varModeChipOn: { borderColor: c.emerald, backgroundColor: c.emerald + '18' },
  varModeLabel: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary },
  varModeValue: { fontSize: 12, fontWeight: '800', color: c.text },
  varModeLabelOn: { color: c.emerald },
  varModeActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  varModeSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14,
  },
  varModeSaveText: { fontSize: 13, fontWeight: '800', color: c.bg },
  relykaShiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 },
  relykaShiftOld: { fontSize: 15, color: c.textSecondary, textDecorationLine: 'line-through' },
  relykaShiftNew: { fontSize: 26, fontWeight: '800', color: c.emerald },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
  detailRowLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
  detailRowSub: { fontSize: 11, color: c.textSecondary, marginTop: 1 },

  // Invitation à définir la marge, affichée dans le détail du Relyka quand elle vaut 0 €.
  marginNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.blue + '12', borderWidth: 1, borderColor: c.blue + '33',
    borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, marginTop: 6,
  },
  marginNudgeText: { flex: 1, fontSize: 12, color: c.blue, lineHeight: 17.5 },
  detailRowValue: { fontSize: 15, fontWeight: '700' },
  detailEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 20 },
  troughInfoText: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  pieLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pieLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, maxWidth: '100%' },
  pieDot: { width: 9, height: 9, borderRadius: 5 },
  pieLegendText: { fontSize: 12, color: c.text, fontWeight: '600', flexShrink: 1 },
  pieLegendVal: { fontSize: 12, fontWeight: '800' },
  detailNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 4 },
  detailEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12' },
  detailEditBtnText: { fontSize: 13, fontWeight: '700', color: c.emerald },
  varProfileBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.orange + '55', backgroundColor: c.orange + '14', marginVertical: 4 },
  varProfileBannerText: { flex: 1, fontSize: 12, color: c.text, lineHeight: 16, fontWeight: '600' },


  suiviDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 6 },
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
