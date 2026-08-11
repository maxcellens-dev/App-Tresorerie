/**
 * Création / modification d'un PROJET PERSONNEL.
 *
 * Création = assistant en 4 étapes :
 *   1. « Tu souhaites ? »  → le MODE (mettre de côté / conserver / dépenser petit à petit)
 *   2. Le projet           → nom, description, budget (+ catégorie de dépense si mode « dépenser »)
 *   3. La planification    → mensuel / date cible / ponctuel, date de la 1ʳᵉ échéance
 *   4. Le(s) compte(s)     → 2 comptes (virements) ou 1 seul (conserver / dépenser)
 *
 * Modification = les MÊMES blocs, en ONGLETS (Projet / Planification / Comptes). Tout tenait
 * auparavant sur une seule page à dérouler : une trentaine de champs visibles d'un coup, on ne
 * savait plus où regarder. Les onglets réutilisent le découpage de l'assistant — d'où `step`
 * partagé entre les deux modes (2, 3, 4 = les trois onglets ; l'étape 1, le mode, n'existe pas
 * en modification). Enregistrer reste possible depuis n'importe quel onglet : en cas de champ
 * manquant, on ouvre automatiquement l'onglet fautif.
 *
 * Le MODE est figé à la création : en modification, tout est éditable SAUF lui (changer de mode
 * reviendrait à réinterpréter des transactions déjà générées, voire déjà portées au solde).
 * Cf. lib/projectTx pour ce que chaque mode génère réellement dans Transactions.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  TextInput,
  FlatList,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/useResponsive';
import { pageColumn } from '../lib/webLayout';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ScreenGradient from './ScreenGradient';
import ScreenHeader from './ScreenHeader';
import CalendarWithPicker from './CalendarWithPicker';
import CategoryPicker, { useSubCategoriesGrouped } from './CategoryPicker';
import KeyboardAwareScrollView from './KeyboardAwareScrollView';
import { useAuth } from '../contexts/AuthContext';
import { useProjects, useAddProject, useUpdateProject, useDeleteProjectDissociating, useCheckProjectTransactions } from '../hooks/useProjects';
import { useUsageGuard } from '../hooks/useUsageLimits';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories, useAddCategory } from '../hooks/useCategories';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';
import { projectMode, type ProjectMode } from '../lib/projectTx';
import { todayISO } from '../lib/dateUtils';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';


type AllocationType = 'monthly' | 'date' | 'ponctuel';

/**
 * Tout le vocabulaire de l'écran dépend du mode : un projet « dépenser » ne parle ni de virement,
 * ni d'allocation. Une seule table de textes → aucun message incohérent.
 */
const MODES: Record<ProjectMode, {
  key: ProjectMode;
  icon: string;
  title: string;
  pitch: string;
  what: string;
  amountLabel: string;
  amountHint: string;
  monthlyLabel: string;
  monthlyPlaceholder: string;
  dayLabel: string;
  entriesLabel: string;
  firstDateLabel: string;
  totalLabel: string;
  accountStepTitle: string;
  recap: string;
}> = {
  transfer: {
    key: 'transfer',
    icon: 'trending-up',
    title: 'Mettre de côté',
    pitch: 'Envoyer l’argent sur un compte épargne ou investissement',
    what: 'À chaque échéance, l’app prépare un VIREMENT de ton compte courant vers ton épargne (ou ton investissement). Tu le valides quand il est fait sur la page Transactions : l’argent change vraiment de compte, et le projet avance.',
    amountLabel: 'Montant à atteindre',
    amountHint: 'La somme totale que tu veux avoir mise de côté au bout du compte.',
    monthlyLabel: 'Montant mis de côté chaque mois',
    monthlyPlaceholder: '500',
    dayLabel: 'Jour du mois des virements',
    entriesLabel: 'Versements par mois',
    firstDateLabel: 'Date du premier virement',
    totalLabel: 'Total des versements',
    accountStepTitle: 'D’où vient l’argent, où va-t-il ?',
    recap: 'Des virements seront préparés en brouillon, à valider un par un dans Transactions.',
  },
  reserve: {
    key: 'reserve',
    icon: 'lock-closed',
    title: 'Réserver pour plus tard',
    pitch: 'Garder l’argent sur le compte, mais le mettre de côté « pour ce projet »',
    what: 'L’argent ne bouge PAS : il reste sur ton compte, simplement marqué « Réservé ». Il ne compte plus dans ce que tu peux dépenser ce mois-ci, mais il t’attend pour ton projet. Aucun virement, aucune dépense.',
    amountLabel: 'Montant à réserver',
    amountHint: 'La somme totale que tu veux avoir mise de côté au bout du compte.',
    monthlyLabel: 'Montant réservé chaque mois',
    monthlyPlaceholder: '500',
    dayLabel: 'Jour du mois des réservations',
    entriesLabel: 'Réservations par mois',
    firstDateLabel: 'Date de la première réservation',
    totalLabel: 'Total réservé',
    accountStepTitle: 'Sur quel compte l’argent reste-t-il ?',
    recap: 'Le montant sera marqué « Réservé » sur ton compte : il reste là, mais sort de ton budget disponible.',
  },
  spend: {
    key: 'spend',
    icon: 'card',
    title: 'Dépenser petit à petit',
    pitch: 'Le projet coûte de l’argent au fil du temps',
    what: 'L’app crée de VRAIES DÉPENSES dans tes transactions, au rythme que tu choisis (par exemple 80 € par mois de cours de piano). Ton budget et ta prévision en tiennent compte immédiatement, comme n’importe quelle dépense.',
    amountLabel: 'Budget total du projet',
    amountHint: 'Tout ce que le projet va te coûter, du début à la fin.',
    monthlyLabel: 'Dépense de chaque mois',
    monthlyPlaceholder: '80',
    dayLabel: 'Jour du mois des dépenses',
    entriesLabel: 'Dépenses par mois',
    firstDateLabel: 'Date de la première dépense',
    totalLabel: 'Total des dépenses',
    accountStepTitle: 'Sur quel compte tombent les dépenses ?',
    recap: 'Les dépenses seront ajoutées à ton compte aux dates prévues (elles sont déjà comptées dans ta prévision).',
  },
};

/**
 * Onglets de la MODIFICATION. `step` reprend la numérotation de l'assistant de création : un même
 * bloc de champs est donc rendu par la même condition dans les deux modes.
 */
const EDIT_TABS = [
  { step: 2, label: 'Projet', icon: 'document-text-outline' },
  { step: 3, label: 'Planification', icon: 'calendar-outline' },
  { step: 4, label: 'Comptes', icon: 'wallet-outline' },
] as const;

interface PonctuelEntry {
  enabled: boolean;
  amount: string;
}

interface FormState {
  name: string;
  description: string;
  target_amount: string;
  allocation_type: AllocationType;
  monthly_allocation: string;
  target_date: string;
  expense_category_id: string;
  source_account_id: string | null;
  linked_account_id: string | null;
  first_payment_date: string;
  current_accumulated: number;
}

function getNext12Months(): { key: string; label: string; dayOne: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const dayOne = `${key}-01`;
    result.push({ key, label, dayOne });
  }
  return result;
}

