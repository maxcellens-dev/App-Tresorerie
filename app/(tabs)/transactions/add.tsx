import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { chipStyles } from '../../../lib/ui/controls';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, BackHandler, Keyboard } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../../components/transaction/CalendarWithPicker';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts } from '../../../hooks/data/useAccounts';
import { useCategories, useAddCategory } from '../../../hooks/data/useCategories';
import { createTransferLegs, useAddTransaction, useDeleteTransaction, useAllTransactions , useAskRegulCoverage } from '../../../hooks/data/useTransactions';
import { parseUsageLimitError } from '../../../lib/finance/usageLimits';
import { appAlert } from '../../../lib/ui/appDialog';
import { useMonthlyClosure } from '../../../hooks/pilotage/useMonthlyClosure';
import CategoryPicker, { useSubCategoriesGrouped } from '../../../components/transaction/CategoryPicker';
import type { RecurrenceRule } from '../../../types/database';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import AppButton from '../../../components/ui/AppButton';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import { useGuide } from '../../../contexts/GuideContext';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../../lib/dateUtils';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useInvertedColors } from '../../../hooks/theme/useInvertedColors';
import { currencySymbolFor, convertAmount } from '../../../lib/finance/currency';
import { useCurrencyRates } from '../../../hooks/data/useCurrencyRates';
import { useKeyboardAwareScroll } from '../../../hooks/platform/useKeyboardAwareScroll';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { useReadOnlyGuard } from '../../../hooks/platform/useReadOnlyGuard';
import { notePlaceholder } from '../../../lib/finance/txPlaceholders';
import { useProjects } from '../../../hooks/data/useProjects';
import { useProjectAttach } from '../../../hooks/data/useProjectAttach';
import { matchProjectsForTransaction } from '../../../lib/finance/projectMatch';
import { sanitizeAmountInput, parseAmountInput } from '../../../lib/ui/amountInput';
import BudgetInlineBlock from '../../../components/budget/BudgetInlineBlock';
import AccountChipRow from '../../../components/transaction/AccountChipRow';
import { computeContributed } from '../../../lib/finance/contributed';
import { useResetPreSaving } from '../../../hooks/data/usePreSavings';
import { useReleaseReservedByProject } from '../../../hooks/data/useTransactions';
import { safeInternalRoute } from '../../../lib/ui/navHistory';
import type { PreSavingType } from '../../../types/database';


type TransactionType = 'expense' | 'income' | 'transfer';

