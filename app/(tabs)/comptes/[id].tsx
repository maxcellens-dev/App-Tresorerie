import { useMemo, useState, useEffect } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Alert,
  Modal,
  useWindowDimensions,
} from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import { iconForCategory, VIREMENT_ICON } from '../../../lib/ui/categoryIcons';
import { todayISO } from '../../../lib/dateUtils';
import { sheetWidth, useSheetBottomPadding } from '../../../lib/ui/appLayout';
import { compareTransactionsForDisplay, isRegulRow } from '../../../lib/finance/txOrder';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts, useUpdateAccount } from '../../../hooks/data/useAccounts';
import { useAccountParticipants, useAccountMembers } from '../../../hooks/data/useSharedAccounts';
import { useAllTransactions, useAddTransaction, TX_FETCH_LIMIT } from '../../../hooks/data/useTransactions';
import { useTransactionMonthOverrides } from '../../../hooks/data/useTransactionMonthOverrides';
import { useCreditFlows } from '../../../hooks/data/useCreditFlows';
import { buildOverrideMap, applyMonthOverrides, overrideKey } from '../../../lib/finance/txOverrides';
import { recurrenceOccurrencesInMonth } from '../../../lib/finance/recurrenceMonth';
import { computeContributed } from '../../../lib/finance/contributed';
import type { TransactionWithDetails } from '../../../types/database';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { LinearGradient } from 'expo-linear-gradient';
import { contrastRatio, darken, lighten, readableOn } from '../../../theme/palette';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn, MAX_W, GUTTER } from '../../../lib/ui/webLayout';
import { currencySymbolFor } from '../../../lib/finance/currency';
import { INVESTMENT_GAIN_NOTE, INVESTMENT_LOSS_NOTE, isInvestmentGainLoss } from '../../../lib/finance/investment';
import BalanceChart from '../../../components/charts/BalanceChart';
import AccountSettingsForm from '../../../components/account/AccountSettingsForm';
import AccountAmountModal from '../../../components/account/AccountAmountModal';
import PageLoader from '../../../components/layout/PageLoader';
import { buildBalanceHistory } from '../../../lib/finance/balanceHistory';
import { sanitizeSignedAmountInput } from '../../../lib/ui/amountInput';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { useReadOnlyGuard } from '../../../hooks/platform/useReadOnlyGuard';
import { useNavBack } from '../../../hooks/platform/useNavBack';


/** Les trois façons de regarder un compte. Une seule à la fois : la fiche empilait tout. */
type AccountTab = 'solde' | 'transactions' | 'parametres';

const TABS: Array<{ id: AccountTab; label: string; icon: string }> = [
  { id: 'solde', label: 'Solde', icon: 'stats-chart-outline' },
  { id: 'transactions', label: 'Transactions', icon: 'list-outline' },
  { id: 'parametres', label: 'Paramètres', icon: 'settings-outline' },
];

const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

const VIREMENT_NOTE = 'Virement interne';

function isTransferNote(note: string | null): boolean {
  return note === VIREMENT_NOTE || (note != null && note.trim().toLowerCase().startsWith('virement'));
}

/**
 * INDEX DES JAMBES DE VIREMENT — construit UNE fois, interrogé en temps constant.
 *
 * Retrouver la jambe symétrique (même note + date + montant opposé, sur un autre compte, sans
 * catégorie) se faisait par un balayage de TOUTES les transactions, et deux fois par ligne affichée
 * (une pour savoir si c'en est un, une pour retrouver le compte d'en face). Sur un compte fourni,
 * c'est quadratique : l'écran ramait à l'ouverture et à chaque « charger 3 mois de plus ».
 *
 * La clé de recherche est exactement le critère d'appariement — date, note, et montant ARRONDI au
 * centime (la tolérance de 0,01 € d'origine ; les montants viennent d'une colonne numeric, pas de
 * dérive flottante à absorber au-delà). On indexe donc par `date|note|montant`, et une jambe se
 * cherche à la clé du montant OPPOSÉ.
 */
type TransferIndex = Map<string, TransactionWithDetails[]>;

const legKey = (date: string, cents: number) => `${date}|${cents}`;
const centsOf = (amount: number | string) => Math.round(Number(amount) * 100);

/** Regroupe les lignes SANS catégorie (seules candidates) par date + montant au centime. */
function buildTransferIndex(allTx: TransactionWithDetails[]): TransferIndex {
  const index: TransferIndex = new Map();
  for (const t of allTx) {
    if (t.category_id != null) continue;
    const key = legKey(t.date, centsOf(t.amount));
    const bucket = index.get(key);
    if (bucket) bucket.push(t); else index.set(key, [t]);
  }
  return index;
}

/** Lignes du montant OPPOSÉ, même date, sur un AUTRE compte — le vivier d'une jambe symétrique. */
function oppositeLegs(t: TransactionWithDetails, index: TransferIndex, currentAccountId: string) {
  return (index.get(legKey(t.date, -centsOf(t.amount))) ?? [])
    .filter((p) => p.id !== t.id && p.account_id !== currentAccountId);
}

/** Jambe symétrique STRICTE (même libellé) : sert à reconnaître un virement non nommé « Virement ». */
function findSymmetricTx(
  t: TransactionWithDetails,
  index: TransferIndex,
  currentAccountId: string,
): TransactionWithDetails | null {
  if (!t.note || t.category_id != null) return null;
  return oppositeLegs(t, index, currentAccountId).find((p) => p.note === t.note) ?? null;
}

function AccountDetailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const { width: screenWidth } = useWindowDimensions();
  const modalStyles = makeModalStyles(COLORS);
  const txDetailStyles = makeTxDetailStyles(COLORS);
  /** Onglet courant. « Solde » d'abord : c'est la question qu'on se pose en ouvrant un compte. */
  const [tab, setTab] = useState<AccountTab>('solde');
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(36);
  const router = useRouter();
  /* RETOUR — `router.back()` dépilait la pile NATIVE, qui n'est pas l'historique réellement suivi :
     « Nouveau solde » puis Retour revient ici en NAVIGUANT (cf. useNavBack dans solde.tsx), donc en
     empilant une seconde fois cette fiche. Le `back()` suivant redescendait alors sur « Nouveau
     solde » — on tournait en rond entre les deux écrans sans jamais remonter à la liste des
     comptes. useNavBack suit le chemin à plat (navHistory) et sort de la boucle. */
  const goBack = useNavBack();
  const params = useLocalSearchParams<{ id: string; verify?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const accountsQuery = useAllAccounts(user?.id);
  const accounts = accountsQuery.data ?? [];
  const { data: rawTransactions = [], isLoading: txLoading } = useAllTransactions(user?.id);
  // Une échéance modifiée « pour ce mois seulement » vit dans transaction_month_overrides, pas dans
  // la ligne : sans ça, la fiche du compte affichait l'ancien montant d'une transaction que la page
  // Transactions montrait déjà modifiée (même transaction, deux valeurs).
  const { data: overrides = [] } = useTransactionMonthOverrides(user?.id);
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);
  const transactions = useMemo(
    () => applyMonthOverrides(rawTransactions as TransactionWithDetails[], overrideMap),
    [rawTransactions, overrideMap],
  );
  // Échéances de crédit FUTURES : ce ne sont pas des lignes en base tant qu'elles ne sont pas échues
  // (matérialisation, migration 143) → sans elles, un prélèvement de crédit du 28 n'apparaissait
  // nulle part sur la fiche du compte. Vue COMPTE → montant RÉEL, non pondéré par le % d'impact.
  const creditFlows = useCreditFlows(user?.id, false);
  const addTransaction = useAddTransaction(user?.id);
  const updateAccount = useUpdateAccount(user?.id);

  const account = accounts.find((a) => a.id === id);

  // Compte partagé/joint : on identifie l'AUTEUR de chaque transaction (sans exposer les comptes
  // personnels des autres membres). isSharedView = joint, OU compte reçu d'un autre utilisateur.
  const isSharedView = !!(account as any)?.is_joint || (!!account && account._role !== 'owner');
  const { data: participants = [] } = useAccountParticipants(isSharedView ? id : undefined);
  const { data: acctMembers = [] } = useAccountMembers(isSharedView ? id : undefined);
  const nameByUser = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of participants) m[p.user_id] = p.display_name;
    return m;
  }, [participants]);
  const nameByMember = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mm of acctMembers) m[mm.id] = mm.display_name;
    return m;
  }, [acctMembers]);
  // #4bis — une opération « au nom de » un membre (on_behalf_member_id) est attribuée à ce membre.
  const authorOf = (t: any): string =>
    (t?.on_behalf_member_id && nameByMember[t.on_behalf_member_id]) ? nameByMember[t.on_behalf_member_id]
    // L'app TUTOIE partout : c'était « Vous », affiché sur chaque ligne d'un compte partagé.
    : (t?.profile_id === user?.id ? 'Toi' : (nameByUser[t?.profile_id] ?? 'Un membre'));

  const [showOnBehalf, setShowOnBehalf] = useState(false);
  /* Les trois saisies de la fiche (apport, plus/moins-value, intérêts) partagent UN SEUL formulaire
     — cf. components/account/AccountAmountModal. Un seul état suffit donc à dire laquelle est
     ouverte : elles s'excluent, et chacune avait sinon son propre jeu d'états recopié. */
  const [entryModal, setEntryModal] = useState<null | 'apport' | 'gainloss' | 'interest'>(null);
  const [apportBase, setApportBase] = useState('');
  const [apportBaseDirty, setApportBaseDirty] = useState(false);

  /* MISE À JOUR DU SOLDE : un seul écran dans toute l'app (app/(tabs)/comptes/solde.tsx), atteint
     ici pré-filtré sur CE compte. Cette fiche en portait une copie — une modale « Ajuster le solde »
     qui refaisait la date de référence, l'écart et la régularisation dans son coin, avec ses propres
     libellés : deux chemins pour le même geste, et deux endroits où corriger le moindre détail. */
  const openBalanceUpdate = () => {
    const origin = encodeURIComponent(`/(tabs)/comptes/${id}`);
    router.push(`/(tabs)/comptes/solde?account=${id}&origin=${origin}` as any);
  };

  // On garde l'ID, pas la ligne : une copie figée dans le state continuait d'afficher l'ancien
  // montant après une modification (le cache se rafraîchit, pas le snapshot).
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const selectedTx = useMemo(
    () => (selectedTxId ? transactions.find((t) => t.id === selectedTxId) ?? null : null),
    [transactions, selectedTxId],
  );

  // Historique paginé : on n'affiche que les N derniers mois, « Charger plus » en ajoute 3.
  // La liste n'est pas virtualisée et chaque ligne cherche sa jambe symétrique de virement dans
  // TOUTES les transactions (O(n²)) : sur un compte ancien, tout afficher d'un coup faisait ramer
  // l'écran à l'ouverture. Remis à 3 dès qu'on change de compte.
  const MONTHS_STEP = 3;
  const [monthsShown, setMonthsShown] = useState(MONTHS_STEP);
  useEffect(() => { setMonthsShown(MONTHS_STEP); }, [id]);

  /* Verrou SYNCHRONE partagé par les écritures de cet écran (apport, plus/moins-value, intérêts).
     Toutes créent une TRANSACTION : les rejouer en crée une de plus. Un drapeau d'état ne désactive
     le bouton qu'au rendu SUIVANT — cf. useSubmitLock. */
  const submitLock = useSubmitLock();
  /* Consultation admin : apport, plus-value et intérêts écrivent tous une transaction sur le compte
     visité (la politique d'accès l'autorise). On regarde, on n'écrit pas. */
  const roGuard = useReadOnlyGuard();

  /**
   * Écriture COMMUNE aux trois saisies de la fiche. Elles ne diffèrent que par le marqueur de nature
   * (`investment_kind`, migration 196) : tout le reste — verrou, lecture seule, conflit avec une
   * régularisation du même jour — se jouait à l'identique dans trois fonctions recopiées.
   * Les erreurs remontent : c'est le formulaire qui les affiche (message unique).
   */
  async function writeAccountEntry(
    op: { amount: number; date: string; note: string },
    investmentKind: 'gain' | 'loss' | 'deposit' | null,
  ) {
    if (roGuard.blocked()) throw new Error('Consultation seule.');
    if (!id || !user?.id) throw new Error('Compte introuvable.');
    if (!submitLock.acquire()) throw new Error('Enregistrement déjà en cours.');
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: op.amount,
        date: op.date,
        note: op.note,
        investment_kind: investmentKind,
        is_recurring: false,
        checkRegulConflict: true,
      });
    } finally {
      submitLock.release();
    }
  }

  // Apport à la création (capital de base) — éditable. L'apport actuel en est dérivé.
  useEffect(() => {
    if (account?.type === 'investment' && !apportBaseDirty) {
      setApportBase(account.initial_contributed != null ? String(Math.round(account.initial_contributed)) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.initial_contributed, account?.type]);

  // Apport actuel = dérivé des transactions (apports/virements − retraits au prorata).
  const apportActuel = account ? computeContributed(account, transactions as any) : null;

  async function saveApportBase() {
    if (roGuard.blocked()) return;
    if (!id) return;
    const v = parseFloat(apportBase.replace(',', '.'));
    if (Number.isNaN(v)) { Alert.alert('Montant invalide', 'Saisis un montant valide.'); return; }
    try {
      await updateAccount.mutateAsync({ id, current_contributed: v, initial_contributed: v } as any);
      setApportBaseDirty(false);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    }
  }

  /* (Le solde REMONTÉ à une date de référence vivait ici, pour la modale « Ajuster le solde ». Il
     est désormais calculé par lib/finance/balanceAt, dans l'unique écran de mise à jour du solde —
     et cette version-ci, qui soustrayait naïvement tout ce qui s'est passé depuis, ignorait les
     ancres de régularisation : dès la deuxième mise à jour, elle affichait un solde faux.) */

  const accountTransactions = useMemo(() => {
    if (!id) return [];
    const today = todayISO();
    const allTx = transactions as TransactionWithDetails[];
    // Les échéances de crédit échues sont de VRAIES lignes (matérialisation, migration 143) → elles
    // arrivent naturellement ici via useAllTransactions, comme toute transaction du compte.
    return allTx
      .filter((t) => t.account_id === id && !(t as any).is_draft && t.date <= today)
      .sort(compareTransactionsForDisplay);
  }, [id, transactions]);

  /* À VENIR CE MOIS — les opérations de ce compte datées APRÈS aujourd'hui mais encore dans le
     mois courant. L'historique s'arrête volontairement à aujourd'hui (il raconte ce qui s'est
     passé) : sans ce bloc, une échéance déjà saisie pour le 28 n'apparaissait NULLE PART sur la
     fiche du compte, alors qu'elle va bel et bien sortir. */
  const upcomingThisMonth = useMemo(() => {
    const today = todayISO();
    const monthPrefix = today.slice(0, 7);
    const year = Number(monthPrefix.slice(0, 4));
    const month = Number(monthPrefix.slice(5, 7));
    const all = ((transactions as TransactionWithDetails[]) ?? []);
    const inWindow = (d?: string | null) => !!d && d > today && d.startsWith(monthPrefix);

    // 1) Lignes RÉELLES déjà datées après aujourd'hui. Un modèle récurrent à jour en fait partie :
    //    la matérialisation l'ancre sur sa prochaine occurrence non échue.
    const rows: any[] = all.filter((t) => t.account_id === id && !(t as any).is_draft && inWindow(t.date));

    // 2) Récurrentes que la matérialisation n'a PAS avancées : `materialize_due_recurring` ne tourne
    //    que pour le propriétaire du modèle. Sur un compte JOINT, le prélèvement d'un co-titulaire
    //    qui n'a pas ouvert l'app reste ancré dans le passé → son échéance du mois n'apparaissait
    //    nulle part. On la projette, sauf si une occurrence de ce mois est déjà matérialisée.
    const materializedThisMonth = new Set(
      all.filter((t) => (t as any).materialized_from && (t.date ?? '').startsWith(monthPrefix))
        .map((t) => (t as any).materialized_from as string),
    );
    for (const t of all) {
      if (t.account_id !== id || !(t as any).is_recurring || !(t as any).recurrence_rule) continue;
      if (inWindow(t.date) || materializedThisMonth.has(t.id)) continue; // déjà couvert par une ligne réelle
      const ovr = overrideMap[overrideKey(t.id, year, month)];
      const amount = ovr?.amount != null ? Number(ovr.amount) : Number(t.amount);
      if (!amount) continue;
      for (const occ of recurrenceOccurrencesInMonth(t as any, year, month)) {
        const date = ovr?.date || occ;
        if (date <= today || !date.startsWith(monthPrefix)) continue;
        rows.push({ ...(t as any), amount, date, _virtual: true, instance_month: monthPrefix });
      }
    }

    // 3) Échéances de crédit à venir (virtuelles jusqu'à leur date, cf. useCreditFlows).
    for (const f of creditFlows) {
      if (f.account_id === id && inWindow(f.date)) rows.push({ ...f, _virtual: true });
    }

    return rows.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  }, [id, transactions, creditFlows, overrideMap]);
  const upcomingTotal = useMemo(
    () => upcomingThisMonth.reduce((sum, t) => sum + Number(t.amount), 0),
    [upcomingThisMonth],
  );
  /** Bascule « à venir » : la liste montre alors ce qui reste à passer, au lieu de l'historique. */
  const [showUpcoming, setShowUpcoming] = useState(false);

  /* ÉVOLUTION DU SOLDE — remontée à rebours depuis le solde du jour (cf. lib/balanceHistory) : la
     courbe finit donc EXACTEMENT sur le chiffre affiché juste au-dessus d'elle. */
  /* Jusqu'où l'historique chargé est-il COMPLET ? La liste des opérations est bornée à 500 lignes
     (useAllTransactions) : si on en a exactement autant, il en manque avant la plus ancienne, et
     remonter au-delà donnerait des soldes passés faux — mais crédibles. On borne donc la courbe. */
  const completeSince = useMemo(() => {
    const all = transactions as TransactionWithDetails[];
    if (all.length < TX_FETCH_LIMIT) return null;                 // rien n'a été tronqué
    return all.reduce((min, t) => (t.date < min ? t.date : min), all[0].date);
  }, [transactions]);

  const balanceHistory = useMemo(
    () => (account && id
      ? buildBalanceHistory(
          id, Number(account.balance), transactions as any, todayISO(),
          (account as any).init_date ?? null, completeSince,
        )
      : []),
    [id, account, transactions, completeSince],
  );
  /* Index des jambes de virement, construit UNE fois par jeu de transactions (cf. buildTransferIndex) :
     l'appariement se faisait ligne par ligne sur TOUTE la liste, deux fois — quadratique. */
  const transferIndex = useMemo(
    () => buildTransferIndex(transactions as TransactionWithDetails[]),
    [transactions],
  );

  /* Largeur utile de la courbe : MESURÉE sur sa carte (`onLayout` plus bas), et non déduite de la
     largeur de fenêtre.
     Le plafond de 640 px valait pour une colonne de téléphone. Sur ordinateur, la page vit dans une
     colonne de 1 180 px : la carte fait plus de 1 000 px de large, et la courbe restait plantée au
     milieu à 572 px, entourée de vide (`chartCard` la centre). Mesurer, c'est aussi suivre les
     changements que la fenêtre ne dit pas — repli de la barre latérale, redimensionnement.
     Même schéma que la courbe de trésorerie (app/(tabs)/projection.tsx).
     La valeur initiale n'est qu'un repli pour la 1ʳᵉ frame, avant la mesure. */
  const [chartWidth, setChartWidth] = useState(() => Math.max(
    220,
    (isDesktop ? Math.min(screenWidth, MAX_W.dashboard) - 2 * GUTTER : screenWidth - 40) - 28,
  ));

  // Fenêtre affichée : les `monthsShown` derniers MOIS CALENDAIRES (mois courant inclus).
  // On borne par mois plutôt que par nombre de lignes pour que « charger plus » ait un sens lisible
  // (« depuis avril 2026 ») quel que soit le rythme de saisie de l'utilisateur.
  const { visibleTransactions, hasMoreHistory, historySince } = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - (monthsShown - 1), 1);
    const cutoff = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    const visible = accountTransactions.filter((t) => (t.date ?? '') >= cutoff);
    return {
      visibleTransactions: visible,
      hasMoreHistory: visible.length < accountTransactions.length,
      historySince: from.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  }, [accountTransactions, monthsShown]);

  /* PAS ENCORE CHARGÉ ≠ INTROUVABLE. Tant que la liste des comptes est en vol, on montre la
     coquille de chargement plutôt qu'un « Chargement… » posé sur un écran nu. Et on ne conclut à
     l'absence que si la requête a RÉELLEMENT abouti : une lecture en erreur rend elle aussi une
     liste vide, en déduire « ce compte n'existe pas » serait faux. */
  if (!user || !account) {
    if (!accountsQuery.isSuccess) return <PageLoader />;
    return (
      <View style={styles.root}>
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]}>
          <ScreenHeader title="Compte" onBack={goBack} />
          <Text style={styles.text}>Ce compte n’existe plus.</Text>
        </SafeAreaView>
      </View>
    );
  }

  // Toutes les valeurs de cet écran sont dans la devise DU COMPTE (le solde et ses transactions
  // sont mono-devise). On affiche donc le symbole de la devise du compte partout ici.
  const CURRENCY_SYMBOL = currencySymbolFor((account as any).currency);

  /* ── LES ACTIONS DU COMPTE, DÉCRITES UNE FOIS ─────────────────────────────────────────────────
     C'étaient six blocs de JSX quasi identiques, qui ne différaient que par l'icône et le geste :
     la moindre retouche de forme se faisait donc six fois, et la liste réellement proposée selon le
     TYPE de compte se lisait à travers six conditions éparpillées.

     UNE SEULE COULEUR pour toute la rangée (cf. actionGradient plus bas) : une pastille par couleur
     — rouge, verte, bleue, teal — faisait une rangée bariolée qui tirait l'œil plus fort que le
     solde juste au-dessus. C'est l'icône qui distingue le geste, pas la teinte. */
  const goAdd = (type: 'expense' | 'income' | 'transfer') =>
    router.push(`/(tabs)/transactions/add?type=${type}&account=${id}&origin=${encodeURIComponent(`/(tabs)/comptes/${id}`)}` as any);

  const accountActions: { key: string; label: string; icon: string; onPress: () => void }[] = [];
  if (account.type === 'checking') {
    accountActions.push({ key: 'balance', label: 'Nouveau solde', icon: 'wallet-outline', onPress: openBalanceUpdate });
    /* DÉPENSE / RECETTE — le geste QUOTIDIEN d'un compte courant, et le seul qui manquait ici : on
       ouvrait sa fiche pour saisir une dépense, il fallait ressortir par le « + » de la barre
       d'onglets. Elles passent par l'UNIQUE écran de saisie (transactions/add), pré-réglé sur ce
       compte — pas de formulaire bis. */
    accountActions.push({ key: 'expense', label: 'Dépense', icon: 'arrow-down', onPress: () => goAdd('expense') });
    accountActions.push({ key: 'income', label: 'Recette', icon: 'arrow-up', onPress: () => goAdd('income') });
  }
  /* NOUVEAU SOLDE sur un LIVRET / UN PLACEMENT — le même écran, le même geste que sur un compte
     courant (migration 223). Il manquait, et il n'y avait aucun moyen de recoller à la réalité sans
     ressaisir a posteriori les virements oubliés — y compris sur des mois clôturés, où justement on
     ne veut plus rien toucher. L'écart écrit ici n'est pas une correction de trésorerie : il compte
     comme un virement entrant (ou sortant), cf. lib/finance/regul. */
  if (account.type === 'savings' || account.type === 'investment') {
    accountActions.push({ key: 'balance', label: 'Nouveau solde', icon: 'wallet-outline', onPress: openBalanceUpdate });
  }
  if (account.type === 'investment') {
    accountActions.push({ key: 'gainloss', label: '+/− value', icon: 'trending-up-outline', onPress: () => setEntryModal('gainloss') });
  }
  if (account.type === 'savings') {
    accountActions.push({ key: 'interest', label: 'Intérêts', icon: 'cash-outline', onPress: () => setEntryModal('interest') });
  }
  /* APPORT — jamais sur un compte COURANT. Sur un compte d'épargne ou d'investissement, un apport
     est un versement identifié (il alimente le capital investi, cf. computeContributed). Sur un
     compte courant, c'est une entrée d'argent comme une autre : « Recette » la saisit correctement,
     avec sa catégorie. La tuile y écrivait une transaction SANS catégorie — invisible du budget, et
     indiscernable d'une jambe de virement dans l'historique du compte. */
  if (account.type !== 'checking') {
    accountActions.push({ key: 'apport', label: 'Apport', icon: 'add-circle-outline', onPress: () => setEntryModal('apport') });
  }
  /* Un SEUL écran de saisie de virement dans l'app (transactions/add) — cette fiche ouvrait le
     sien, qui ne connaissait ni la clôture, ni les brouillons, ni les projets. Le compte visité
     reste le compte SOURCE pré-sélectionné. */
  accountActions.push({ key: 'transfer', label: 'Virement', icon: 'swap-horizontal', onPress: () => goAdd('transfer') });
  // #4bis — compte joint : saisir une opération « au nom de » un membre non-user (simuler sa participation).
  if (!!(account as any).is_joint && acctMembers.some((m) => !m.user_id)) {
    accountActions.push({ key: 'onbehalf', label: 'Au nom de…', icon: 'people-circle-outline', onPress: () => setShowOnBehalf(true) });
  }

  /* HABILLAGE DES RONDS — l'ENCRE du thème, donc noire en clair et blanche en sombre : une seule
     teinte pour toute la rangée, qui s'inverse avec le thème au lieu d'être choisie à la main.
     Le dégradé est celui du bouton de saisie rapide (deux arrêts en diagonale, cf. QuickAddButton) :
     assez pour donner du volume, sans reflet ni liseré — c'est ce liseré clair qui cerclait les
     ronds en mode sombre. On éclaircit le HAUT d'un rond noir, on assombrit le BAS d'un rond blanc :
     dans les deux cas la lumière vient d'en haut. */
  const actionInk = COLORS.text;
  const actionGradient: [string, string] = COLORS.mode === 'light'
    ? [lighten(actionInk, 0.24), actionInk]
    : [actionInk, darken(actionInk, 0.16)];
  /* L'icône prend le fond du thème — le négatif exact de l'encre. Fond et encre sont tous deux
     réglables côté admin : si le couple choisi ne contraste pas, on retombe sur un blanc/noir
     garanti plutôt que sur une icône fantôme. */
  const actionIconColor = contrastRatio(COLORS.bg, actionInk) >= 4.5 ? COLORS.bg : readableOn(actionInk);

  /* Taille des ronds calculée sur la largeur RÉELLE dont ils disposent — la colonne entière, la
     rangée étant posée à nu entre les deux cartes. Un diamètre en dur passait à quatre tuiles et
     débordait à cinq (compte joint) sur un petit écran. Plafond volontairement bas : ces ronds
     accompagnent le solde, ils ne doivent pas lui voler la vedette. */
  const ACTION_GAP = 8;
  const actionCell =
    (Math.min(isDesktop ? 640 : screenWidth, 640) - 40 - ACTION_GAP * (accountActions.length - 1))
    / Math.max(1, accountActions.length);
  const actionCircle = Math.round(Math.max(34, Math.min(44, actionCell - 8)));

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={[]}>
        <ScreenHeader title={account.name} onBack={goBack} />

        {/* TROIS FAÇONS DE REGARDER UN COMPTE, une seule à la fois. La fiche empilait tout —
            actions, solde, historique — et envoyait sur un AUTRE écran pour le moindre réglage.
            Les réglages sont donc devenus un onglet : plus de bouton « Modifier » en en-tête. */}
        <SegmentedControl
          options={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 12 }}
        />

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}>

        {tab === 'solde' && (<>
        {/* LE SOLDE, EN UNE LIGNE. Le libellé « Solde » au-dessus et le type en dessous encadraient
            le chiffre de deux lignes de texte pour ne rien apprendre : l'onglet dit déjà « Solde »,
            et le type tient dans une pastille à côté du montant. */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit>
              {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
            </Text>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{TYPE_LABELS[account.type] ?? account.type}</Text>
            </View>
          </View>
        </View>

        {/* LES ACTIONS, ENTRE LE CHIFFRE ET LA COURBE — et SUR LE FOND, pas dans une carte : le
            montant et la courbe sont deux blocs d'information, les boutons sont un geste. Les
            enfermer dans le même cadre que le solde les faisait lire comme une décoration de la
            carte ; à nu, ils se détachent. Masqués pour un membre en consultation (rôle read).

            FORME — un rond d'encre en dégradé, icône en négatif, libellé dessous. La version
            précédente posait une pastille PÂLE (couleur à 12 % d'opacité) dans une carte elle
            aussi pâle : à distance, la rangée se lisait comme quatre rectangles gris, pas comme
            des boutons. */}
        {account._role !== 'read' && accountActions.length > 0 && (
          <View style={[styles.actionRow, { gap: ACTION_GAP }]}>
            {accountActions.map((a) => (
              <TouchableOpacity
                key={a.key}
                style={styles.actionTile}
                onPress={a.onPress}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <LinearGradient
                  colors={actionGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.actionIcon, { width: actionCircle, height: actionCircle }]}
                >
                  <Ionicons name={a.icon as any} size={Math.round(actionCircle * 0.44)} color={actionIconColor} />
                </LinearGradient>
                {/* Deux lignes autorisées : « Nouveau solde » ne tient pas sur une seule dès qu'il y
                    a quatre tuiles, et le tronquer donnait « Nouveau… ». */}
                <Text style={styles.actionLabel} numberOfLines={2}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* L'ÉVOLUTION depuis l'ouverture, dans sa PROPRE carte sous les boutons. Un compte sans
            mouvement échu n'a pas d'histoire : on ne trace pas une ligne plate pour faire joli. */}
        {balanceHistory.length >= 2 && (
          <View style={styles.chartCard}>
            {/* Le cadre MESURE la place réellement offerte par la carte — c'est lui qui donne sa
                largeur à la courbe. `overflow: hidden` : un SVG d'une frame de retard (fenêtre
                rétrécie) est rogné plutôt que de déborder du cadre arrondi. */}
            <View
              style={styles.chartFrame}
              onLayout={(e) => {
                const w = Math.floor(e.nativeEvent.layout.width);
                // Garde anti-boucle : `onLayout` se rejoue à chaque rendu qu'il provoque lui-même.
                if (w > 0 && w !== chartWidth) setChartWidth(w);
              }}
            >
              <BalanceChart
                points={balanceHistory}
                width={chartWidth}
                color={account.type === 'investment' ? COLORS.violet : account.type === 'savings' ? COLORS.green : COLORS.blue}
              />
            </View>
            {/* La légende ne promet PAS « depuis l'ouverture » : sur un compte fourni, la courbe
                démarre au plus ancien mouvement connu (cf. completeSince). Les mois sont lisibles
                sous l'axe — inutile d'y ajouter une affirmation qu'on ne peut pas toujours tenir. */}
            <Text style={styles.chartCaption}>Évolution du solde</Text>
          </View>
        )}

        {/* Première ouverture d'un compte courant vierge → inviter à renseigner le solde à date */}
        {account.type === 'checking' && Number(account.balance) === 0 && accountTransactions.length === 0 && (
          <TouchableOpacity
            style={styles.setupBanner}
            onPress={openBalanceUpdate}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Ionicons name="information-circle" size={22} color={COLORS.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.setupBannerTitle}>Renseigne ton solde pour bien démarrer</Text>
              {/* L'app TUTOIE partout : c'était « Appuyez ici ». */}
              <Text style={styles.setupBannerText}>Appuie ici pour saisir le solde réel de ce compte à aujourd'hui.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}

        {account.type === 'investment' && (
          <View style={styles.apportCard}>
            <View style={styles.apportRow}>
              <Text style={styles.apportLabel}>Apport à la création</Text>
              {/* ⚠️ Champ réservé au PROPRIÉTAIRE. Modifier un compte passe par `useUpdateAccount`,
                  qui filtre sur `profile_id = moi` : sur un compte partagé par quelqu'un d'autre, la
                  requête ne touche aucune ligne et remonte une erreur brute de PostgREST. On offrait
                  donc un champ éditable à des participants dont la saisie ne pouvait qu'échouer.
                  Ils voient la valeur, ils ne la modifient pas. */}
              {account._role === 'owner' ? (
                <View style={styles.apportEditRow}>
                  <TextInput
                    style={styles.apportInput}
                    value={apportBase}
                    onChangeText={(v) => { setApportBase(sanitizeSignedAmountInput(v)); setApportBaseDirty(true); }}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.apportCur}>{CURRENCY_SYMBOL}</Text>
                  {apportBaseDirty && (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Valider l'apport" style={styles.apportSave} onPress={saveApportBase}>
                      <Ionicons name="checkmark" size={16} color={COLORS.onAccent} />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={styles.apportValue}>
                  {account.initial_contributed != null
                    ? `${Math.round(account.initial_contributed).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
                    : '—'}
                </Text>
              )}
            </View>
            <View style={styles.apportRow}>
              <Text style={styles.apportLabel}>Apport actuel</Text>
              <Text style={styles.apportValueRO}>
                {apportActuel != null ? apportActuel.toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL : '—'}
              </Text>
            </View>
            <Text style={styles.apportHint}>L'apport actuel (repris dans la Projection) est calculé automatiquement : apport de création + apports/virements entrants − part de capital retirée au prorata lors des retraits.</Text>
          </View>
        )}
        </>)}

        {tab === 'transactions' && (<>
        {/* À VENIR CE MOIS — même geste que sur la liste des transactions : un bouton qui bascule
            la liste sur ce qui n'est pas encore passé. Posé AU-DESSUS de l'historique, puisqu'il
            parle du futur proche et que l'historique, lui, remonte le temps. */}
        {upcomingThisMonth.length > 0 && (
          <TouchableOpacity
            style={[styles.upcomingBtn, showUpcoming && styles.upcomingBtnActive]}
            onPress={() => setShowUpcoming((v) => !v)}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={16} color={showUpcoming ? COLORS.bg : COLORS.textSecondary} />
            <Text style={[styles.upcomingLabel, showUpcoming && { color: COLORS.bg }]}>
              À venir ce mois ({upcomingThisMonth.length})
            </Text>
            <Text style={[styles.upcomingAmount, showUpcoming && { color: COLORS.bg }]}>
              {upcomingTotal > 0 ? '+' : ''}{Math.round(upcomingTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>
          {showUpcoming ? 'À venir ce mois' : 'Historique des transactions'}
        </Text>
        {txLoading ? (
          <ActivityIndicator size="small" color={COLORS.emerald} style={styles.loader} />
        ) : (showUpcoming ? upcomingThisMonth : accountTransactions).length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>
              {showUpcoming ? 'Plus rien à venir ce mois sur ce compte.' : 'Aucune transaction sur ce compte.'}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {(showUpcoming ? upcomingThisMonth : visibleTransactions).map((t, idx) => {
              const amount = Number(t.amount);
              // Ligne PROJETÉE (échéance de crédit ou récurrente pas encore matérialisée) : aucune
              // ligne réelle derrière → pas d'appariement de virement, et le détail n'a rien à ouvrir.
              const isVirtual = !!(t as any)._virtual;
              const creditId = (t as any).credit_id as string | undefined;
              const isTransfer = !isVirtual && t.category_id == null && (isTransferNote(t.note ?? null) || !!findSymmetricTx(t, transferIndex, id));
              // Compte d'en face : critère plus LARGE que l'appariement strict (le libellé des deux
              // jambes peut différer dès lors que l'une s'annonce comme un virement).
              const pair = isTransfer
                ? (oppositeLegs(t, transferIndex, id)
                    .find((p) => isTransferNote(p.note ?? null) || p.note === t.note) ?? null)
                : null;
              // Confidentialité : si le compte d'en face n'est pas accessible (compte perso d'un autre
              // membre), on n'affiche PAS son nom → libellé générique « compte de {auteur} ».
              const counterpartName = pair ? (accounts.find((a) => a.id === pair.account_id)?.name ?? null) : null;
              const otherAccountName = counterpartName ?? (isSharedView ? `compte de ${authorOf(t)}` : 'Compte');
              const label = isTransfer
                ? (isTransferNote(t.note ?? null)
                    ? (amount > 0 ? `Depuis ${otherAccountName}` : `Vers ${otherAccountName}`)
                    : (t.note?.trim() || (amount > 0 ? `Depuis ${otherAccountName}` : `Vers ${otherAccountName}`)))
                : t.note?.trim() || t.category?.name || 'Transaction';
              return (
                <TouchableOpacity
                  key={`${t.id}-${idx}`}
                  style={[styles.transferRow, idx === (showUpcoming ? upcomingThisMonth : visibleTransactions).length - 1 && styles.transferRowLast]}
                  onPress={() => {
                    // Prélèvement de crédit → sa fiche, positionnée SUR l'échéance touchée
                    // (`credit_period`) : c'est là qu'elle se corrige, pas dans l'éditeur de
                    // transaction. Sans le n° d'échéance, on atterrissait en haut d'un tableau
                    // qui peut compter des centaines de lignes.
                    if (creditId) {
                      const period = (t as any).credit_period;
                      router.push(`/(tabs)/comptes/credit/${creditId}${period != null ? `?period=${period}` : ''}` as any);
                      return;
                    }
                    if (!isVirtual) setSelectedTxId(t.id);
                  }}
                  disabled={isVirtual && !creditId}
                  activeOpacity={0.7}
                >
                  <Ionicons name={(isTransfer ? VIREMENT_ICON : iconForCategory(t.category)) as any} size={16} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                  <View style={styles.transferLeft}>
                    <Text style={styles.transferDate}>
                      {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {isSharedView && !creditId ? ` - par ${authorOf(t)}` : ''}
                    </Text>
                    <Text style={[styles.transferLabel, t.category?.name === 'Projets' && { color: COLORS.blue }]}>{label}</Text>
                    {isRegulRow(t) && (t as any).regul_target != null && (
                      <Text style={styles.regulTarget}>
                        → solde {Number((t as any).regul_target).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.transferAmount,
                      amount >= 0 ? styles.transferAmountIn : styles.transferAmountOut,
                    ]}
                  >
                    {amount >= 0 ? '+' : '−'} {Math.abs(amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Pagination de l'historique — la période affichée est nommée, pour que l'utilisateur
            sache qu'il ne manque rien : c'est masqué, pas absent. */}
        {!txLoading && !showUpcoming && accountTransactions.length > 0 && (
          <View style={styles.historyFooter}>
            <Text style={styles.historyRange}>
              {`${visibleTransactions.length} opération${visibleTransactions.length > 1 ? 's' : ''} depuis ${historySince}`}
            </Text>
            {hasMoreHistory && (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                onPress={() => setMonthsShown((m) => m + MONTHS_STEP)}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-down" size={16} color={COLORS.emerald} />
                <Text style={styles.loadMoreText}>Charger 3 mois de plus</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        </>)}

        {/* PARAMÈTRES — le même formulaire que la route « Modifier le compte », posé ici : renommer
            un compte ne fait plus changer d'écran, et seul le bouton « Enregistrer » subsiste. */}
        {tab === 'parametres' && <AccountSettingsForm account={account} />}
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* ── LES TROIS SAISIES DE LA FICHE, UN SEUL FORMULAIRE ──────────────────────────────────
          Apport, plus/moins-value et intérêts partagent la même mécanique (méthode de saisie,
          montant ou solde final, date, libellé, verrou de double envoi) : elles ne diffèrent plus
          que par ce qui est écrit ici. Cf. components/account/AccountAmountModal. */}
      <AccountAmountModal
        visible={entryModal === 'apport'}
        onClose={() => setEntryModal(null)}
        title="Apport"
        accent={COLORS.orange}
        currencySymbol={CURRENCY_SYMBOL}
        currentBalance={Number(account.balance)}
        amountLabel="Montant"
        amountHint="Versement effectué sur ce compte."
        defaultNoteFor={() => 'Apport'}
        onSubmit={(op) => writeAccountEntry(op, 'deposit')}
      />

      <AccountAmountModal
        visible={entryModal === 'gainloss'}
        onClose={() => setEntryModal(null)}
        title="Plus / moins-value"
        accent={COLORS.violet}
        currencySymbol={CURRENCY_SYMBOL}
        currentBalance={Number(account.balance)}
        withMethodPicker
        defaultMethod="balance"
        signToggle={{ positiveLabel: 'Plus-value', negativeLabel: 'Moins-value' }}
        amountHint="Plus ou moins-value à porter au compte."
        balanceHint="La plus/moins-value est calculée à partir du nouveau solde."
        defaultNoteFor={(v) => (v < 0 ? INVESTMENT_LOSS_NOTE : INVESTMENT_GAIN_NOTE)}
        /* MARQUEUR de nature (migration 196) : c'est lui qui fait foi, et non le libellé — que
           l'utilisateur peut réécrire depuis l'écran d'édition. Sans lui, renommer « Plus-value »
           en « Revalorisation T3 » sortait la ligne des plus-values et la faisait compter comme un
           APPORT : le capital investi gonflait, la performance s'effondrait, sans qu'aucun montant
           n'ait bougé. */
        onSubmit={(op) => writeAccountEntry(op, op.amount < 0 ? 'loss' : 'gain')}
      />

      <AccountAmountModal
        visible={entryModal === 'interest'}
        onClose={() => setEntryModal(null)}
        title="Intérêts"
        accent={COLORS.green}
        currencySymbol={CURRENCY_SYMBOL}
        currentBalance={Number(account.balance)}
        withMethodPicker
        defaultMethod="amount"
        amountLabel="Montant des intérêts"
        amountHint="Montant des intérêts à créditer sur le compte."
        balanceHint="Les intérêts sont calculés à partir du nouveau solde."
        defaultNoteFor={() => 'Intérêts'}
        onSubmit={(op) => writeAccountEntry(op, null)}
      />

      {/* #4bis — picker : choisir le membre non-user au nom duquel saisir l'opération sur le compte joint. */}
      <Modal visible={showOnBehalf} transparent animationType="fade" onRequestClose={() => setShowOnBehalf(false)}>
        <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => setShowOnBehalf(false)}>
          <TouchableOpacity style={modalStyles.container} activeOpacity={1} onPress={() => {}}>
            <Text style={modalStyles.title}>Saisir au nom de…</Text>
            <Text style={[modalStyles.label, { marginBottom: 12 }]}>Choisis le membre dont tu veux simuler la participation (virement, recette ou dépense sur ce compte).</Text>
            {acctMembers.filter((m) => !m.user_id).map((m) => (
              <TouchableOpacity
                key={m.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.cardBorder }}
                onPress={() => {
                  setShowOnBehalf(false);
                  router.push(`/(tabs)/transactions/add?account=${id}&on_behalf=${m.id}&on_behalf_name=${encodeURIComponent(m.display_name)}` as any);
                }}
              >
                <Ionicons name="person-circle-outline" size={22} color={COLORS.blue} />
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text }}>{m.display_name}</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Transaction detail (read-only) */}
      <Modal visible={!!selectedTx} transparent animationType="slide" onRequestClose={() => setSelectedTxId(null)}>
        <TouchableOpacity style={txDetailStyles.overlay} activeOpacity={1} onPress={() => setSelectedTxId(null)}>
          <TouchableOpacity style={[txDetailStyles.sheet, { paddingBottom: sheetPad }]} activeOpacity={1} onPress={() => {}}>
            {selectedTx && (() => {
              const amt = Number(selectedTx.amount);
              const isIncoming = amt >= 0;
              const isTransfer = selectedTx.category_id == null && (isTransferNote(selectedTx.note ?? null) || !!findSymmetricTx(selectedTx, transferIndex, id!));
              const pairTx = isTransfer
                ? oppositeLegs(selectedTx, transferIndex, id!)
                    .find((p) => isTransferNote(p.note ?? null) || p.note === selectedTx.note)
                : null;
              const otherAccName = pairTx ? (accounts.find((a) => a.id === pairTx.account_id)?.name ?? null) : null;
              // Compte d'en face inaccessible (compte perso d'un autre membre) → libellé générique.
              const otherName = otherAccName ?? (isSharedView ? `compte de ${authorOf(selectedTx)}` : null);
              const label = isTransfer
                ? (isTransferNote(selectedTx.note ?? null)
                    ? (isIncoming ? `Depuis ${otherName ?? 'Compte'}` : `Vers ${otherName ?? 'Compte'}`)
                    : (selectedTx.note?.trim() || (isIncoming ? `Depuis ${otherName ?? 'Compte'}` : `Vers ${otherName ?? 'Compte'}`)))
                : selectedTx.note?.trim() || selectedTx.category?.name || 'Transaction';

              const linkedAccountId = (selectedTx as any).linked_account_id as string | null;
              const linkedAccount = linkedAccountId ? accounts.find((a) => a.id === linkedAccountId) : null;
              const isVirement = isTransfer || !!linkedAccount;

              // Marqueur d'abord, libellé en repli (cf. lib/finance/investment).
              const isGainLoss = isInvestmentGainLoss(selectedTx);
              const isApport = selectedTx.note === 'Apport' || selectedTx.category?.name === 'Apport' ||
                (selectedTx.note?.toLowerCase().includes('apport') ?? false);
              const txType = isVirement
                ? 'Virement'
                : isGainLoss
                  ? '+/- value'
                  : amt > 0
                    ? (isApport ? 'Apport' : 'Recette')
                    : (selectedTx.note?.toLowerCase().includes('régularisation') ? 'Régularisation' : 'Dépense');

              const rows: { key: string; value: string }[] = [
                { key: 'Type', value: txType },
                { key: 'Date', value: new Date(selectedTx.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
                { key: 'Montant', value: `${isIncoming ? '+' : '−'} ${Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL}` },
              ];
              // Sur un compte partagé/joint : qui a saisi cette transaction.
              if (isSharedView) rows.push({ key: 'Par', value: authorOf(selectedTx) });
              if (isVirement) {
                const srcName = isIncoming ? (linkedAccount?.name ?? otherName ?? '—') : (account?.name ?? '—');
                const dstName = isIncoming ? (account?.name ?? '—') : (linkedAccount?.name ?? otherName ?? '—');
                rows.push({ key: 'Compte source', value: srcName });
                rows.push({ key: 'Compte destination', value: dstName });
              } else {
                rows.push({ key: 'Compte', value: account?.name ?? '' });
              }
              if (selectedTx.category?.name) rows.push({ key: 'Catégorie', value: selectedTx.category.name });

              return (
                <>
                  <View style={txDetailStyles.handle} />
                  <Text style={txDetailStyles.amount(isIncoming)}>
                    {isIncoming ? '+' : '−'} {Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                  <Text style={txDetailStyles.labelText}>{label}</Text>
                  <View style={txDetailStyles.divider} />
                  {rows.map((r) => (
                    <View key={r.key} style={txDetailStyles.row}>
                      <Text style={txDetailStyles.rowKey}>{r.key}</Text>
                      <Text style={txDetailStyles.rowValue}>{r.value}</Text>
                    </View>
                  ))}
                  <View style={txDetailStyles.btnRow}>
                    <TouchableOpacity style={txDetailStyles.closeBtn} onPress={() => setSelectedTxId(null)}>
                      <Text style={txDetailStyles.closeBtnText}>Fermer</Text>
                    </TouchableOpacity>
                    {account?._role !== 'read' && (
                      <TouchableOpacity
                        style={txDetailStyles.editBtn}
                        onPress={() => {
                          const tx = selectedTx!;
                          setSelectedTxId(null);
                          // Même geste que depuis Transactions / Pilotage : sur une échéance
                          // récurrente on passe le mois de l'occurrence, sinon l'éditeur modifiait
                          // toute la SÉRIE alors que la même ligne, ouverte depuis Transactions,
                          // ne modifiait que cette échéance.
                          const instance = (tx as any).instance_month as string | undefined;
                          const origin = `origin=${encodeURIComponent(`/comptes/${id}`)}`;
                          const route = instance
                            ? `/(tabs)/transactions/edit/${tx.id}?instanceDate=${instance}&${origin}`
                            : `/(tabs)/transactions/edit/${tx.id}?${origin}`;
                          router.push(route as any);
                        }}
                      >
                        <Ionicons name="pencil" size={16} color={COLORS.emerald} />
                        <Text style={txDetailStyles.editBtnText}>Modifier</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  scrollContent: { paddingTop: 4 },

  // Onglets (Solde / Transactions / Paramètres) : `components/ui/SegmentedControl`. Le style vivait
  // ici en trois copies divergentes dans l'app — il n'en existe plus qu'une.

  balanceCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
  },
  /* La courbe a sa PROPRE carte : les boutons se sont intercalés entre elle et le montant, à nu
     sur le fond. Même habillage que la carte du solde — deux blocs jumeaux séparés par un geste. */
  chartCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  /* Cadre de mesure de la courbe : pleine largeur de la carte, c'est lui qu'on mesure (cf. le
     `onLayout` de l'écran). Sans lui, `alignItems: 'center'` de la carte réduisait chaque enfant à
     sa largeur intrinsèque — donc rien à mesurer. */
  chartFrame: { width: '100%', alignItems: 'center', overflow: 'hidden' },
  // Montant et type sur UNE ligne : plus de libellé au-dessus ni de type en dessous.
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceAmount: { flex: 1, minWidth: 0, fontSize: 27, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
  typePill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.cardSolid,
  },
  typePillText: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
  chartCaption: { fontSize: 10.5, color: c.textSecondary, marginTop: 2, textAlign: 'center' },

  // ── Actions du compte : colonnes de largeur ÉGALE (rond dégradé + libellé), posées À NU entre la
  //    carte du solde et celle de la courbe. Les cellules restent égales — une rangée de pilules de
  //    largeurs différentes se cassait en lignes bancales — mais la carte-par-bouton a disparu :
  //    le rond porte seul le bouton. Diamètre et gouttière sont calculés au rendu. ──
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  actionTile: {
    flex: 1, alignItems: 'center', gap: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  actionIcon: {
    borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    // `overflow` : le dégradé suit l'arrondi du rond au lieu d'en déborder (Android).
    overflow: 'hidden',
    /* Ombre neutre et DISCRÈTE. Pas de liseré clair sur le pourtour : il cerclait les ronds d'un
       trait blanc en mode sombre. En sombre les ronds sont clairs, l'ombre noire ne se voit pas —
       c'est voulu, le contraste avec le fond suffit à les détacher. */
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  actionLabel: { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center', lineHeight: 13.5 },
  setupBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.blue + '14', borderWidth: 1, borderColor: c.blue + '55', borderRadius: 14, padding: 14, marginBottom: 24, marginTop: -8 },
  setupBannerTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  setupBannerText: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  apportCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 24 },
  apportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  apportLabel: { fontSize: 13, color: c.textSecondary },
  apportValueRO: { fontSize: 15, fontWeight: '700', color: c.text },
  apportEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apportInput: { minWidth: 90, textAlign: 'right', fontSize: 15, fontWeight: '700', color: c.text, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  apportCur: { fontSize: 14, color: c.textSecondary },
  // Valeur en lecture seule (participant non propriétaire) : même poids visuel que le champ éditable.
  apportValue: { fontSize: 15, fontWeight: '700', color: c.text },
  apportSave: { width: 30, height: 30, borderRadius: 8, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  apportHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textSecondary, marginBottom: 12 },

  // Bascule « À venir ce mois » : discrète quand elle dort, pleine quand elle filtre.
  upcomingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  upcomingBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  upcomingLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
  upcomingAmount: { fontSize: 13.5, fontWeight: '800', color: c.textSecondary },
  loader: { marginVertical: 20 },
  emptyCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 14, color: c.textSecondary, marginTop: 12 },
  listCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 16,
    overflow: 'hidden',
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
  transferRowLast: { borderBottomWidth: 0 },
  transferLeft: { flex: 1 },
  transferDate: { fontSize: 13, color: c.textSecondary, marginBottom: 2 },
  transferLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  regulTarget: { fontSize: 12, color: c.emerald, fontWeight: '600', marginTop: 1 },
  transferAmount: { fontSize: 15, fontWeight: '700' },
  transferAmountIn: { color: c.green },
  transferAmountOut: { color: c.text },
  // Pied de l'historique : période affichée + « Charger 3 mois de plus ».
  historyFooter: { alignItems: 'center', gap: 10, marginTop: -4, marginBottom: 16 },
  historyRange: { fontSize: 12, color: c.textSecondary, textAlign: 'center' },
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: c.emerald },
  text: { color: c.text },
});
}

/** Modale « Saisir au nom de… » — la seule qui reste ici : les trois saisies de montant ont leur
 *  propre formulaire partagé (components/account/AccountAmountModal). */
function makeModalStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    container: {
      width: '100%', maxWidth: 380, backgroundColor: c.cardSolid,
      borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 24,
    },
    title: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 20, textAlign: 'center' },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  });
}

function makeTxDetailStyles(c: any) {
  return {
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
    sheet: { ...sheetWidth, backgroundColor: c.cardSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder },
    handle: { width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center' as const, marginBottom: 20 },
    amount: (isIn: boolean) => ({ fontSize: 32, fontWeight: '700' as const, color: isIn ? c.green : c.text, textAlign: 'center' as const, marginBottom: 4 }),
    labelText: { fontSize: 16, color: c.textSecondary, textAlign: 'center' as const, marginBottom: 20 },
    divider: { height: 1, backgroundColor: c.cardBorder, marginBottom: 16 },
    row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    rowKey: { fontSize: 14, color: c.textSecondary },
    rowValue: { fontSize: 14, color: c.text, fontWeight: '500' as const, flexShrink: 1, textAlign: 'right' as const, marginLeft: 16 },
    closeBtn: { flex: 1, backgroundColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' as const },
    closeBtnText: { fontSize: 15, fontWeight: '600' as const, color: c.text },
    btnRow: { flexDirection: 'row' as const, gap: 10, marginTop: 24 },
    editBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: c.green + '44' },
    editBtnText: { fontSize: 15, fontWeight: '600' as const, color: c.green },
  };
}

/* OUVERTURE INSTANTANÉE : la page s'affiche en silhouette le temps que son corps (hooks,
   calculs, listes) se monte — sinon le tap reste sans effet visible pendant tout le montage.
   Cf. hooks/useDeferredMount. */
export default withDeferredMount(AccountDetailScreen);