export default function AddProjectModal() {
  const COLORS = useAppColors();
  const { isDesktop } = useResponsive(); // web bureau : colonne de formulaire centrée
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { data: projects = [] } = useProjects(user?.id || '');
  const isEdit = !!params.id;
  const editingProject: Project | null = useMemo(
    () => (params.id ? projects.find((p) => p.id === params.id) ?? null : null),
    [projects, params.id]
  );
  const addProjectMutation = useAddProject(user?.id || '');
  const { guard } = useUsageGuard(user?.id);
  const updateProjectMutation = useUpdateProject(user?.id || '');
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(user?.id || '');
  const { data: categories = [] } = useCategories(user?.id);
  const expenseGroups = useSubCategoriesGrouped(categories, 'expense');
  const addCategory = useAddCategory(user?.id);
  const expenseParents = useMemo(
    () =>
      categories
        .filter((c) => (c.parent_id == null || c.parent_id === '') && String(c.type).toLowerCase() === 'expense')
        .filter((c) => c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() !== 'mouvements')
        .map((c) => ({ id: c.id, name: c.name })),
    [categories]
  );

  const months12 = useMemo(() => getNext12Months(), []);
  const today = todayISO();
  const currentMonthKey = useMemo(() => today.slice(0, 7), [today]);

  // Mode : choisi à l'étape 1 (création) ; relu du projet et VERROUILLÉ en modification.
  const [mode, setMode] = useState<ProjectMode | null>(null);
  const M = MODES[mode ?? 'transfer'];
  const isSpend = mode === 'spend';
  const isReserve = mode === 'reserve';

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    target_amount: '',
    allocation_type: 'monthly',
    monthly_allocation: '',
    target_date: '',
    expense_category_id: '',
    source_account_id: null,
    linked_account_id: null,
    first_payment_date: '',
    current_accumulated: 0,
  });

  // ponctuelEntries: key YYYY-MM → { enabled, amount } — UNIQUEMENT la ligne ÉDITABLE (à venir) du mois.
  const [ponctuelEntries, setPonctuelEntries] = useState<Record<string, PonctuelEntry>>({});
  // Échéances FIGÉES : déjà validées / déjà passées → lecture seule, plusieurs par mois possibles.
  const [frozenTxns, setFrozenTxns] = useState<Array<{ id: string; month: string; date: string; amount: number; validated: boolean }>>([]);
  // Jour du mois où les échéances ponctuelles sont générées (1-31, clampé selon le mois)
  const [ponctuelDay, setPonctuelDay] = useState('1');

  // Construit la date d'un mois ponctuel au jour choisi (clampé au dernier jour du mois)
  const ponctuelDateFor = (key: string): string => {
    const [y, m] = key.split('-').map(Number);
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(Math.max(1, parseInt(ponctuelDay) || 1), maxDay);
    return `${key}-${String(day).padStart(2, '0')}`;
  };

  const [showAccountPicker, setShowAccountPicker] = useState<'source' | 'destination' | null>(null);
  const [showCalendar, setShowCalendar] = useState<'target' | 'payment' | false>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  // 1) mode 2) projet 3) planification 4) comptes. En création, ce sont les étapes de l'assistant ;
  // en modification, les valeurs 2 à 4 sont les ONGLETS (l'étape 1 — le mode — est verrouillée).
  // Initialisé directement sur le 1er onglet en modification : sinon la première image affichée
  // serait un écran sans contenu (aucun bloc ne répond à `step === 1` hors assistant).
  const [step, setStep] = useState(params.id ? EDIT_TABS[0].step : 1);
  const wizard = !isEdit;
  const LAST_STEP = 4;

  // Deletion state
  const deleteDissociatingMutation = useDeleteProjectDissociating(user?.id || '');
  const { check: checkTransactions } = useCheckProjectTransactions(user?.id || '');
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    title: string;
    message: string;
    options: Array<{ label: string; action: () => void; destructive?: boolean }>;
  } | null>(null);
  // Montant mensuel : auto-calculé depuis le montant cible tant que l'utilisateur ne l'a pas modifié.
  const [monthlyAllocEdited, setMonthlyAllocEdited] = useState(false);

  // Initialisation : en édition, on attend que le projet soit chargé pour pré-remplir (1 seule fois).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (isEdit) {
      if (!editingProject) return; // attendre le chargement de la liste
      initializedRef.current = true;
      setMonthlyAllocEdited(true); // en édition, on ne réécrase pas le montant existant
      const editMode = projectMode(editingProject);
      setMode(editMode);
      const allocType: AllocationType = (editingProject.allocation_type as AllocationType) || (editingProject.target_date ? 'date' : 'monthly');
      setForm({
        name: editingProject.name || '',
        description: editingProject.description || '',
        target_amount: editingProject.target_amount?.toString() || '',
        allocation_type: allocType,
        monthly_allocation: editingProject.monthly_allocation?.toString() || '',
        target_date: editingProject.target_date || '',
        expense_category_id: editingProject.expense_category_id || '',
        source_account_id: editingProject.source_account_id || null,
        linked_account_id: editingProject.linked_account_id || null,
        first_payment_date: editingProject.first_payment_date || (editingProject.transaction_day ? (() => { const d = new Date(); d.setDate(editingProject.transaction_day!); return d.toISOString().slice(0, 10); })() : ''),
        current_accumulated: editingProject.current_accumulated || 0,
      });

      // Si ponctuel : charger les échéances existantes, en séparant les FIGÉES de celles encore
      // modifiables. Une échéance est figée si elle a déjà eu lieu :
      //  • mode « dépenser » : la dépense est validée d'emblée → c'est sa DATE qui tranche ;
      //  • autres modes : brouillon → figé s'il est validé ou sur un mois passé.
      if (allocType === 'ponctuel' && supabase) {
        supabase
          .from('transactions')
          .select('id, date, amount, is_draft')
          .eq('project_id', editingProject.id)
          .lt('amount', 0)
          .order('date', { ascending: true })
          .then(({ data: txns }) => {
            if (!txns) return;
            const frozen: Array<{ id: string; month: string; date: string; amount: number; validated: boolean }> = [];
            const editable: Record<string, PonctuelEntry> = {};
            let firstDay: number | null = null;
            for (const t of txns as any[]) {
              const month = String(t.date).slice(0, 7);
              const validated = t.is_draft === false;
              const done = editMode === 'spend'
                ? String(t.date) <= today
                : (validated || month < currentMonthKey);
              if (firstDay === null) firstDay = Number(String(t.date).slice(8, 10)) || 1;
              if (done) {
                frozen.push({ id: t.id, month, date: t.date, amount: Math.abs(Number(t.amount)), validated });
              } else {
                editable[month] = { enabled: true, amount: Math.abs(Number(t.amount)).toString() };
              }
            }
            setFrozenTxns(frozen);
            setPonctuelEntries(editable);
            if (firstDay !== null) setPonctuelDay(String(firstDay));
          });
      } else {
        setFrozenTxns([]);
        setPonctuelEntries({});
        setPonctuelDay('1');
      }
    } else {
      initializedRef.current = true;
      setStep(1);
      setFormError(null);
      setErrorFields([]);
    }
  }, [isEdit, editingProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode « mensuel » : suggère automatiquement le montant mensuel = montant total / 12 mois,
  // tant que l'utilisateur n'a pas saisi sa propre valeur (il peut toujours la modifier).
  const DEFAULT_PROJECT_MONTHS = 12;
  useEffect(() => {
    if (monthlyAllocEdited || form.allocation_type !== 'monthly') return;
    const target = parseFloat(form.target_amount);
    if (!(target > 0)) return;
    const suggested = String(Math.max(1, Math.ceil(target / DEFAULT_PROJECT_MONTHS)));
    if (suggested !== form.monthly_allocation) setForm((f) => ({ ...f, monthly_allocation: suggested }));
  }, [form.target_amount, form.allocation_type, monthlyAllocEdited]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculatedAllocation = useMemo(() => {
    if (form.allocation_type !== 'date' || !form.target_date || !form.target_amount) return null;
    const targetAmount = parseFloat(form.target_amount);
    const amountToAccumulate = Math.max(0, targetAmount - form.current_accumulated);
    const startDate = form.first_payment_date || today;
    const endLimit = new Date(form.target_date + 'T23:59:59');
    // Count payment months using same cursor logic as the delete recalculation
    const cursor = new Date(startDate + 'T00:00:00');
    if (cursor > endLimit) return null;
    let monthsLeft = 0;
    const c = new Date(cursor);
    while (c <= endLimit) { monthsLeft++; c.setMonth(c.getMonth() + 1); }
    monthsLeft = Math.max(1, monthsLeft);
    return amountToAccumulate / monthsLeft;
  }, [form.allocation_type, form.target_date, form.target_amount, form.current_accumulated, form.first_payment_date, today]);

  // Total = échéances figées (déjà actées) + lignes éditables activées (à venir).
  const ponctuelTotal = useMemo(() => {
    const frozenSum = frozenTxns.reduce((s, t) => s + t.amount, 0);
    const editableSum = Object.values(ponctuelEntries).reduce((sum, e) => (e?.enabled && e.amount ? sum + (parseFloat(e.amount) || 0) : sum), 0);
    return frozenSum + editableSum;
  }, [frozenTxns, ponctuelEntries]);

  // Échéances figées groupées par mois (plusieurs possibles par mois).
  const frozenByMonth = useMemo(() => {
    const map: Record<string, typeof frozenTxns> = {};
    for (const t of frozenTxns) (map[t.month] ??= []).push(t);
    return map;
  }, [frozenTxns]);

  // Mois affichés = mois PASSÉS ayant des échéances figées (lecture seule) + les 12 mois à partir du
  // mois courant (chacun avec sa ligne éditable, + ses éventuelles échéances figées du mois).
  const ponctuelDisplayMonths = useMemo(() => {
    const pastFrozen = Object.keys(frozenByMonth)
      .filter((k) => k < currentMonthKey)
      .sort()
      .map((k) => {
        const [y, m] = k.split('-').map(Number);
        return {
          key: k,
          label: new Date(y, m - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          dayOne: `${k}-01`,
          editable: false,
        };
      });
    return [...pastFrozen, ...months12.map((m) => ({ ...m, editable: true }))];
  }, [frozenByMonth, currentMonthKey, months12]);

  const togglePonctuelMonth = (key: string) => {
    setPonctuelEntries((prev) => {
      const cur = prev[key];
      if (cur?.enabled) {
        return { ...prev, [key]: { enabled: false, amount: cur.amount } };
      }
      return { ...prev, [key]: { enabled: true, amount: cur?.amount || '' } };
    });
  };

  const setPonctuelAmount = (key: string, value: string) => {
    setPonctuelEntries((prev) => ({
      ...prev,
      [key]: { enabled: prev[key]?.enabled ?? true, amount: value.replace(/[^0-9.]/g, '') },
    }));
  };

  const selectedSourceAccount = accounts.find((acc) => acc.id === form.source_account_id);
  const selectedAccount = accounts.find((acc) => acc.id === form.linked_account_id);
  const isPending = addProjectMutation.isPending || updateProjectMutation.isPending;

  // Validation d'une étape de l'assistant. Renvoie true si l'étape est valide.
  const validateStep = (s: number): boolean => {
    setFormError(null);
    setErrorFields([]);
    if (s === 1) {
      if (!mode) { setFormError('Choisis ce que tu souhaites faire.'); return false; }
      return true;
    }
    if (s === 2) {
      if (!form.name.trim()) { setFormError('Le nom du projet est obligatoire.'); setErrorFields(['name']); return false; }
      if (!form.target_amount.trim() || isNaN(parseFloat(form.target_amount))) { setFormError(`${M.amountLabel} : montant obligatoire.`); setErrorFields(['target_amount']); return false; }
      if (isSpend && !form.expense_category_id) { setFormError('Choisis la catégorie des dépenses du projet.'); setErrorFields(['category']); return false; }
      return true;
    }
    if (s === 3) {
      if (form.allocation_type === 'monthly') {
        if (!form.monthly_allocation.trim()) { setFormError(`${M.monthlyLabel} : montant obligatoire.`); setErrorFields(['monthly_allocation']); return false; }
      } else if (form.allocation_type === 'date') {
        if (!form.target_date || !calculatedAllocation) { setFormError('Entre une date cible valide.'); setErrorFields(['target_date']); return false; }
      } else {
        const anyEnabled = Object.values(ponctuelEntries).some((e) => e?.enabled && parseFloat(e.amount || '0') > 0);
        if (!anyEnabled) { setFormError('Active au moins un mois avec un montant.'); return false; }
      }
      return true;
    }
    return true;
  };

  const goNext = () => { if (validateStep(step)) setStep((s) => Math.min(LAST_STEP, s + 1)); };
  const goPrev = () => { setFormError(null); setErrorFields([]); setStep((s) => Math.max(1, s - 1)); };

  /**
   * Refuse l'enregistrement ET ramène sur l'étape/l'onglet qui porte le champ fautif. En
   * modification, le bouton « Mettre à jour » est disponible depuis n'importe quel onglet : sans
   * ce saut, le message d'erreur désignerait un champ resté sur un autre onglet.
   */
  const failOn = (targetStep: number, message: string, fields: string[] = []) => {
    setFormError(message);
    setErrorFields(fields);
    setStep(targetStep);
  };

  /** Choix du mode (étape 1) : sélectionne et enchaîne directement sur le projet. */
  const chooseMode = (m: ProjectMode) => {
    setMode(m);
    setFormError(null);
    // Les comptes n'ont pas le même sens d'un mode à l'autre → on repart d'une sélection vierge.
    setForm((f) => ({ ...f, source_account_id: null, linked_account_id: null, expense_category_id: m === 'spend' ? f.expense_category_id : '' }));
    setStep(2);
  };

  const handleSubmit = async () => {
    setFormError(null);
    setErrorFields([]);
    if (!mode) { setFormError('Choisis ce que tu souhaites faire.'); setStep(1); return; }

    if (!form.name.trim()) {
      failOn(2, 'Le nom du projet est obligatoire.', ['name']);
      return;
    }
    if (!form.target_amount.trim() || isNaN(parseFloat(form.target_amount))) {
      failOn(2, `${M.amountLabel} : montant obligatoire.`, ['target_amount']);
      return;
    }
    if (isSpend && !form.expense_category_id) {
      failOn(2, 'Choisis la catégorie des dépenses du projet.', ['category']);
      return;
    }
    if (!form.source_account_id) {
      failOn(4, isSpend ? 'Choisis le compte sur lequel tombent les dépenses.' : isReserve ? 'Choisis le compte sur lequel l’argent reste.' : 'Sélectionne un compte source.', ['source_account']);
      return;
    }
    if (mode === 'transfer') {
      if (!form.linked_account_id) {
        failOn(4, 'Sélectionne un compte de destination.', ['linked_account']);
        return;
      }
      if (form.linked_account_id === form.source_account_id) {
        failOn(4, 'Le compte de destination doit être différent du compte source. Pour garder l’argent sur place, crée plutôt un projet « Conserver pour plus tard ».', ['linked_account']);
        return;
      }
    }

    let monthlyAlloc = 0;
    let ponctuelList: { date: string; amount: number }[] | undefined;

    if (form.allocation_type === 'monthly') {
      if (!form.monthly_allocation.trim()) {
        failOn(3, `${M.monthlyLabel} : montant obligatoire.`, ['monthly_allocation']);
        return;
      }
      monthlyAlloc = parseFloat(form.monthly_allocation);
    } else if (form.allocation_type === 'date') {
      if (!form.target_date || !calculatedAllocation) {
        failOn(3, 'Entre une date cible valide.', ['target_date']);
        return;
      }
      monthlyAlloc = calculatedAllocation;
    } else {
      // ponctuel — ne régénérer que le mois courant + futurs (les échéances passées sont préservées)
      ponctuelList = Object.keys(ponctuelEntries)
        .filter((k) => k >= currentMonthKey && ponctuelEntries[k]?.enabled && parseFloat(ponctuelEntries[k]?.amount || '0') > 0)
        .sort()
        .map((k) => ({ date: ponctuelDateFor(k), amount: parseFloat(ponctuelEntries[k].amount) }));
      const anyEnabled = Object.values(ponctuelEntries).some((e) => e?.enabled && parseFloat(e.amount || '0') > 0);
      // En édition, des échéances déjà figées suffisent : on autorise l'enregistrement même sans
      // nouvelle ligne éditable (ex. simple renommage d'un projet déjà actif).
      if (!anyEnabled && frozenTxns.length === 0) {
        failOn(3, 'Active au moins un mois avec un montant.');
        return;
      }
      monthlyAlloc = ponctuelList.length > 0 ? ponctuelList.reduce((s, e) => s + e.amount, 0) / ponctuelList.length : 0;
    }

    const resetForm = () => {
      // Succès : la liste se rafraîchit via l'invalidation des requêtes, on revient à l'écran précédent.
      router.back();
    };

    // Limite d'usage (projets) — création uniquement ; le serveur reste le vrai garde-fou.
    if (!editingProject && !(await guard('project'))) return;

    const common = {
      name: form.name,
      description: form.description || undefined,
      target_amount: parseFloat(form.target_amount),
      monthly_allocation: monthlyAlloc,
      allocation_type: form.allocation_type,
      current_accumulated: form.current_accumulated,
      expense_category_id: isSpend ? form.expense_category_id : null,
      source_account_id: form.source_account_id,
      // Le hook normalise selon le mode (destination = source si « conserver », aucune si « dépenser »).
      linked_account_id: mode === 'transfer' ? form.linked_account_id : mode === 'reserve' ? form.source_account_id : null,
      transaction_day: form.first_payment_date ? new Date(form.first_payment_date).getDate() : 1,
      first_payment_date: form.first_payment_date || undefined,
      ponctuel_entries: ponctuelList,
    };

    if (editingProject) {
      updateProjectMutation.mutate(
        {
          id: editingProject.id,
          ...common,
          target_date: form.allocation_type === 'date' ? form.target_date : null,
        },
        { onSuccess: resetForm }
      );
    } else {
      addProjectMutation.mutate(
        {
          ...common,
          mode,
          source_account_id: form.source_account_id || undefined,
          linked_account_id: (common.linked_account_id ?? undefined) || undefined,
          target_date: form.allocation_type === 'date' ? form.target_date : undefined,
        },
        { onSuccess: resetForm }
      );
    }
  };

  const handleClose = () => {
    setShowAccountPicker(null);
    setShowCalendar(false);
    setFormError(null);
    setErrorFields([]);
    setStep(1);
    router.back();
  };

  const runDeleteDissociating = () => {
    if (!editingProject) return;
    setDeleteConfirmState(null);
    deleteDissociatingMutation.mutate(editingProject.id, {
      onSuccess: () => { handleClose(); },
      onError: () => Alert.alert('Erreur', 'La suppression du projet a échoué.'),
    });
  };

  const handleDelete = async () => {
    if (!editingProject) return;
    try {
      const { validated, drafts, pastValidated, futureValidated } = await checkTransactions(editingProject.id);
      const lines = [`Projet « ${editingProject.name} »`, ''];

      if (isSpend) {
        // « Dépenser » : les dépenses passées ont vraiment eu lieu → conservées (détachées du projet).
        // Celles à venir n'ont jamais eu lieu → supprimées avec le projet.
        if (pastValidated.length > 0) {
          lines.push('✓ Conservé dans tes comptes :');
          lines.push(`  • ${pastValidated.length} dépense(s) déjà passée(s), détachée(s) du projet (elles restent dans tes dépenses)`);
          lines.push('');
        }
        lines.push('✗ Sera supprimé :');
        lines.push('  • Le projet');
        if (futureValidated.length > 0) lines.push(`  • ${futureValidated.length} dépense(s) à venir (jamais réalisée(s))`);
        if (pastValidated.length === 0 && futureValidated.length === 0) lines.push('  • Aucune transaction liée');
      } else {
        // Validés (is_draft=false) → conservés et détachés du projet (deviennent des virements
        // classiques). Brouillons (non validés) → supprimés. Le projet est supprimé.
        const vCount = validated.length;
        const dCount = drafts.length;
        if (vCount > 0) {
          lines.push('✓ Conservé dans tes comptes :');
          lines.push(`  • ${vCount} virement(s) validé(s), détaché(s) du projet (deviennent des virements classiques)`);
          lines.push('');
        }
        lines.push('✗ Sera supprimé :');
        lines.push('  • Le projet');
        if (dCount > 0) lines.push(`  • ${dCount} ${isReserve ? 'réservation(s)' : 'virement(s)'} en attente (non validé(s))`);
        if (vCount === 0 && dCount === 0) lines.push('  • Aucune transaction liée');
      }
      lines.push('', 'Cette action est irréversible.');

      setDeleteConfirmState({
        title: 'Supprimer le projet ?',
        message: lines.join('\n'),
        options: [
          { label: 'Annuler', action: () => setDeleteConfirmState(null) },
          { label: 'Oui, supprimer', destructive: true, action: runDeleteDissociating },
        ],
      });
    } catch {
      setDeleteConfirmState({
        title: 'Erreur',
        message: 'Impossible de vérifier les transactions du projet.',
        options: [{ label: 'Fermer', action: () => setDeleteConfirmState(null) }],
      });
    }
  };

  const formatDateFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-');
      return `${day}-${month}-${year}`;
    } catch { return dateStr; }
  };

  const parseDateFromFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const cleaned = dateStr.replace(/\D/g, '');
      if (cleaned.length === 8) {
        const day = cleaned.substring(0, 2);
        const month = cleaned.substring(2, 4);
        const year = cleaned.substring(4, 8);
        const date = new Date(`${year}-${month}-${day}`);
        if (isNaN(date.getTime())) return '';
        const t = new Date(); t.setHours(0, 0, 0, 0);
        if (date < t) return '';
        return `${year}-${month}-${day}`;
      }
    } catch { return ''; }
    return '';
  };

  const stepTitle = step === 1 ? 'Tu souhaites ?' : step === 2 ? 'Ton projet' : step === 3 ? 'Le rythme' : M.accountStepTitle;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      {/* edges={[]} comme TOUTES les pages secondaires : avec ['top'], l'inset du haut était compté
          DEUX FOIS (le layout l'applique déjà) → vide au-dessus du bouton « Retour ». */}
      {/* Bureau : colonne de FORMULAIRE centrée. Sans elle, cet écran s'étirait sur toute la
          largeur de la fenêtre — des champs de 1 500 px pour saisir un montant. */}
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form', 16)]} edges={[]}>
        <ScreenHeader
          title={isEdit ? 'Modifier le projet' : 'Nouveau projet'}
          onBack={handleClose}
        />
        {isEdit && !editingProject ? (
          <View style={styles.loadingContainer}><ActivityIndicator color={COLORS.primary} /></View>
        ) : (
          <View style={styles.pageBody}>
            {!showAccountPicker ? (
              <>
              {/* Onglets (modification) — HORS du défilement : ils restent atteignables quel que
                  soit l'endroit où on se trouve dans un onglet long (la planification ponctuelle
                  fait à elle seule douze lignes). */}
              {isEdit && (
                <View style={styles.tabBar}>
                  {EDIT_TABS.map((t) => {
                    const active = step === t.step;
                    return (
                      <TouchableOpacity
                        key={t.step}
                        style={[styles.tabBtn, active && styles.tabBtnActive]}
                        onPress={() => { setStep(t.step); setFormError(null); setErrorFields([]); }}
                        activeOpacity={0.8}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                      >
                        <Ionicons name={t.icon as any} size={15} color={active ? COLORS.primary : COLORS.textSecondary} />
                        <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={{ flex: 1 }}>
              <KeyboardAwareScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
                {/* Bandeau erreur */}
                {formError && (
                  <View style={[styles.errorBanner, { borderColor: COLORS.danger + '66', backgroundColor: COLORS.danger + '1F' }]}>
                    <Text style={styles.errorBannerText}>{formError}</Text>
                  </View>
                )}
                {wizard && (
                  <View style={styles.stepIndicator}>
                    {[1, 2, 3, 4].map((n, i) => (
                      <React.Fragment key={n}>
                        <View style={[styles.stepDot, step >= n && styles.stepDotActive]}>
                          <Text style={[styles.stepDotText, step >= n && styles.stepDotTextActive]}>{n}</Text>
                        </View>
                        {i < 3 && <View style={[styles.stepLine, step > n && styles.stepLineActive]} />}
                      </React.Fragment>
                    ))}
                  </View>
                )}
                {wizard && <Text style={styles.stepTitle}>{stepTitle}</Text>}

                {/* ── Étape 1 : le MODE. Chaque bouton dit ce que l'app fera vraiment. ── */}
                {wizard && step === 1 && (
                  <>
                    <Text style={styles.modeIntro}>
                      Pour ce projet, que doit faire l’argent ?
                    </Text>
                    {/* Ordre : mettre de côté → dépenser petit à petit → réserver. « Dépenser » est
                        le second cas le plus courant (cours, abonnement, voyage payé en plusieurs
                        fois) ; « réserver » est le plus subtil des trois, il vient en dernier. */}
                    {(['transfer', 'spend', 'reserve'] as ProjectMode[]).map((m) => {
                      const cfg = MODES[m];
                      const active = mode === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[styles.modeCard, active && { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '12' }]}
                          onPress={() => chooseMode(m)}
                          activeOpacity={0.85}
                          disabled={isPending}
                        >
                          <View style={styles.modeCardHead}>
                            <View style={[styles.modeIcon, { backgroundColor: COLORS.primary + '22' }]}>
                              <Ionicons name={cfg.icon as any} size={20} color={COLORS.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.modeTitle}>{cfg.title}</Text>
                              <Text style={styles.modePitch}>{cfg.pitch}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
                          </View>
                          <Text style={styles.modeWhat}>{cfg.what}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {/* Rappel du mode choisi (étapes suivantes) — et, en édition, mention « non modifiable ». */}
                {mode && step > 1 && (
                  <View style={[styles.modeBanner, { borderColor: COLORS.primary + '40', backgroundColor: COLORS.primary + '0E' }]}>
                    <Ionicons name={M.icon as any} size={16} color={COLORS.primary} />
                    <Text style={styles.modeBannerText}>
                      <Text style={{ fontWeight: '800', color: COLORS.text }}>{M.title}</Text>
                      {' — '}{M.recap}
                    </Text>
                    {isEdit ? (
                      <Ionicons name="lock-closed" size={13} color={COLORS.textSecondary} />
                    ) : (
                      <TouchableOpacity onPress={() => setStep(1)} disabled={isPending}>
                        <Text style={[styles.modeChange, { color: COLORS.primary }]}>Changer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {/* Explication du verrou : sur le seul onglet où on lit le mode, pas sur les trois. */}
                {isEdit && step === 2 && (
                  <Text style={styles.modeLockedHint}>
                    Le type de projet ne se change pas après coup : pour en changer, supprime ce projet et crées-en un nouveau.
                  </Text>
                )}

                {/* ── Étape 2 / onglet « Projet » ── */}
                {step === 2 && (<>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Nom du projet *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: errorFields.includes('name') ? COLORS.danger : COLORS.border }]}
                    placeholder={isSpend ? 'Ex. Cours de piano' : 'Ex. Nouvelle voiture'}
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.name}
                    onChangeText={(t) => { setForm({ ...form, name: t }); setErrorFields((p) => p.filter((f) => f !== 'name')); setFormError(null); }}
                    editable={!isPending}
                  />
                  <Text style={styles.fieldHint}>Ce nom apparaîtra sur chaque {isSpend ? 'dépense' : isReserve ? 'réservation' : 'virement'} du projet, dans tes transactions.</Text>
                </View>

                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Description (optionnel)</Text>
                  <TextInput
                    style={[styles.textarea, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                    placeholder="Détails du projet"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.description}
                    onChangeText={(t) => setForm({ ...form, description: t })}
                    multiline
                    numberOfLines={2}
                    editable={!isPending}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>{M.amountLabel} ({CURRENCY_SYMBOL}) *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: errorFields.includes('target_amount') ? COLORS.danger : COLORS.border }]}
                    placeholder={isSpend ? '960' : '10000'}
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.target_amount}
                    onChangeText={(t) => { setForm({ ...form, target_amount: t.replace(/[^0-9.]/g, '') }); setErrorFields((p) => p.filter((f) => f !== 'target_amount')); setFormError(null); }}
                    keyboardType="decimal-pad"
                    editable={!isPending}
                  />
                  <Text style={styles.fieldHint}>{M.amountHint}</Text>
                </View>

                {/* Catégorie — uniquement pour les projets qui GÉNÈRENT DES DÉPENSES : c'est elle qui
                    classera ces dépenses dans le budget, la trésorerie et le reporting. */}
                {isSpend && (
                  <View style={[styles.field, errorFields.includes('category') && { borderLeftWidth: 2, borderLeftColor: COLORS.danger, paddingLeft: 8 }]}>
                    <CategoryPicker
                      groups={expenseGroups}
                      selectedCategoryId={form.expense_category_id}
                      onSelect={(id) => { setForm((f) => ({ ...f, expense_category_id: id })); setErrorFields((p) => p.filter((f) => f !== 'category')); setFormError(null); }}
                      label="Catégorie des dépenses *"
                      parents={expenseParents}
                      onCreateSubcategory={async (name, parentId, icon) => {
                        const created = await addCategory.mutateAsync({ name, type: 'expense', parent_id: parentId, icon });
                        return (created as any)?.id ?? '';
                      }}
                    />
                    <Text style={styles.fieldHint}>
                      Chaque dépense du projet sera rangée dans cette catégorie (ex. « Loisirs › Musique »).
                    </Text>
                  </View>
                )}
                </>)}

                {/* ── Étape 3 / onglet « Planification » ── */}
                {step === 3 && (<>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Planification</Text>
                  <View style={styles.toggleGroup}>
                    {(['monthly', 'date', 'ponctuel'] as AllocationType[]).map((type) => {
                      const labels = { monthly: 'Mensuel', date: 'Date cible', ponctuel: 'Ponctuel' };
                      const active = form.allocation_type === type;
                      return (
                        <TouchableOpacity
                          key={type}
                          style={[styles.toggleButton, active && { backgroundColor: COLORS.primary + '30', borderColor: COLORS.primary }]}
                          onPress={() => setForm({ ...form, allocation_type: type })}
                        >
                          <Text style={[styles.toggleText, { color: active ? COLORS.primary : COLORS.text }]}>
                            {labels[type]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={styles.fieldHint}>
                    {form.allocation_type === 'monthly'
                      ? `Le même montant chaque mois, jusqu’à atteindre ${isSpend ? 'le budget' : 'l’objectif'}.`
                      : form.allocation_type === 'date'
                        ? `Tu donnes une date : l’app calcule le montant mensuel qu’il faut pour y arriver.`
                        : `Tu choisis toi-même les mois et les montants (utile quand c’est irrégulier).`}
                  </Text>
                </View>

                {/* Mensuel */}
                {form.allocation_type === 'monthly' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>{M.monthlyLabel} ({CURRENCY_SYMBOL}) *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                      placeholder={M.monthlyPlaceholder}
                      placeholderTextColor={COLORS.textSecondary}
                      value={form.monthly_allocation}
                      onChangeText={(t) => { setMonthlyAllocEdited(true); setForm({ ...form, monthly_allocation: t.replace(/[^0-9.]/g, '') }); }}
                      keyboardType="decimal-pad"
                      editable={!isPending}
                    />
                    <Text style={[styles.label, { color: COLORS.textSecondary, fontSize: 12, marginTop: 6, fontWeight: '400' }]}>
                      {monthlyAllocEdited
                        ? 'Tu fixes toi-même le montant mensuel.'
                        : `Calculé automatiquement (${isSpend ? 'budget' : 'objectif'} étalé sur ${DEFAULT_PROJECT_MONTHS} mois) — modifiable.`}
                    </Text>
                    {/* ETA parlante : le user voit IMMÉDIATEMENT quand ce sera terminé (recalculée en direct). */}
                    {(() => {
                      const target = parseFloat(form.target_amount);
                      const monthly = parseFloat(form.monthly_allocation);
                      if (!(target > 0) || !(monthly > 0)) return null;
                      const remaining = Math.max(0, target - (form.current_accumulated || 0));
                      const monthsN = Math.max(1, Math.ceil(remaining / monthly));
                      const eta = new Date();
                      eta.setMonth(eta.getMonth() + monthsN);
                      const etaLabel = eta.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                      return (
                        <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary + '40', marginTop: 8 }]}>
                          <Text style={styles.infoIcon}>🎯</Text>
                          <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>
                            À <Text style={{ fontWeight: '800', color: COLORS.text }}>{Math.round(monthly).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}/mois</Text>,
                            {isSpend ? ' le budget sera consommé en ' : ' objectif atteint en '}
                            <Text style={{ fontWeight: '800', color: COLORS.text }}>{etaLabel}</Text> ({monthsN} mois).
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                )}

                {/* Date cible */}
                {form.allocation_type === 'date' && (
                  <>
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: COLORS.text }]}>Date cible (jj-mm-aaaa) *</Text>
                      <View style={styles.dateInputContainer}>
                        <TextInput
                          style={[styles.input, styles.dateTextInput, { backgroundColor: COLORS.background, borderColor: COLORS.border, color: COLORS.text }]}
                          placeholder="jj-mm-aaaa"
                          placeholderTextColor={COLORS.textSecondary}
                          value={form.target_date ? formatDateFrench(form.target_date) : ''}
                          onChangeText={(t) => {
                            const p = parseDateFromFrench(t);
                            if (p) setForm({ ...form, target_date: p });
                            else if (t === '') setForm({ ...form, target_date: '' });
                          }}
                          editable={!isPending}
                        />
                        <TouchableOpacity
                          style={[styles.calendarButton, { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary }]}
                          onPress={() => setShowCalendar('target')}
                          disabled={isPending}
                        >
                          <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {calculatedAllocation !== null && (
                      <View style={[styles.field, { backgroundColor: COLORS.background, padding: 12, borderRadius: 8 }]}>
                        <Text style={[styles.label, { color: COLORS.primary }]}>{M.monthlyLabel}</Text>
                        <Text style={[styles.calculatedAmount, { color: COLORS.primary }]}>
                          {calculatedAllocation.toFixed(2)} {CURRENCY_SYMBOL}/mois
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Ponctuel */}
                {form.allocation_type === 'ponctuel' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>{M.dayLabel}</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.input, { flex: 1, backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                        placeholder="1"
                        placeholderTextColor={COLORS.textSecondary}
                        value={ponctuelDay}
                        onChangeText={(t) => {
                          const clean = t.replace(/[^0-9]/g, '');
                          if (clean === '') { setPonctuelDay(''); return; }
                          const n = Math.min(31, Math.max(1, parseInt(clean)));
                          setPonctuelDay(String(n));
                        }}
                        keyboardType="number-pad"
                        maxLength={2}
                        editable={!isPending}
                      />
                      <Text style={{ color: COLORS.textSecondary, fontSize: 13, paddingHorizontal: 4 }}>du mois</Text>
                    </View>
                    <Text style={[styles.label, { color: COLORS.text, marginTop: 12 }]}>{M.entriesLabel}</Text>
                    <View style={[styles.ponctuelContainer, { backgroundColor: COLORS.background, borderColor: COLORS.border }]}>
                      {ponctuelDisplayMonths.map((m, idx) => {
                        const frozenRows = frozenByMonth[m.key] ?? [];
                        const entry = ponctuelEntries[m.key];
                        const enabled = entry?.enabled ?? false;
                        const isLastMonth = idx === ponctuelDisplayMonths.length - 1;
                        return (
                          <React.Fragment key={m.key}>
                            {/* Échéances FIGÉES du mois (déjà faites) — lecture seule, plusieurs possibles */}
                            {frozenRows.map((fr) => (
                              <View
                                key={fr.id}
                                style={[styles.ponctuelRow, { borderBottomWidth: 1, borderBottomColor: COLORS.border, opacity: 0.7 }]}
                              >
                                <View style={styles.ponctuelToggle}>
                                  <Ionicons name="lock-closed" size={14} color={fr.validated ? COLORS.green : COLORS.textSecondary} />
                                </View>
                                <Text style={[styles.ponctuelLabel, { color: COLORS.textSecondary }]} numberOfLines={1}>
                                  {m.label} · {isSpend ? 'déjà dépensé' : fr.validated ? 'validé' : 'passé'}
                                </Text>
                                <Text style={[styles.ponctuelInput, { color: COLORS.textSecondary, borderColor: 'transparent', textAlign: 'right' }]}>
                                  {fr.amount.toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
                                </Text>
                              </View>
                            ))}
                            {/* Ligne ÉDITABLE du mois (à venir) — TOUTE la ligne active/désactive le
                                mois (pas seulement la puce) ; le champ montant, lui, capte ses
                                propres touches → taper dedans ne bascule pas la ligne. */}
                            {m.editable && (
                              <TouchableOpacity
                                style={[
                                  styles.ponctuelRow,
                                  !isLastMonth && { borderBottomWidth: 1, borderBottomColor: COLORS.border },
                                ]}
                                onPress={() => togglePonctuelMonth(m.key)}
                                activeOpacity={0.7}
                                disabled={isPending}
                                accessibilityRole="button"
                                accessibilityLabel={`${enabled ? 'Désactiver' : 'Activer'} ${m.label}`}
                              >
                                <View style={styles.ponctuelToggle}>
                                  <View style={[styles.ponctuelDot, enabled && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}>
                                    {enabled && <View style={styles.ponctuelDotInner} />}
                                  </View>
                                </View>
                                <Text style={[styles.ponctuelLabel, { color: enabled ? COLORS.text : COLORS.textSecondary }]}>
                                  {m.label}{frozenRows.length > 0 ? (isSpend ? ' · autre dépense' : ' · autre versement') : ''}
                                </Text>
                                {enabled ? (
                                  <TextInput
                                    style={[styles.ponctuelInput, { color: COLORS.blue, borderColor: COLORS.blue + '60' }]}
                                    placeholder="0"
                                    placeholderTextColor={COLORS.textSecondary}
                                    value={entry?.amount || ''}
                                    onChangeText={(v) => setPonctuelAmount(m.key, v)}
                                    keyboardType="decimal-pad"
                                    editable={!isPending}
                                  />
                                ) : (
                                  <Text style={styles.ponctuelDash}>–</Text>
                                )}
                              </TouchableOpacity>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Total */}
                      <View style={[styles.ponctuelTotal, { borderTopColor: COLORS.border }]}>
                        <Text style={[styles.ponctuelTotalLabel, { color: COLORS.textSecondary }]}>{M.totalLabel}</Text>
                        <Text style={[styles.ponctuelTotalAmount, { color: COLORS.blue }]}>
                          {ponctuelTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Date de la première échéance (hors ponctuel, qui a ses propres dates) */}
                {form.allocation_type !== 'ponctuel' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>{M.firstDateLabel}</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.input, styles.dateTextInput, { backgroundColor: COLORS.background, borderColor: COLORS.border, color: COLORS.text }]}
                        placeholder="jj-mm-aaaa"
                        placeholderTextColor={COLORS.textSecondary}
                        value={form.first_payment_date ? formatDateFrench(form.first_payment_date) : ''}
                        onChangeText={(t) => {
                          const p = parseDateFromFrench(t);
                          if (p) setForm({ ...form, first_payment_date: p });
                          else if (t === '') setForm({ ...form, first_payment_date: '' });
                        }}
                        editable={!isPending}
                      />
                      <TouchableOpacity
                        style={[styles.calendarButton, { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary }]}
                        onPress={() => setShowCalendar('payment')}
                        disabled={isPending}
                      >
                        <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                      </TouchableOpacity>
                    </View>
                    {isEdit && isSpend && (
                      <Text style={styles.fieldHint}>
                        Les dépenses déjà passées ne bougent pas (elles ont eu lieu). Seules celles à venir sont recalculées.
                      </Text>
                    )}
                  </View>
                )}
                </>)}

                {/* ── Étape 4 / onglet « Comptes » ── */}
                {step === 4 && (<>
                {!editingProject && (
                  <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary + '40' }]}>
                    <Text style={styles.infoIcon}>💡</Text>
                    <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>
                      {isSpend ? (
                        <>
                          Chaque échéance deviendra une <Text style={{ fontWeight: '700', color: COLORS.text }}>dépense réelle</Text> sur ce compte, à sa date.
                          Tu pourras la modifier ou la supprimer une par une dans l’onglet Transactions, ou tout revoir d’un coup en rouvrant ce projet.
                        </>
                      ) : isReserve ? (
                        <>
                          Chaque échéance sera <Text style={{ fontWeight: '700', color: COLORS.text }}>mise de côté sur ce compte</Text> (tag « Réservé »).
                          Aucun virement n’est fait : l’argent ne bouge pas, il sort seulement de ton budget disponible.
                        </>
                      ) : (
                        <>
                          Chaque versement sera préparé comme un <Text style={{ fontWeight: '700', color: COLORS.text }}>virement en brouillon</Text> à sa date.
                          Tu pourras ensuite <Text style={{ fontWeight: '700', color: COLORS.text }}>valider ou ajuster chaque versement un par un</Text> dans l’onglet Transactions.
                        </>
                      )}
                    </Text>
                  </View>
                )}

                {/* Compte principal : source du virement / compte réservé / compte des dépenses */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>
                    {isSpend ? 'Compte des dépenses *' : isReserve ? 'Compte où l’argent reste *' : 'Compte source *'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: COLORS.background, borderColor: errorFields.includes('source_account') ? COLORS.danger : COLORS.border, justifyContent: 'center' }]}
                    onPress={() => setShowAccountPicker('source')}
                    disabled={isPending}
                  >
                    <Text style={[styles.pickerText, { color: selectedSourceAccount ? COLORS.text : COLORS.textSecondary }]}>
                      {selectedSourceAccount ? selectedSourceAccount.name : 'Sélectionner un compte'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.fieldHint}>
                    {isSpend
                      ? 'Le compte débité par les dépenses du projet (en général ton compte courant).'
                      : isReserve
                        ? 'L’argent reste sur ce compte : rien n’en sort, il est juste réservé au projet.'
                        : 'Le compte d’où part l’argent (en général ton compte courant).'}
                  </Text>
                </View>

                {/* Compte de destination — uniquement quand on met de côté ailleurs */}
                {mode === 'transfer' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>Compte de destination *</Text>
                    <TouchableOpacity
                      style={[styles.input, { backgroundColor: COLORS.background, borderColor: errorFields.includes('linked_account') ? COLORS.danger : COLORS.border, justifyContent: 'center' }]}
                      onPress={() => setShowAccountPicker('destination')}
                      disabled={isPending}
                    >
                      <Text style={[styles.pickerText, { color: selectedAccount ? COLORS.text : COLORS.textSecondary }]}>
                        {selectedAccount ? selectedAccount.name : 'Sélectionner le compte destination'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.fieldHint}>Le compte qui reçoit l’argent : épargne ou investissement.</Text>
                  </View>
                )}
                </>)}

                {/* Actions — placées sous les champs (comme les écrans Dépense/Recette/Virement).
                    En modification, « Mettre à jour » est proposé depuis chaque onglet : on
                    enregistre tout le projet, pas seulement l'onglet ouvert. */}
                {step > 1 && (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.button, styles.cancelButton, { borderColor: COLORS.border }]}
                      onPress={wizard && step > 1 ? goPrev : handleClose}
                      disabled={isPending}
                    >
                      <Text style={[styles.buttonText, { color: COLORS.text }]}>{wizard && step > 1 ? 'Précédent' : 'Annuler'}</Text>
                    </TouchableOpacity>
                    {wizard && step < LAST_STEP ? (
                      <TouchableOpacity
                        style={[styles.button, { backgroundColor: COLORS.primary }]}
                        onPress={goNext}
                        disabled={isPending}
                      >
                        <Text style={styles.submitButtonText}>Suivant</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.button, { backgroundColor: COLORS.primary }]}
                        onPress={handleSubmit}
                        disabled={isPending}
                      >
                        {isPending ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.submitButtonText}>{editingProject ? 'Mettre à jour' : 'Créer'}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Bouton Supprimer — sur le seul onglet « Projet » : le répéter sous chaque onglet
                    mettrait une action destructrice sous le doigt à trois endroits différents. */}
                {editingProject && step === 2 && (
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: COLORS.danger + '20', marginTop: 12 }]}
                    onPress={() => { handleDelete(); }}
                    disabled={deleteDissociatingMutation.isPending}
                  >
                    {deleteDissociatingMutation.isPending ? (
                      <ActivityIndicator color={COLORS.danger} />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Ionicons name="trash" size={16} color={COLORS.danger} />
                        <Text style={[styles.submitButtonText, { color: COLORS.danger }]}>Supprimer le projet</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                <View style={{ height: 24 }} />
              </KeyboardAwareScrollView>
              </KeyboardAvoidingView>
              </>
            ) : (
              /* Account Picker */
              <View style={styles.form}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={() => setShowAccountPicker(null)}>
                    <Text style={[styles.pickerHeaderText, { color: COLORS.primary }]}>Retour</Text>
                  </TouchableOpacity>
                  <Text style={[styles.pickerHeaderTitle, { color: COLORS.text }]}>
                    {showAccountPicker === 'source'
                      ? (isSpend ? 'Compte des dépenses' : isReserve ? 'Compte réservé' : 'Compte source')
                      : 'Compte destination'}
                  </Text>
                  <View style={{ width: 50 }} />
                </View>
                {accountsLoading ? (
                  <View style={styles.loadingContainer}><ActivityIndicator color={COLORS.primary} /></View>
                ) : (
                  <FlatList
                    data={accounts}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => {
                      const currentId = showAccountPicker === 'source' ? form.source_account_id : form.linked_account_id;
                      const isSelected = item.id === currentId;
                      return (
                        <TouchableOpacity
                          style={[styles.accountOption, { backgroundColor: COLORS.background, borderBottomColor: COLORS.border }, isSelected && { backgroundColor: COLORS.primary + '20' }]}
                          onPress={() => {
                            if (showAccountPicker === 'source') setForm({ ...form, source_account_id: item.id });
                            else setForm({ ...form, linked_account_id: item.id });
                            setErrorFields([]);
                            setFormError(null);
                            setShowAccountPicker(null);
                          }}
                        >
                          <View style={styles.accountContent}>
                            <Text style={[styles.accountName, { color: COLORS.text, fontWeight: isSelected ? '600' : '400' }]}>
                              {item.name || 'Compte sans nom'}
                            </Text>
                            <Text style={[styles.accountType, { color: COLORS.textSecondary }]}>{item.type}</Text>
                          </View>
                          {isSelected && <Text style={[styles.checkmark, { color: COLORS.primary }]}>✓</Text>}
                        </TouchableOpacity>
                      );
                    }}
                    scrollEnabled
                  />
                )}
              </View>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Calendar modal */}
      <Modal visible={!!showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
        <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 }]} onPress={() => setShowCalendar(false)}>
          <Pressable style={[styles.calendarContainer, { backgroundColor: COLORS.cardSolid, borderColor: COLORS.border, borderRadius: 20, width: '100%', maxWidth: 420 }]} onPress={() => {}}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setShowCalendar(false)}>
                <Text style={[styles.calendarHeaderText, { color: COLORS.primary }]}>Fermer</Text>
              </TouchableOpacity>
              <Text style={[styles.calendarTitle, { color: COLORS.text }]}>Sélectionner une date</Text>
              <View style={{ width: 50 }} />
            </View>
            <View style={styles.calendarWrapper}>
              <CalendarWithPicker
                current={showCalendar === 'payment' ? (form.first_payment_date || today) : (form.target_date || today)}
                maxDate="2050-12-31"
                onDayPress={(day: any) => {
                  if (showCalendar === 'payment') setForm({ ...form, first_payment_date: day.dateString });
                  else setForm({ ...form, target_date: day.dateString });
                  setShowCalendar(false);
                }}
                markedDates={(() => {
                  const dateStr = showCalendar === 'payment' ? form.first_payment_date : form.target_date;
                  if (!dateStr) return {};
                  return { [dateStr]: { selected: true, selectedColor: COLORS.primary, selectedTextColor: '#000' } };
                })()}
                accentColor={COLORS.primary}
                bgColor={COLORS.cardSolid}
                textColor={COLORS.text}
                textSecondaryColor={COLORS.textSecondary}
                style={styles.calendar}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={!!deleteConfirmState} transparent animationType="fade">
        <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', paddingHorizontal: 20 }]}>
          <View style={[styles.confirmBox, { backgroundColor: COLORS.cardSolid }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="warning" size={20} color={COLORS.danger} />
              <Text style={[styles.confirmTitle, { color: COLORS.text, marginBottom: 0, flex: 1 }]}>{deleteConfirmState?.title}</Text>
            </View>
            <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>{deleteConfirmState?.message}</Text>
            <View style={styles.confirmButtonGroup}>
              {deleteConfirmState?.options.map((opt, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.confirmButton,
                    {
                      backgroundColor: opt.destructive ? COLORS.danger + '20' : COLORS.primary + '10',
                      borderColor: opt.destructive ? COLORS.danger : COLORS.primary,
                    },
                  ]}
                  onPress={opt.action}
                >
                  <Text style={[styles.confirmButtonText, { color: opt.destructive ? COLORS.danger : COLORS.primary }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  confirmBox: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  confirmTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  confirmMessage: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  confirmButtonGroup: { gap: 10 },
  confirmButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmButtonText: { fontSize: 14, fontWeight: '600' },
  container: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, maxHeight: '90%', borderTopWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600' },
  closeButton: { fontSize: 24, fontWeight: '300' },
  root: { flex: 1, backgroundColor: c.background },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  pageBody: { flex: 1 },
  form: { flex: 1, marginBottom: 12 },
  field: { marginBottom: 12 },
  fieldHint: { fontSize: 11.5, lineHeight: 16, color: c.textSecondary, marginTop: 6 },
  // Onglets de la modification (rendus hors défilement, sous l'en-tête).
  tabBar: { flexDirection: 'row', gap: 4, marginBottom: 12, padding: 4, backgroundColor: c.background, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 9 },
  tabBtnActive: { backgroundColor: c.primary + '1F' },
  tabText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: c.primary, fontWeight: '800' },
  stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, gap: 0 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  stepDotActive: { backgroundColor: c.primary, borderColor: c.primary },
  stepDotText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  stepDotTextActive: { color: '#fff' },
  stepLine: { width: 28, height: 2, backgroundColor: c.border, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: c.primary },
  stepTitle: { fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 14 },
  // Étape 1 — choix du mode
  modeIntro: { fontSize: 13, lineHeight: 18, color: c.textSecondary, textAlign: 'center', marginBottom: 14 },
  modeCard: { borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, marginBottom: 12, backgroundColor: c.background },
  modeCardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  modePitch: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  modeWhat: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, marginTop: 10 },
  // Rappel du mode (étapes suivantes / édition)
  modeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  modeBannerText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: c.textSecondary },
  modeChange: { fontSize: 12, fontWeight: '700' },
  modeLockedHint: { fontSize: 11, lineHeight: 15, color: c.textSecondary, marginBottom: 12, fontStyle: 'italic' },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: 'top' },
  toggleGroup: { flexDirection: 'row', gap: 6 },
  toggleButton: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  toggleText: { fontSize: 12, fontWeight: '500' },
  calculatedAmount: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  dateInputContainer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dateTextInput: { flex: 1 },
  calendarButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  pickerText: { fontSize: 14 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 12 },
  pickerHeaderText: { fontSize: 14, fontWeight: '500', width: 50 },
  pickerHeaderTitle: { fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  accountOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  accountContent: { flex: 1 },
  accountName: { fontSize: 14, marginBottom: 4 },
  accountType: { fontSize: 12 },
  checkmark: { fontSize: 18, fontWeight: '600', marginLeft: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { borderWidth: 1 },
  buttonText: { fontSize: 14, fontWeight: '600' },
  submitButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  calendarContainer: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, maxHeight: '90%', borderTopWidth: 1 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 16 },
  calendarHeaderText: { fontSize: 14, fontWeight: '500', width: 50 },
  calendarTitle: { fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  calendarWrapper: { height: 420, justifyContent: 'flex-start' },
  calendar: { overflow: 'hidden' },
  // Info box
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 12 },
  infoIcon: { fontSize: 14, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 17 },
  errorBanner: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  errorBannerText: { fontSize: 13, color: c.danger, lineHeight: 18 },
  // Ponctuel
  ponctuelContainer: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  ponctuelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  ponctuelToggle: { padding: 2 },
  ponctuelDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.cardBorder, justifyContent: 'center', alignItems: 'center' },
  ponctuelDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  ponctuelLabel: { flex: 1, fontSize: 13 },
  ponctuelInput: { width: 90, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, textAlign: 'right' },
  ponctuelDash: { width: 90, textAlign: 'right', fontSize: 13, color: c.cardBorder },
  ponctuelTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  ponctuelTotalLabel: { fontSize: 13, fontWeight: '600' },
  ponctuelTotalAmount: { fontSize: 14, fontWeight: '700' },
});
}