function AddTransactionScreen() {
  const COLORS = useAppColors();
  // Couleurs inversées : uniquement pour la consigne du guide (« coche Récurrent »), qui doit
  // trancher sur le formulaire comme les autres messages de démarrage.
  const INV = useInvertedColors();
  const styles = useMemo(
    () => makeStyles({ ...COLORS, guideBg: INV.cardSolid, guideBorder: INV.emerald + '55', guideText: INV.text }),
    [COLORS, INV],
  );
  // Web bureau : un formulaire de saisie se tient dans une colonne étroite — sinon champs et
  // bouton « Enregistrer » s'étirent sur toute la largeur de l'écran, ce qui ne se fait nulle part.
  const { isDesktop } = useResponsive();
  const router = useRouter();
  /**
   * PARAMÈTRES D'OUVERTURE — cet écran est le SEUL point de saisie d'une dépense, d'une recette et
   * d'un virement. Il a donc absorbé tout ce que l'ancien second écran de virement
   * (app/(tabs)/comptes/transfer.tsx, supprimé) savait recevoir du Pilotage et d'une fiche compte.
   *  • type                  expense | income | transfer
   *  • account               compte source pré-sélectionné (fiche d'un compte, bouton « + »)
   *  • to / destType         destination imposée, par compte OU par type de compte (reco épargne / invest)
   *  • amount / label / date valeurs pré-remplies
   *  • resetPreSaving        virement d'un cumul → remettre ce cumul à 0 une fois le virement passé
   *  • releaseProject        virement d'un montant réservé → libérer les brouillons de réservation
   *  • origin                écran de retour (saisie ouverte depuis un autre onglet)
   */
  const params = useLocalSearchParams<{
    type?: string; account?: string; to?: string; destType?: string;
    amount?: string; label?: string; date?: string;
    resetPreSaving?: string; releaseProject?: string;
    on_behalf?: string; on_behalf_name?: string; origin?: string; recurring?: string;
  }>();
  const { user } = useAuth();
  // Comptes où je peux ÉCRIRE (perso + joints + partagés écriture) — pas les comptes en consultation.
  const { data: allAccounts = [] } = useAllAccounts(user?.id);
  const accounts = useMemo(() => allAccounts.filter((a) => a._role !== 'read'), [allAccounts]);
  const { data: categories = [] } = useCategories(user?.id);
  const { data: transactions = [] } = useAllTransactions(user?.id);
  // Verrou de clôture gaté par le flag de fonctionnalité (null si Clôture désactivée).
  const { lockDate: closureLockDate } = useMonthlyClosure(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  // Question « déjà comptée dans ce solde ? » : posée AVANT de rendre la main (cf. plus bas).
  const askRegulCoverage = useAskRegulCoverage(user?.id);
  const deleteTransaction = useDeleteTransaction(user?.id);
  // Rattachement à un projet EN COURS quand la saisie correspond à sa configuration (comptes d'un
  // virement / compte + catégorie d'une dépense) : le projet se tient à jour sans repasser par
  // l'écran Projets.
  const { data: projects = [] } = useProjects(user?.id);
  const attachToProject = useProjectAttach(user?.id);
  /* Suites d'un virement venu du Pilotage : le cumul « mis de côté » retombe à zéro une fois viré,
     et un montant réservé pour un projet libère ses brouillons de réservation. Sans elles, l'argent
     restait compté deux fois — une fois réservé, une fois viré. */
  const resetPreSaving = useResetPreSaving(user?.id);
  const releaseReserved = useReleaseReservedByProject(user?.id);

  // Déterminer le type initial depuis les params ou par défaut 'expense'
  const getInitialType = (): TransactionType => {
    if (params.type === 'income') return 'income';
    if (params.type === 'transfer') return 'transfer';
    return 'expense';
  };

  const [amount, setAmount] = useState('');
  // Virement cross-devises : montant réellement crédité sur la destination (devise dest).
  const [amountTo, setAmountTo] = useState('');
  const amountToTouched = useRef(false);
  const [date, setDate] = useState(todayISO());
  const [dateDisplay, setDateDisplay] = useState(formatDateFrench(todayISO()));
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState(''); // Pour les virements
  const [categoryId, setCategoryId] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>(getInitialType());
  // Remboursement : une dépense « à l'envers » (entrée d'argent) imputée sur une catégorie de dépense.
  const [isRefund, setIsRefund] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState(''); // vide = sans fin
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end'>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  // Saisie en 2 étapes (style banque) : étape 1 = qui/quoi, étape 2 = quand/récurrence.
  const [step, setStep] = useState<1 | 2>(1);
  const { scrollRef, handleFocus, onScroll, keyboardPadding } = useKeyboardAwareScroll();
  /* Verrou SYNCHRONE. La mutation ne démarre qu'APRÈS `askRegulCoverage` (qui peut poser une
     question à l'écran, donc attendre plusieurs secondes) : pendant tout ce temps
     `addTransaction.isPending` est faux, le bouton reste actif, et deux appuis enregistraient DEUX
     transactions — le double d'une dépense, sans que rien ne le signale. */
  const submitLock = useSubmitLock();
  /* Consultation admin : cette transaction serait écrite sur le compte visité (la politique d'accès
     l'autorise pour un administrateur). On regarde, on n'écrit pas. */
  const roGuard = useReadOnlyGuard();
  // Projet sélectionné pour rattacher la saisie (null = pas de rattachement).
  const [attachProjectId, setAttachProjectId] = useState<string | null>(null);

  /* ── Guide : première récurrence ───────────────────────────────────────────────────────────────
     On arrive ici depuis le guide (`?recurring=1`), à l'étape « enregistre une récurrente ». La case
     n'est VOLONTAIREMENT pas pré-cochée : le geste à apprendre, c'est de la cocher soi-même — c'est
     lui qu'il faudra refaire pour chaque charge. On refuse donc l'enregistrement tant qu'elle ne
     l'est pas (le message d'erreur le dit ; il n'y a plus d'encadrement, cf. GuideModal). */
  const guide = useGuide();
  const guideNeedsRecurring = params.recurring === '1' && guide.is('tx_recurring') && !isRecurring;

  /* ── RESYNCHRONISATION SUR LES PARAMÈTRES ──────────────────────────────────────────────────────
     Le bouton « + », une fiche de compte ou une reco du Pilotage rouvrent cet écran DÉJÀ MONTÉ :
     expo-router ne le remonte pas, donc les valeurs initiales des `useState` ne se réappliquent
     jamais. Sans cette resynchronisation, un virement laissé à l'étape 2 rouvrait à l'étape 2 sur
     les comptes de la fois précédente — en sautant le choix des comptes.
     On rejoue donc TOUTE la préparation quand la signature des paramètres change, et seulement
     alors : tant qu'elle ne bouge pas, une sélection faite à la main n'est jamais écrasée. */
  const lastParamsSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = [
      params.type, params.account, params.to, params.destType,
      params.amount, params.label, params.date, params.resetPreSaving, params.releaseProject,
    ].join('|');
    if (sig === lastParamsSig.current) return;
    lastParamsSig.current = sig;

    const t = params.type;
    if (t === 'income' || t === 'transfer' || t === 'expense') setTransactionType(t as TransactionType);
    if (params.account) setAccountId(String(params.account));
    if (params.to) setTargetAccountId(String(params.to));
    if (params.amount != null) setAmount(sanitizeAmountInput(String(params.amount)));
    if (params.label != null) setNote(String(params.label));
    if (params.date) { setDate(String(params.date)); setDateDisplay(formatDateFrench(String(params.date))); }
    /* Les deux comptes sont déjà connus (virement pré-rempli depuis le Pilotage) : l'étape 1 n'a
       plus rien à demander, on ouvre directement sur le montant et la date. */
    setStep(params.account && params.to ? 2 : 1);
    setFormError(null);
    setErrorFields([]);
  }, [
    params.type, params.account, params.to, params.destType,
    params.amount, params.label, params.date, params.resetPreSaving, params.releaseProject,
  ]);

  const isExpense = transactionType === 'expense';
  const isIncome = transactionType === 'income';
  const isTransfer = transactionType === 'transfer';

  /**
   * Compte à pré-sélectionner, par ordre de priorité :
   *  1. celui d'où l'on vient (param `account`, saisie ouverte depuis un compte) ;
   *  2. le compte courant PAR DÉFAUT choisi par l'utilisateur (migration 146) ;
   *  3. le 1er compte courant PERSO (propriétaire, non joint) — jamais le compte joint ni un
   *     compte partagé reçu ; repli : autre compte courant, sinon 1er compte.
   *
   * Extrait en fonction (au lieu de vivre uniquement dans un effet) parce que la remise à zéro du
   * formulaire doit pouvoir le RECALCULER : après un enregistrement, l'écran n'est pas remonté et
   * les effets ne se rejouent pas — leurs dépendances n'ont pas bougé.
   */
  const initialAccountId = useCallback((): string => {
    if (!accounts.length) return '';
    if (params.account && accounts.some(a => a.id === params.account)) return String(params.account);
    const preferred = accounts.find((a) => a.is_default);
    if (preferred) return preferred.id;
    const persoChecking = accounts.filter(a => a.type === 'checking' && a._role === 'owner' && !a.is_joint);
    if (persoChecking.length) return persoChecking[0].id;
    const checkingAccounts = accounts.filter(a => a.type === 'checking');
    return checkingAccounts.length ? checkingAccounts[0].id : accounts[0].id;
  }, [accounts, params.account]);

  // Remet le formulaire à son état initial (appelé après un enregistrement réussi). On garde le TYPE
  // courant (l'utilisateur enchaîne souvent le même type), mais on repart à l'étape 1, champs vides.
  const resetForm = useCallback(() => {
    // Le compte REPART sur le défaut : l'écran n'étant pas remonté entre deux saisies, il gardait
    // sinon le compte de la saisie précédente — surprise garantie à la suivante.
    setAccountId(initialAccountId());
    setAmount('');
    setAmountTo('');
    amountToTouched.current = false;
    setDate(todayISO());
    setDateDisplay(formatDateFrench(todayISO()));
    setNote('');
    setCategoryId('');
    setTargetAccountId('');
    setIsRefund(false);
    setIsRecurring(false);
    setRecurrenceRule('monthly');
    setRecurrenceEndDateInput('');
    setShowCalendar(false);
    setFormError(null);
    setErrorFields([]);
    setAttachProjectId(null);
    setStep(1);
  }, [initialAccountId]);

  // Changer de type → revenir à l'étape 1.
  const changeType = (t: TransactionType) => { setTransactionType(t); setStep(1); setFormError(null); setErrorFields([]); };

  // ── Projets correspondant à la saisie (rattachement proposé à l'étape 2) ──
  // Avancement (%) par projet calculé LOCALEMENT depuis le cache transactions (déjà chargé ici) :
  // même formule que le pilotage (Σ |débits| validés passés ÷ cible), sans embarquer le lourd
  // usePilotageData sur cet écran de saisie (il déclenchait son fetch complet au montage).
  const progressPctById = useMemo(() => {
    const today = todayISO();
    const contributed: Record<string, number> = {};
    for (const t of transactions as any[]) {
      if (!t.project_id || t.is_draft || t.date > today || Number(t.amount) >= 0) continue;
      contributed[t.project_id] = (contributed[t.project_id] ?? 0) + Math.abs(Number(t.amount));
    }
    const m: Record<string, number> = {};
    for (const p of projects) {
      const target = Number(p.target_amount) || 0;
      m[p.id] = target > 0 ? Math.min(100, ((contributed[p.id] ?? 0) / target) * 100) : 0;
    }
    return m;
  }, [transactions, projects]);
  // Une récurrente ne se rattache pas (chaque occurrence devrait l'être individuellement) ; un
  // remboursement non plus (entrée d'argent). Virement → projets « Mettre de côté » aux mêmes
  // comptes ; dépense → projets « Dépenser petit à petit » au même compte + même catégorie.
  const matchingProjects = useMemo(() => {
    if (isRecurring) return [];
    if (isTransfer && accountId && targetAccountId) {
      return matchProjectsForTransaction({ kind: 'transfer', accountId, targetAccountId, projects, progressPctById });
    }
    if (isExpense && !isRefund && accountId && categoryId) {
      return matchProjectsForTransaction({ kind: 'expense', accountId, categoryId, projects, progressPctById });
    }
    return [];
  }, [isTransfer, isExpense, isRefund, isRecurring, accountId, targetAccountId, categoryId, projects, progressPctById]);
  // Sélection nettoyée si elle ne correspond plus (changement de compte/catégorie/type).
  useEffect(() => {
    if (attachProjectId && !matchingProjects.some((p) => p.id === attachProjectId)) setAttachProjectId(null);
  }, [matchingProjects, attachProjectId]);

  // Virement cross-devises : devise source ≠ devise destination → 2ᵉ champ « montant reçu ».
  const srcCurrency = accounts.find((a) => a.id === accountId)?.currency || 'EUR';
  const dstCurrency = accounts.find((a) => a.id === targetAccountId)?.currency || 'EUR';
  const isCross = isTransfer && !!accountId && !!targetAccountId && srcCurrency !== dstCurrency;

  // Taux pour pré-remplir le montant reçu (modifiable ensuite par l'utilisateur).
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  useEffect(() => {
    if (!isCross) return;
    if (amountToTouched.current) return;        // l'utilisateur a saisi son vrai montant reçu
    const n = parseFloat((amount || '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { setAmountTo(''); return; }
    const conv = convertAmount(n, srcCurrency, dstCurrency, rates);
    setAmountTo(conv != null ? conv.toFixed(2) : '');
  }, [amount, isCross, srcCurrency, dstCurrency, rates]);

  // Bouton retour (header) + retour physique Android : depuis l'étape 2, revenir à l'étape 1
  // plutôt que de quitter l'écran.
  const handleBack = useCallback(() => {
    if (step === 2) { setStep(1); setFormError(null); setErrorFields([]); return; }
    // Saisie ouverte via la saisie rapide (FAB), une fiche de compte ou une reco du Pilotage →
    // revenir à l'écran d'ORIGINE et non à la pile Transactions (navigation inter-onglets).
    // Chemin interne uniquement (cf. safeInternalRoute) : le paramètre vient de l'URL.
    const back = safeInternalRoute(params.origin ? decodeURIComponent(String(params.origin)) : null);
    if (back) { router.replace(back as any); return; }
    router.back();
  }, [step, router, params.origin]);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const onBack = () => {
        if (step === 2) { setStep(1); setFormError(null); setErrorFields([]); return true; }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [step]),
  );

  // Validation de l'étape 1 avant de passer à l'étape 2.
  function goNext() {
    setFormError(null); setErrorFields([]);
    if (isTransfer) {
      if (!accountId) return showError('Choisis un compte source.', ['account']);
      if (!targetAccountId) return showError('Choisis un compte de destination.', ['targetAccount']);
      if (accountId === targetAccountId) return showError('Le compte source et le compte de destination doivent être différents.', ['targetAccount']);
      // Cross-devises géré sur place (étape 2 : champ « montant reçu » pré-rempli au taux du jour).
    } else {
      const num = parseFloat(amount.replace(',', '.'));
      if (Number.isNaN(num) || num === 0) return showError('Le montant est obligatoire et doit être supérieur à 0.', ['amount']);
      if (!accountId) return showError('Choisis un compte.', ['account']);
    }
    setStep(2);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  // Dépense / Recette → comptes courants uniquement. Virement → tous les comptes.
  const selectableAccounts = isTransfer ? accounts : accounts.filter(a => a.type === 'checking');

  /* DESTINATION D'UN VIREMENT — restreinte au TYPE demandé par l'appelant quand il y en a un : une
     reco « mets de côté » ne vise que les comptes d'épargne, une reco « investis » que les comptes
     d'investissement. Sans ce filtre, la reco renvoyait vers la liste complète et rien n'empêchait
     de virer l'épargne… vers le compte courant qu'on venait de quitter. */
  const destAccounts = useMemo(
    () => (params.destType ? accounts.filter((a) => a.type === params.destType) : accounts),
    [accounts, params.destType],
  );
  /* Une destination pré-sélectionnée qui ne survit pas au filtre resterait choisie tout en étant
     ABSENTE de la liste : compte sélectionné mais invisible, et validation sur un choix fantôme. */
  useEffect(() => {
    if (!accounts.length || !targetAccountId) return;
    if (!destAccounts.some((a) => a.id === targetAccountId)) setTargetAccountId('');
  }, [accounts.length, destAccounts, targetAccountId]);

  /* ── RETRAIT D'UN COMPTE D'INVESTISSEMENT : LA RÈGLE DU PRORATA ────────────────────────────────
     Sortir 1 000 € d'un compte d'investissement, ce n'est pas sortir 1 000 € de capital : c'est en
     sortir la part de capital et la part de plus-value dans la proportion où elles composent le
     compte. On le DIT avant de valider, parce que c'est ce qui décide de l'apport restant — donc de
     la performance affichée ensuite. */
  const withdrawalProrata = useMemo(() => {
    if (!isTransfer || isRecurring) return null;
    const src = accounts.find((a) => a.id === accountId);
    if (!src || src.type !== 'investment' || Number(src.balance) <= 0) return null;
    const contributed = computeContributed(src, transactions as any);
    if (contributed == null) return null;
    const n = parseFloat((amount || '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    const ratio = Math.min(1, contributed / Number(src.balance));
    const capital = n * ratio;
    return {
      currency: src.currency,
      capitalPct: Math.round(ratio * 100),
      capital,
      plus: n - capital,
      remainingContributed: Math.max(0, contributed - capital),
      remainingBalance: Number(src.balance) - n,
    };
  }, [isTransfer, isRecurring, accounts, accountId, transactions, amount]);

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  // Création rapide de sous-catégorie (§12) : parents disponibles (hors « Mouvements ») + mutation.
  const addCategory = useAddCategory(user?.id);
  const subcatParents = useMemo(() => {
    const t = isExpense ? 'expense' : 'income';
    return categories
      .filter((c) => (c.parent_id == null || c.parent_id === '') && String(c.type).toLowerCase() === t)
      .filter((c) => c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() !== 'mouvements')
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, isExpense]);
  useEffect(() => setCategoryId(''), [isExpense, isIncome]);
  useEffect(() => { if (!isExpense) setIsRefund(false); }, [isExpense]);

  // Dépense / Recette → forcer un compte courant si le compte sélectionné ne l'est pas
  useEffect(() => {
    if (isTransfer || !accountId) return;
    const acc = accounts.find(a => a.id === accountId);
    if (acc && acc.type !== 'checking') {
      const firstChecking = accounts.find(a => a.type === 'checking');
      setAccountId(firstChecking ? firstChecking.id : '');
    }
  }, [transactionType, accounts, accountId, isTransfer]);

  // (La pré-sélection du compte source depuis `?account=` est faite par la resynchronisation des
  //  paramètres, plus haut : elle valait pour le virement comme pour la dépense/recette.)

  // Sélection initiale, à l'arrivée sur l'écran (tant que rien n'est choisi).
  useEffect(() => {
    if (accountId || !accounts.length) return;
    setAccountId(initialAccountId());
  }, [accounts, accountId, initialAccountId]);

  function showError(msg: string, fields: string[] = []) {
    setFormError(msg);
    setErrorFields(fields);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function handleSubmit(isDraft = false) {
    setFormError(null);
    setErrorFields([]);

    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      showError('Le montant est obligatoire et doit être supérieur à 0.', ['amount']);
      return;
    }
    if (!accountId) {
      showError('Choisis un compte source.', ['account']);
      return;
    }

    // Verrou de clôture : pas de saisie à une date déjà clôturée.
    if (closureLockDate && date <= closureLockDate) {
      showError(`Ce mois est clôturé : impossible de saisir une transaction au ${formatDateFrench(date)} ou avant.`, ['date']);
      return;
    }

    // Sous-catégorie obligatoire pour une dépense / recette validée (les brouillons restent libres).
    if (!isTransfer && !isDraft && !categoryId) {
      showError('Choisis une sous-catégorie.', ['category']);
      return;
    }

    let numTo = num;
    if (isTransfer) {
      if (!targetAccountId) {
        showError('Choisis un compte de destination.', ['targetAccount']);
        return;
      }
      if (accountId === targetAccountId) {
        showError('Le compte source et le compte de destination doivent être différents.', ['targetAccount']);
        return;
      }
      // Cross-devises : jambes asymétriques (−num sur la source / +numTo sur la destination).
      if (isCross) {
        if (isRecurring) {
          showError('Un virement récurrent doit relier deux comptes de la même devise (les taux de change varient dans le temps).');
          return;
        }
        numTo = parseFloat(amountTo.replace(',', '.'));
        if (Number.isNaN(numTo) || numTo <= 0) {
          showError(`Saisis le montant réellement crédité sur « ${accounts.find(a => a.id === targetAccountId)?.name ?? 'la destination'} » (en ${dstCurrency}).`, ['amountTo']);
          return;
        }
      }
    }

    // Virement → débit (négatif). Dépense → négatif, sauf remboursement (entrée d'argent) → positif.
    // Recette → positif.
    const finalAmount = isTransfer
      ? -Math.abs(num)
      : isExpense
        ? (isRefund ? Math.abs(num) : -Math.abs(num))
        : Math.abs(num);
    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;

    // Limite d'usage : PAS de pré-comptage bloquant (1 aller-retour réseau économisé sur CHAQUE
    // enregistrement). Le trigger serveur (migration 135) est la vraie barrière, et le backstop
    // global (_layout) affiche le même dialog convivial si l'insert est rejeté (USAGE_LIMIT_*).

    // ── Rattachement à un projet (sélectionné à l'étape 2). Jamais pour une récurrente, ni pour
    // un remboursement, ni pour un brouillon de DÉPENSE (une dépense de projet est validée
    // d'emblée — c'est le modèle du mode « Dépenser petit à petit »).
    const today = todayISO();
    const attachedProject = (!isRecurring && attachProjectId
      && !(isExpense && (isRefund || isDraft)))
      ? matchingProjects.find((p) => p.id === attachProjectId) ?? null
      : null;
    const accumulatedBefore = attachedProject
      ? ((progressPctById[attachedProject.id] ?? 0) / 100) * Number(attachedProject.target_amount)
      : 0;
    const insertedIds: string[] = [];
    // Un virement futur (ou saisi en brouillon) rattaché devient une ÉCHÉANCE DE PROJET à valider :
    // une seule jambe en brouillon, la jambe de crédit sera créée à la validation (même modèle que
    // l'échéancier du projet — useValidateProjectDraft).
    const asProjectDraft = !!attachedProject && isTransfer && (isDraft || date > today);

    /* Régularisation le MÊME JOUR : la question se pose ICI, avant de rendre la main.
       Elle porte sur l'opération en cours et attend une décision — posée dans la mutation (qui
       tourne en arrière-plan), elle surgissait une fois l'utilisateur DÉJÀ revenu sur la liste,
       par-dessus un autre écran, voire par-dessus un modal du guide. */
    if (roGuard.blocked()) return;
    /* Verrou posé AVANT le premier `await` : c'est la seule position qui ferme réellement la
       fenêtre de double saisie. On ne le relâche PAS en cas de succès — l'écran est quitté juste
       après (navigation optimiste), et le relâcher rouvrirait la porte pendant la sortie. */
    if (!submitLock.acquire()) return;

    const regulCoveredAnswer = await askRegulCoverage(accountId, date, note || null, finalAmount);

    // ── NAVIGATION OPTIMISTE : on rend la main TOUT DE SUITE (retour à l'écran d'origine), la
    // sauvegarde part en arrière-plan. La carte Pouls (host global) apparaît par-dessus l'écran
    // d'origine dès l'insert ; en cas d'échec, une alerte globale prévient (appAlert).
    // Les valeurs du formulaire sont déjà CAPTURÉES dans des constantes locales → resetForm() ne
    // change rien à la sauvegarde en vol.
    /* La destination de retour vient de l'URL, donc de n'importe qui sur le web : on n'accepte
       qu'un chemin INTERNE (cf. safeInternalRoute), sinon l'enregistrement pourrait faire sortir de
       l'application — une page de connexion imitée n'aurait plus qu'à se présenter. */
    const origin = safeInternalRoute(params.origin ? decodeURIComponent(String(params.origin)) : null);
    const finish = async () => {
      if (isTransfer && asProjectDraft) {
        const row = await addTransaction.mutateAsync({
          account_id: accountId,
          category_id: null,
          amount: -Math.abs(num),
          date,
          note: note || attachedProject!.name,
          linked_account_id: targetAccountId,
          is_draft: true,
          is_recurring: false,
          recurrence_rule: null,
          recurrence_end_date: null,
          project_id: attachedProject!.id,
          checkRegulConflict: false,
          on_behalf_member_id: params.on_behalf || null,
        });
        if ((row as any)?.id) insertedIds.push((row as any).id);
      } else if (isTransfer) {
        // Atomicité (2 jambes + rollback) centralisée — logique unique partagée avec l'écran Virement.
        await createTransferLegs(addTransaction, deleteTransaction, {
          fromAccountId: accountId,
          toAccountId: targetAccountId,
          amount: num,
          amountTo: isCross ? numTo : undefined,
          date,
          noteFrom: note || `Virement vers ${accounts.find(a => a.id === targetAccountId)?.name}`,
          noteTo: note || `Virement depuis ${accounts.find(a => a.id === accountId)?.name}`,
          isDraft,
          isRecurring,
          recurrenceRule,
          recurrenceEndDate: endDateISO,
          // Projet posé sur les DEUX jambes, comme le fait la validation d'un brouillon de projet.
          projectId: attachedProject?.id ?? null,
          checkRegulConflict: false,
          regulCoveredAnswer,
          onBehalfMemberId: params.on_behalf || null,
        });
      } else {
        const row = await addTransaction.mutateAsync({
          account_id: accountId,
          category_id: categoryId || null,
          amount: finalAmount,
          date,
          note: note || undefined,
          linked_account_id: null,
          is_draft: isDraft,
          is_recurring: isRecurring,
          recurrence_rule: isRecurring ? recurrenceRule : null,
          recurrence_end_date: endDateISO,
          project_id: attachedProject?.id ?? null,
          checkRegulConflict: false,
          regulCoveredAnswer,
          on_behalf_member_id: params.on_behalf || null,
        });
        if ((row as any)?.id) insertedIds.push((row as any).id);
      }

      // (Les invalidations de caches sont faites DANS la mutation — fin de mutationFn — donc elles
      // survivent au démontage de cet écran, sans double refetch du lourd pilotage_data.)

      /* SUITES D'UN VIREMENT VENU DU PILOTAGE. Un virement validé depuis une reco n'est PAS marqué
         « traitée » : le montant viré est déjà compté dans le suivi du mois, la reco se réduit donc
         d'elle-même. En revanche, ce qui était mis DE CÔTÉ doit cesser de l'être — sinon la même
         somme reste comptée deux fois, une fois réservée et une fois virée. */
      if (isTransfer && !isDraft) {
        if (params.resetPreSaving) await resetPreSaving.mutateAsync(String(params.resetPreSaving) as PreSavingType);
        if (params.releaseProject) await releaseReserved.mutateAsync(String(params.releaseProject));
      }

      // Projet : mensualité recalculée (mode « date cible », apport validé) + échéance planifiée du
      // même mois remplacée (anti double-compte). L'avancement, lui, est dérivé des transactions.
      // Best-effort : en cas d'échec, l'échéancier se réalignera à la prochaine modification du projet.
      if (attachedProject) {
        // « Validée » = compte déjà dans l'avancement : ni brouillon, ni datée dans le futur.
        const validated = !isDraft && date <= today;
        void attachToProject({
          project: attachedProject,
          amount: num,
          date,
          accumulatedBefore,
          validated,
          insertedIds,
        }).catch(() => {});
      }
    };

    // Retour IMMÉDIAT à l'écran d'origine (bouton d'accès rapide → origin ; sinon écran précédent),
    // formulaire remis à neuf : l'utilisateur ne quitte jamais vraiment son écran.
    resetForm();
    if (origin) { router.replace(origin as any); }
    else router.back();

    finish().catch((e: unknown) => {
      /* L'écriture a échoué APRÈS le retour à l'écran d'origine : on relâche le verrou pour que
         l'utilisateur puisse réellement réessayer depuis une nouvelle saisie. */
      submitLock.release();
      // Limite d'usage serveur : le backstop global affiche déjà le dialog convivial → pas de doublon.
      if (parseUsageLimitError(e)) return;
      void appAlert({
        title: 'Enregistrement impossible',
        message: e instanceof Error ? e.message : 'La transaction n\'a pas pu être enregistrée. Réessaie.',
      });
    });
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
          <Text style={styles.text}>Connecte-toi pour ajouter une transaction.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title="Nouvelle transaction" onBack={handleBack} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={styles.scroll} contentContainerStyle={[styles.scrollContent, keyboardPadding]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {formError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorBannerText}>{formError}</Text>
            </View>
          )}
          {/* #4bis — saisie « au nom de » un membre (compte joint) : bandeau d'info. */}
          {!!params.on_behalf && (
            <View style={[styles.errorBanner, { backgroundColor: COLORS.blue + '14', borderColor: COLORS.blue + '44' }]}>
              <Ionicons name="people-circle-outline" size={16} color={COLORS.blue} />
              <Text style={[styles.errorBannerText, { color: COLORS.blue }]}>
                Saisie au nom de {params.on_behalf_name ? decodeURIComponent(String(params.on_behalf_name)) : 'ce membre'}
              </Text>
            </View>
          )}
          {/* Sélecteur de type — étape 1 uniquement */}
          {step === 1 && (
            /* Ordre unifié avec la page Transactions : Virement, Dépense, Recette. */
            <SegmentedControl
              options={[
                { value: 'transfer', label: 'Virement', icon: 'swap-horizontal' },
                { value: 'expense', label: 'Dépense', icon: 'arrow-down' },
                { value: 'income', label: 'Recette', icon: 'arrow-up' },
              ]}
              value={transactionType}
              onChange={(v: string) => changeType(v as TransactionType)}
              role="radio"
              style={{ marginBottom: 20 }}
            />
          )}

          {/* Fil d'étapes */}
          <View style={styles.stepsRow}>
            <View style={[styles.stepDot, styles.stepDotActive]}><Text style={styles.stepDotText}>1</Text></View>
            <View style={[styles.stepBar, step >= 2 && styles.stepBarActive]} />
            <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]}><Text style={[styles.stepDotText, step < 2 && { color: COLORS.textSecondary }]}>2</Text></View>
          </View>
          <Text style={styles.stepTitle}>
            {step === 1
              ? (isTransfer ? 'De quel compte vers quel compte ?' : 'Détails de la ' + (isExpense ? 'dépense' : 'recette'))
              : (isTransfer ? 'Montant, libellé et date' : 'Quand ?')}
          </Text>

          {step === 1 ? (
            isTransfer ? (
              <>
                {/* Compte source */}
                <Text style={styles.label}>Depuis quel compte ?</Text>
                <AccountChipRow accounts={accounts} activeId={accountId} onSelect={setAccountId} />
                {/* Compte cible */}
                <Text style={styles.label}>Vers quel compte ?</Text>
                <AccountChipRow accounts={destAccounts} activeId={targetAccountId} disabledId={accountId} onSelect={setTargetAccountId} />
                {accounts.length < 2 && <Text style={styles.hint}>Il faut au moins deux comptes pour faire un virement.</Text>}
                {!!params.destType && destAccounts.length === 0 && (
                  <Text style={styles.hint}>
                    Aucun compte {params.destType === 'savings' ? 'épargne' : params.destType === 'investment' ? 'investissement' : ''}. Ajoutes-en un dans l'onglet Comptes.
                  </Text>
                )}
              </>
            ) : (
              <>
                {/* Compte (si plusieurs comptes courants) */}
                {selectableAccounts.length > 1 && (
                  <>
                    <Text style={styles.label}>Compte</Text>
                    <AccountChipRow accounts={selectableAccounts} activeId={accountId} onSelect={setAccountId} />
                  </>
                )}
                {selectableAccounts.length === 0 && <Text style={styles.hint}>Aucun compte courant. Ajoutes-en un dans l'onglet Comptes.</Text>}

                {/* Remboursement (dépense) */}
                {isExpense && (
                  <TouchableOpacity style={styles.refundToggle} onPress={() => setIsRefund((v) => !v)} activeOpacity={0.7} accessibilityRole="button">
                    <Ionicons name={isRefund ? 'checkbox' : 'square-outline'} size={20} color={isRefund ? COLORS.emerald : COLORS.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.refundLabel}>Remboursement (entrée d'argent)</Text>
                      <Text style={styles.refundHint}>S'impute en négatif sur la catégorie de dépense</Text>
                    </View>
                  </TouchableOpacity>
                )}

                {/* Libellé */}
                <Text style={styles.label}>Libellé (optionnel)</Text>
                <TextInput style={styles.input} value={note} onChangeText={setNote} onFocus={handleFocus} placeholder={notePlaceholder(isExpense ? 'expense' : 'income')} placeholderTextColor={COLORS.textSecondary} returnKeyType="next" />

                {/* Sous-catégorie */}
                <CategoryPicker
                  key={isExpense ? 'expense' : 'income'}
                  groups={categoryGroups}
                  selectedCategoryId={categoryId}
                  onSelect={(id) => { setCategoryId(id); setErrorFields((p) => p.filter((f) => f !== 'category')); setFormError(null); }}
                  label="Sous-catégorie *"
                  parents={subcatParents}
                  onCreateSubcategory={async (name, parentId, icon) => {
                    const created = await addCategory.mutateAsync({ name, type: isExpense ? 'expense' : 'income', parent_id: parentId, icon });
                    return (created as any)?.id ?? '';
                  }}
                />

                {/* Montant */}
                <Text style={styles.label}>Montant ({currencySymbolFor(accounts.find(a => a.id === accountId)?.currency)}) *</Text>
                <TextInput style={[styles.input, errorFields.includes('amount') && styles.inputError]} value={amount} onChangeText={(v) => { setAmount(sanitizeAmountInput(v)); setErrorFields((p) => p.filter((f) => f !== 'amount')); setFormError(null); }} onFocus={handleFocus} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={goNext} />
              </>
            )
          ) : (
            <>
              {/* Précédent */}
              <TouchableOpacity style={styles.prevLink} onPress={() => setStep(1)} accessibilityRole="button">
                <Ionicons name="chevron-back" size={16} color={COLORS.emerald} />
                <Text style={styles.prevLinkText}>Étape précédente</Text>
              </TouchableOpacity>

              {/* Virement : libellé + montant à l'étape 2 */}
              {isTransfer && (
                <>
                  <Text style={styles.label}>Libellé (optionnel)</Text>
                  <TextInput style={styles.input} value={note} onChangeText={setNote} onFocus={handleFocus} placeholder={notePlaceholder('transfer')} placeholderTextColor={COLORS.textSecondary} returnKeyType="next" />
                  <Text style={styles.label}>Montant {isCross ? 'envoyé ' : ''}({currencySymbolFor(srcCurrency)}) *</Text>
                  <TextInput style={[styles.input, errorFields.includes('amount') && styles.inputError]} value={amount} onChangeText={(v) => { amountToTouched.current = false; setAmount(sanitizeAmountInput(v)); setErrorFields((p) => p.filter((f) => f !== 'amount')); setFormError(null); }} onFocus={handleFocus} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" returnKeyType={isCross ? 'next' : 'done'} onSubmitEditing={isCross ? undefined : Keyboard.dismiss} />
                  {isCross && (
                    <>
                      <Text style={styles.label}>Montant reçu ({currencySymbolFor(dstCurrency)}) *</Text>
                      <TextInput style={[styles.input, errorFields.includes('amountTo') && styles.inputError]} value={amountTo} onChangeText={(v) => { amountToTouched.current = true; setAmountTo(sanitizeAmountInput(v)); setErrorFields((p) => p.filter((f) => f !== 'amountTo')); setFormError(null); }} onFocus={handleFocus} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
                      <Text style={styles.hint}>Proposé au taux du jour. Ajuste-le avec le montant RÉELLEMENT crédité sur ton relevé ({currencySymbolFor(srcCurrency)} → {currencySymbolFor(dstCurrency)}).</Text>
                    </>
                  )}

                  {/* Retrait d'un compte d'investissement : ce que ce virement prend au capital. */}
                  {!!withdrawalProrata && (() => {
                    const p = withdrawalProrata;
                    const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + currencySymbolFor(p.currency);
                    return (
                      <View style={styles.withdrawCard}>
                        <View style={styles.withdrawHeader}>
                          <Ionicons name="trending-down-outline" size={18} color={COLORS.orange} />
                          <Text style={styles.withdrawTitle}>Retrait d'un compte d'investissement</Text>
                        </View>
                        <Text style={styles.withdrawText}>
                          Règle du prorata : ce retrait se compose de <Text style={styles.withdrawStrong}>{p.capitalPct} % de capital</Text> ({fmt(p.capital)}) et {100 - p.capitalPct} % de plus-value ({fmt(p.plus)}).
                        </Text>
                        <View style={styles.withdrawRow}>
                          <Text style={styles.withdrawLabel}>Apport restant</Text>
                          <Text style={styles.withdrawVal}>{fmt(p.remainingContributed)}</Text>
                        </View>
                        <View style={styles.withdrawRow}>
                          <Text style={styles.withdrawLabel}>Solde restant</Text>
                          <Text style={styles.withdrawVal}>{fmt(p.remainingBalance)}</Text>
                        </View>
                      </View>
                    );
                  })()}
                </>
              )}

              {/* Date */}
              <Text style={styles.label}>Date</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={dateDisplay}
                  onChangeText={(text) => { setDateDisplay(text); const parsed = parseDateFromFrench(text); if (parsed) setDate(parsed); }}
                  onBlur={() => { if (date) setDateDisplay(formatDateFrench(date)); }}
                  onFocus={handleFocus}
                  placeholder="jj-mm-aaaa"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choisir une date" style={styles.calendarBtn} onPress={() => setShowCalendar('date')}>
                  <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                </TouchableOpacity>
              </View>

              {/* Récurrence */}
              <View style={styles.recurringSection}>
                <TouchableOpacity style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]} onPress={() => setIsRecurring(!isRecurring)}>
                  <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
                  <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>{isTransfer ? 'Virement récurrent' : 'Récurrent (ex. salaire mensuel)'}</Text>
                  {/* Bordure du guide tracée SUR le bouton lui-même (aucune position mesurée).
                      `inset: 0` et non le défaut négatif : le bouton occupe toute la largeur
                      disponible, une bordure débordante était rognée à gauche et à droite. */}
                </TouchableOpacity>
                {guideNeedsRecurring && (
                  // Consigne du guide → couleurs INVERSÉES, comme tous les messages de démarrage :
                  // sur fond clair, un texte vert clair se fondait dans le formulaire.
                  <View style={styles.recurringGuideHint}>
                    <Ionicons name="arrow-up" size={16} color={INV.emerald} />
                    <Text style={styles.recurringGuideHintText}>
                      Coche « Récurrent » : c'est ce qui fait rejouer cette opération chaque mois,
                      sans que tu aies à la ressaisir.
                    </Text>
                  </View>
                )}
                {isRecurring && (
                  <>
                    <Text style={styles.label}>Période</Text>
                    <View style={styles.periodRow}>
                      {(['weekly', 'monthly', 'quarterly', 'yearly'] as RecurrenceRule[]).map((rule) => (
                        <TouchableOpacity key={rule} style={[styles.periodChip, recurrenceRule === rule && styles.chipActive]} onPress={() => setRecurrenceRule(rule)}>
                          <Text style={[styles.periodChipText, recurrenceRule === rule && styles.chipTextActive]} numberOfLines={1}>
                            {rule === 'weekly' ? 'Hebdo' : rule === 'monthly' ? 'Mensuel' : rule === 'quarterly' ? 'Trim.' : 'Annuel'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.label}>Fin (optionnel, vide = sans fin)</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={recurrenceEndDateInput} onChangeText={setRecurrenceEndDateInput} onFocus={handleFocus} placeholder="jj-mm-aaaa ou vide" placeholderTextColor={COLORS.textSecondary} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choisir la date de fin" style={styles.calendarBtn} onPress={() => setShowCalendar('end')}>
                        <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>

              {/* Rattachement à un projet EN COURS correspondant à la saisie (comptes du virement /
                  compte + catégorie de la dépense). Pas pour une récurrente. */}
              {!isRecurring && matchingProjects.length > 0 && (
                <View style={styles.projectSection}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="flag-outline" size={16} color={COLORS.blue} />
                    <Text style={[styles.label, { marginBottom: 0 }]}>
                      {matchingProjects.length > 1 ? 'Projets correspondants' : 'Projet correspondant'}
                    </Text>
                  </View>
                  <Text style={styles.projectHint}>
                    {isTransfer
                      ? 'Ce virement correspond à un projet en cours. \nRattache-le pour mettre à jour le projet automatiquement.'
                      : 'Cette dépense correspond à un projet en cours. \nRattache-la pour mettre à jour le projet automatiquement.'}
                  </Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, !attachProjectId && styles.chipActive]}
                      onPress={() => setAttachProjectId(null)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, !attachProjectId && styles.chipTextActive]}>Aucun</Text>
                    </TouchableOpacity>
                    {matchingProjects.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.chip, attachProjectId === p.id && styles.chipActive]}
                        onPress={() => setAttachProjectId(p.id)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.chipText, attachProjectId === p.id && styles.chipTextActive]}>
                          {p.name} · {Math.round(progressPctById[p.id] ?? 0)} %
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {!!attachProjectId && (() => {
                    const p = matchingProjects.find((x) => x.id === attachProjectId);
                    if (!p) return null;
                    const future = date > todayISO();
                    if (isTransfer && future) {
                      return <Text style={styles.projectHint}>Datée dans le futur : elle sera créée comme une échéance à valider (brouillon) du projet.</Text>;
                    }
                    return (
                      <Text style={styles.projectHint}>
                        {(p as any).allocation_type === 'date' && !future
                          ? 'L’avancement du projet sera mis à jour et sa mensualité recalculée (montant restant ÷ mois restants). L’échéance prévue ce mois-ci est remplacée par cette saisie.'
                          : 'L’avancement du projet sera mis à jour. L’échéance prévue ce mois-ci est remplacée par cette saisie.'}
                      </Text>
                    );
                  })()}
                </View>
              )}

              {/* AVANCEMENT DU BUDGET — sous la récurrence, parce que c'est la DATE réglée juste
                  au-dessus qui décide de la période lue. Rien ne s'affiche si la (sous-)catégorie
                  n'a pas de budget : le formulaire ne démarche pas. Jamais sur un virement (il ne
                  sort pas du périmètre) ni sur une récurrente (hors dépenses variables). */}
              {!isTransfer && !isRecurring && (
                <BudgetInlineBlock
                  categoryId={categoryId || null}
                  date={date}
                  amount={Math.abs(parseAmountInput(amount) ?? 0)}
                  hidden={!isExpense}
                />
              )}
            </>
          )}

          {/* Actions : Suivant (étape 1) ou Enregistrer/Brouillon (étape 2) */}
          {step === 1 ? (
            <AppButton label="Suivant" size="lg" icon="arrow-forward" iconRight onPress={goNext} style={{ marginTop: 8 }} />
          ) : (
            <View style={styles.submitRow}>
              <AppButton
                label="Enregistrer"
                size="lg"
                full
                loading={addTransaction.isPending}
                disabled={guideNeedsRecurring}
                onPress={() => handleSubmit(false)}
              />
              <AppButton
                label="Brouillon"
                size="lg"
                variant="secondary"
                full
                disabled={addTransaction.isPending || guideNeedsRecurring}
                onPress={() => handleSubmit(true)}
              />
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>

        {/* Calendar Modal */}
        <Modal visible={!!showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
          <Pressable style={styles.calendarOverlay} onPress={() => setShowCalendar(false)}>
            <Pressable style={styles.calendarContainer} onPress={() => {}}>
              <View style={styles.calendarHeader}>
                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text }}>
                  {showCalendar === 'end' ? 'Date de fin' : 'Sélectionner une date'}
                </Text>
                <View style={{ width: 50 }} />
              </View>
              <CalendarWithPicker
                current={showCalendar === 'end' ? (recurrenceEndDateInput || date) : date}
                maxDate="2050-12-31"
                onDayPress={(day: any) => {
                  if (showCalendar === 'end') {
                    setRecurrenceEndDateInput(formatDateFrench(day.dateString));
                  } else {
                    setDate(day.dateString);
                    setDateDisplay(formatDateFrench(day.dateString));
                  }
                  setShowCalendar(false);
                }}
                markedDates={(() => {
                  const d = showCalendar === 'end' ? recurrenceEndDateInput : date;
                  if (!d) return {};
                  return { [d]: { selected: true, selectedColor: COLORS.emerald, selectedTextColor: '#000' } };
                })()}
                accentColor={COLORS.emerald}
                bgColor={COLORS.card}
                textColor={COLORS.text}
                textSecondaryColor={COLORS.textSecondary}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
      <CalculatorButton page="transactions" />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  /* Sélecteur de type : `components/ui/SegmentedControl` — même composant que tous les autres
     choix « une option parmi peu » de l'app. */
  stepsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
  stepDotActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  stepDotText: { fontSize: 13, fontWeight: '800', color: c.onAccent },
  stepBar: { width: 60, height: 2, backgroundColor: c.cardBorder },
  stepBarActive: { backgroundColor: c.emerald },
  stepTitle: { fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 20 },
  prevLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 14 },
  prevLinkText: { fontSize: 14, fontWeight: '700', color: c.emerald },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
  typeBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  typeBtnLabelActive: { color: c.onAccent },
  refundToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, marginBottom: 16 },
  refundLabel: { fontSize: 14, fontWeight: '600', color: c.text },
  refundHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  toggleLabelActive: { color: c.onAccent },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
    marginBottom: 20,
  },
  chip: { ...chipStyles(c).chip, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
  chipActive: { ...chipStyles(c).chipActive },
  chipText: { ...chipStyles(c).label },
  chipTextActive: { ...chipStyles(c).labelActive },
  inputError: { borderColor: c.danger },
  // Retrait d'un compte d'investissement : la décomposition capital / plus-value, avant validation.
  withdrawCard: { backgroundColor: c.orange + '14', borderWidth: 1, borderColor: c.orange + '55', borderRadius: 12, padding: 14, marginBottom: 20 },
  withdrawHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  withdrawTitle: { fontSize: 14, fontWeight: '800', color: c.text },
  withdrawText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginBottom: 10 },
  withdrawStrong: { fontWeight: '700', color: c.text },
  withdrawRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  withdrawLabel: { fontSize: 13, color: c.textSecondary },
  withdrawVal: { fontSize: 15, fontWeight: '800', color: c.text },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.danger + '1F',
    borderWidth: 1,
    borderColor: c.danger + '66',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: c.danger, lineHeight: 18 },
  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 16 },
  text: { color: c.text, marginBottom: 16 },
  btn: { backgroundColor: c.card, padding: 14, borderRadius: 12, alignSelf: 'flex-start' },
  btnLabel: { color: c.text, fontWeight: '600' },
  recurringSection: { marginTop: 8, marginBottom: 16 },
  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 12,
  },
  recurringToggleActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  recurringLabel: { fontSize: 15, color: c.textSecondary },
  recurringLabelActive: { color: c.onAccent, fontWeight: '600' },
  // Consigne du guide : carte aux couleurs INVERSÉES (cf. useInvertedColors), comme les autres
  // messages de démarrage — elle doit trancher sur le formulaire, pas s'y fondre.
  recurringGuideHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: c.guideBg, borderWidth: 1, borderColor: c.guideBorder,
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, marginTop: 2, marginBottom: 12,
  },
  recurringGuideHintText: { flex: 1, fontSize: 13, color: c.guideText, lineHeight: 19, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  /* Périodicité : les quatre choix tiennent sur UNE ligne (`flex: 1` chacun), quel que soit
     l'écran. Style distinct des chips de comptes, qui eux défilent horizontalement et gardent
     leur taille de lecture. */
  periodRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  periodChip: {
    flex: 1, paddingHorizontal: 4, paddingVertical: 9, borderRadius: 14,
    borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center',
  },
  periodChipText: { fontSize: 12.5, fontWeight: '600', color: c.text },
  projectSection: { marginTop: 4, marginBottom: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.blue + '44', backgroundColor: c.blue + '0D', gap: 8 },
  projectHint: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  /* Les boutons eux-mêmes viennent de `components/ui/AppButton` : leurs styles vivaient ici, avec
     des couleurs écrites en dur (#475569 / #94a3b8) qui ne suivaient ni le thème clair ni l'accent
     choisi — « Brouillon » restait gris ardoise à côté d'un « Enregistrer » vert. */
  submitRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  calendarBtn: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarContainer: {
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    width: '90%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
});
}

/* OUVERTURE INSTANTANÉE : silhouette de page pendant le montage du corps (cf. useDeferredMount). */
export default withDeferredMount(AddTransactionScreen);
