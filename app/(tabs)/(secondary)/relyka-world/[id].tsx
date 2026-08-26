/**
 * Relyka World — détail d'un projet partagé.
 * Onglets « Dépenses » et « Équilibres ». Ajout de dépense, invitation de participants.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import CurrencyPicker from '../../../../components/account/CurrencyPicker';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { currencySymbolFor, convertAmount } from '../../../../lib/finance/currency';
import { useCurrencyRates } from '../../../../hooks/data/useCurrencyRates';
import { sheetWidth, useSheetBottomPadding } from '../../../../lib/ui/appLayout';
import { todayISO } from '../../../../lib/dateUtils';
import KeyboardAwareOverlay from '../../../../components/layout/KeyboardAwareOverlay';
import { useAccounts } from '../../../../hooks/data/useAccounts';
import { useCategories } from '../../../../hooks/data/useCategories';
import {
  useRwProject, useRwExpenses, useRwInviteByCode, useAddRwParticipant, useDeleteRwExpense,
  useDeleteRwProject, useSetRwProjectArchived, useUpdateRwProject, useRwRealtime,
  useUpdateRwParticipant, useRwReinviteParticipant, useRemoveRwParticipant, useRwCancelInvitation,
  useRwBulkReassignAccount, useRwMergeParticipant, countParticipantRefs, countParticipantRealTx,
  computeBalances, settleUp, paidByParticipant, type RwExpense, type RwParticipant,
} from '../../../../hooks/engagement/useRelykaWorld';

const PROJ_EMOJIS = ['💸', '🏖️', '✈️', '🍽️', '🎉', '🏠', '🚗', '⛰️', '🛒', '🎲'];

/** Montant dans une devise donnée. Toujours explicite ici : ce projet en manipule deux. */
const fmtIn = (n: number, currency: string) =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbolFor(currency)}`;

export default function RelykaWorldDetail() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(36);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;

  useRwRealtime(projectId);
  const { data: projData, isLoading } = useRwProject(projectId);
  const { data: expData } = useRwExpenses(projectId);
  const inviteByCode = useRwInviteByCode(projectId);
  const addParticipant = useAddRwParticipant(projectId);
  const updateParticipant = useUpdateRwParticipant(projectId);
  const reinviteParticipant = useRwReinviteParticipant(projectId);
  const removeParticipant = useRemoveRwParticipant(projectId);
  const cancelInvitation = useRwCancelInvitation(projectId);
  const bulkReassign = useRwBulkReassignAccount(projectId, user?.id);
  const deleteProject = useDeleteRwProject(user?.id);
  const setArchived = useSetRwProjectArchived(user?.id);
  const updateProject = useUpdateRwProject(projectId);
  const { data: myAccounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const projetsCategoryId = useMemo(
    () => (categories as any[]).find((c) => c.name === 'Projets' && c.type === 'expense')?.id ?? null,
    [categories],
  );
  const checkingAccounts = useMemo(() => myAccounts.filter((a: any) => a.type === 'checking'), [myAccounts]);

  const project = projData?.project;
  const participants = projData?.participants ?? [];
  const expenses = expData?.expenses ?? [];
  const shares = expData?.shares ?? [];
  const expenseAccounts = expData?.accounts ?? [];
  const payers = expData?.payers ?? [];
  const isOwner = project?.owner_id === user?.id;
  const isArchived = !!project?.archived_at;
  // On ne connaît la réponse qu'une fois les dépenses chargées : tant qu'elles ne le sont pas,
  // on n'affiche PAS « Supprimer » (évite toute suppression dans la fenêtre de chargement).
  const expensesReady = expData !== undefined;
  // Une dépense a impacté un VRAI compte dès qu'elle est payée via un compte (account_id) ET échue
  // (date ≤ aujourd'hui). Visible pour tous les payeurs (RLS). Si ≥1 → suppression interdite.
  const hasPostedRealTx = useMemo(() => {
    const today = todayISO();
    const splitByExpense = new Set(expenseAccounts.map((a) => a.expense_id));
    return expenses.some((e) => (e.account_id != null || splitByExpense.has(e.id)) && e.date <= today);
  }, [expenses, expenseAccounts]);

  const [tab, setTab] = useState<'expenses' | 'balances' | 'accounts'>('expenses');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [freeName, setFreeName] = useState('');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEmoji, setEditEmoji] = useState('💸');
  const [editCurrency, setEditCurrency] = useState('EUR');
  const openEdit = () => {
    setEditName(project?.name ?? ''); setEditDesc(project?.description ?? '');
    setEditEmoji(project?.emoji || '💸'); setEditCurrency(project?.currency || 'EUR');
    setShowEdit(true);
  };
  const saveEdit = async () => {
    if (!editName.trim()) return;
    /* Changer la devise du projet est SANS DANGER : elle ne dit que dans quelle monnaie se LISENT
       ses totaux. Aucune dépense n'est réécrite — chacune garde la devise dans laquelle elle a été
       réellement payée, et c'est l'affichage qui convertit. D'où l'édition permise à tout moment,
       même sur un projet déjà bien avancé. */
    /* Sans garde, un échec d'écriture remontait en rejet non traité : la modale restait ouverte,
       le bouton redevenait actif, et rien ne disait pourquoi le nom n'avait pas changé. */
    try {
      await updateProject.mutateAsync({
        name: editName.trim(), description: editDesc.trim(), emoji: editEmoji, currency: editCurrency,
      });
      setShowEdit(false);
    } catch (e: any) {
      Alert.alert('Un souci', e?.message ?? "Le projet n'a pas pu être modifié. Vérifie ta connexion, puis réessaie.");
    }
  };

  const nameOf = (pid: string) => participants.find((p) => p.id === pid)?.display_name ?? '?';
  const myParticipantId = participants.find((p) => p.user_id === user?.id)?.id;

  /** Ce que J'AI avancé sur une dépense (0 si je n'en suis pas payeur) — cf. migration 184. */
  const myPaidOn = useCallback((e: RwExpense): number => {
    if (!myParticipantId) return 0;
    return paidByParticipant(e, payers)
      .filter((p) => p.participant_id === myParticipantId)
      .reduce((s, p) => s + p.amount, 0);
  }, [payers, myParticipantId]);

  /* ── DEVISES ────────────────────────────────────────────────────────────────────────────────
     Le PROJET a une devise (migration 195) : c'est celle de tous ses TOTAUX — total du projet, ma
     part, mes avances, les soldes « qui doit quoi ». Chaque DÉPENSE, elle, est libellée dans la
     devise où elle a été payée (celle du compte utilisé, ou celle du projet en cash).
     On affiche donc chaque dépense dans SA devise, et on convertit dès qu'on additionne. */
  const projectCurrency = project?.currency || 'EUR';
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  /** Montant d'une dépense (ou d'une de ses lignes) ramené dans la devise du projet. */
  const toProject = useCallback(
    (amount: number, e: { currency?: string | null }) =>
      convertAmount(amount, e.currency || projectCurrency, projectCurrency, rates) ?? amount,
    [projectCurrency, rates],
  );
  /** Total en devise du projet — le format par défaut de cet écran. */
  const fmt = useCallback((n: number) => fmtIn(n, projectCurrency), [projectCurrency]);

  const total = useMemo(() => expenses.reduce((s, e) => s + toProject(e.amount, e), 0), [expenses, toProject]);
  // Ma part = somme de mes quotes-parts (ce que je dois payer au final), converties.
  const expenseById = useMemo(() => new Map(expenses.map((e) => [e.id, e])), [expenses]);
  const myShare = useMemo(
    () => shares
      .filter((s) => s.participant_id === myParticipantId)
      .reduce((sum, s) => {
        const e = expenseById.get(s.expense_id);
        return sum + (e ? toProject(s.amount, e) : s.amount);
      }, 0),
    [shares, myParticipantId, expenseById, toProject],
  );
  // Somme de MES avances (une dépense réglée à deux ne compte que pour ma part) — cf. migration 184.
  const myPaid = useMemo(() => expenses.reduce((sum, e) => sum + toProject(myPaidOn(e), e), 0), [expenses, myPaidOn, toProject]);

  const balances = useMemo(
    () => computeBalances(participants, expenses, shares, payers, toProject),
    [participants, expenses, shares, payers, toProject],
  );
  const settlements = useMemo(() => settleUp(participants.map((p) => ({ id: p.id, amount: balances.get(p.id) ?? 0 }))), [participants, balances]);
  const myBalance = myParticipantId ? (balances.get(myParticipantId) ?? 0) : 0;

  // Dépenses groupées par date. L'ORDRE vient de la requête (date d'événement décroissante, puis
  // instant de saisie) : `Map` conserve l'ordre d'insertion, donc il traverse intact ce regroupement.
  const grouped = useMemo(() => {
    const m = new Map<string, RwExpense[]>();
    for (const e of expenses) { const k = e.date; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()];
  }, [expenses]);

  /* ── MES dépenses, rangées PAR COMPTE ────────────────────────────────────────────────────────
     Le geste de fin de projet : on a tout saisi au fil de l'eau, souvent en « cash » ou sur le
     compte proposé par défaut, et on veut vérifier — puis corriger d'un coup — ce qui a réellement
     impacté chaque compte. La clé `cash` regroupe ce qui n'a touché aucun compte.
     On ne montre QUE ses propres dépenses : le compte d'un autre participant ne nous regarde pas
     (et on ne pourrait de toute façon pas le modifier). */
  const myAccountName = (id: string) => (myAccounts as any[]).find((a) => a.id === id)?.name ?? 'Compte';
  /* Devise d'un regroupement de l'onglet « Par compte ». Un compte est MONO-DEVISE : son total est
     donc dans SA devise, et non dans celle du projet — c'est ce qui doit correspondre au relevé
     bancaire. La colonne « cash » n'a pas de compte : elle se lit en devise du projet. */
  const bucketCurrency = useCallback(
    (key: string) => (key === 'cash'
      ? projectCurrency
      : ((myAccounts as any[]).find((a) => a.id === key)?.currency || projectCurrency)),
    [myAccounts, projectCurrency],
  );


  const byAccount = useMemo(() => {
    const m = new Map<string, { rows: Array<{ expense: RwExpense; myAmount: number }>; total: number }>();
    const push = (key: string, e: RwExpense, amount: number, myAmount: number) => {
      const cur = m.get(key) ?? { rows: [], total: 0 };
      if (!cur.rows.some((x) => x.expense.id === e.id)) cur.rows.push({ expense: e, myAmount });
      /* Le total d'un regroupement se lit dans la devise de CE compte. La dépense y est déjà, sauf
         pour d'anciennes lignes saisies avant que la devise soit portée par la dépense — on les
         ramène plutôt que de les additionner à l'aveugle. */
      const target = bucketCurrency(key);
      cur.total += convertAmount(amount, e.currency || target, target, rates) ?? amount;
      m.set(key, cur);
    };
    for (const e of expenses) {
      /* ── CE QUE MOI J'AI SORTI DE MA POCHE, ET RIEN D'AUTRE ────────────────────────────────
         Le filtre portait sur `created_by` — c'est-à-dire sur qui a SAISI la dépense, pas sur qui
         l'a payée. Saisir la note d'un ami faisait donc apparaître SON règlement dans mon relevé
         par compte, et le proposait au changement en masse. Le bon critère est le paiement : je
         suis payeur, et seulement à hauteur de ce que j'ai avancé (une dépense réglée à deux ne
         me concerne que pour ma part). */
      const mine = myPaidOn(e);
      if (mine <= 0) continue;
      // Mes lignes de comptes uniquement : celles d'un autre payeur ne me regardent pas.
      const lines = expenseAccounts.filter((a) => a.expense_id === e.id && a.created_by === user?.id);
      if (lines.length === 0) {
        // Aucune répartition : soit la colonne historique (une dépense = un compte), soit du cash.
        push(e.created_by === user?.id ? (e.account_id ?? 'cash') : 'cash', e, mine, mine);
        continue;
      }
      for (const l of lines) push(l.account_id, e, l.amount, mine);
      const covered = lines.reduce((s, l) => s + l.amount, 0);
      if (mine - covered > 0.02) push('cash', e, mine - covered, mine);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
    // `bucketCurrency`/`rates` : les comptes et les taux arrivent après le premier rendu.
  }, [expenses, expenseAccounts, payers, myPaidOn, user?.id, myAccounts, bucketCurrency, rates]);

  /** Reventilation en masse : compte source sélectionné, puis compte cible. */
  const [reassignFrom, setReassignFrom] = useState<string | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  /* Devise du regroupement qu'on déplace, et comptes éligibles : la reventilation recrée les
     transactions « pour le même montant », ce qui n'a de sens qu'entre comptes de MÊME devise. */
  const reassignCurrency = reassignFrom ? bucketCurrency(reassignFrom) : projectCurrency;
  const reassignTargets = useMemo(
    () => (checkingAccounts as any[]).filter((a) => a.id !== reassignFrom && (a.currency || projectCurrency) === reassignCurrency),
    [checkingAccounts, reassignFrom, reassignCurrency, projectCurrency],
  );
  const reassignHiddenCount = (checkingAccounts as any[]).filter((a) => a.id !== reassignFrom).length - reassignTargets.length;
  const runReassign = async (toAccountId: string | null) => {
    if (!reassignFrom) return;
    const group = byAccount.find(([k]) => k === reassignFrom);
    if (!group) { setReassignFrom(null); return; }
    setReassignBusy(true);
    try {
      await bulkReassign.mutateAsync({
        expenses: group[1].rows,
        toAccountId,
        projectName: project?.name ?? 'Projet',
        categoryId: projetsCategoryId,
      });
      setReassignFrom(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de déplacer ces dépenses.');
    } finally { setReassignBusy(false); }
  };

  // ── Retrait d'un participant (avec repreneur si besoin) ──
  const [removing, setRemoving] = useState<RwParticipant | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  /* DOUBLE CONFIRMATION. Retirer quelqu'un touche les équilibres de TOUS les participants et n'a
     pas d'annulation : le repreneur hérite des dépenses avancées et des quotes-parts, et rien ne
     permet de revenir en arrière d'un tap. Le choix du repreneur ne suffit donc pas — il se fait
     dans une liste, du bout du doigt. On redemande, en nommant les deux personnes et ce qui bouge. */
  const [removePending, setRemovePending] = useState<{ reassignTo: string | null } | null>(null);
  const removeRefs = removing ? countParticipantRefs(removing.id, expenses, shares, payers) : 0;
  /* Dépenses de cette personne qui ont touché un VRAI compte : on ne peut ni les réattribuer, ni la
     retirer tant qu'elles existent (cf. migration 185). Le message le dit AVANT le geste plutôt que
     de laisser le serveur refuser après coup. */
  const removeRealTx = removing ? countParticipantRealTx(removing.id, expenses, payers, expenseAccounts, user?.id) : 0;
  const runRemove = async (reassignTo: string | null) => {
    if (!removing) return;
    setRemoveBusy(true); setRemoveErr(null);
    try {
      await removeParticipant.mutateAsync({ participantId: removing.id, reassignTo });
      setRemoving(null); setRemovePending(null);
    } catch (e: any) { setRemoveErr(e?.message ?? 'Retrait impossible.'); setRemovePending(null); }
    finally { setRemoveBusy(false); }
  };

  /* ── FUSIONNER DEUX LIGNES QUI SONT LA MÊME PERSONNE ──────────────────────────────────────
     Un participant non inscrit peut se retrouver à côté du compte Relyka de la même personne (ce
     que les défauts d'invitation ont produit), chacun portant une partie des dépenses. Retirer avec
     repreneur n'est pas le bon geste : ce serait donner l'argent de l'un à l'autre, et le garde-fou
     le refuse à juste titre. Fusionner dit autre chose — ces deux lignes n'ont jamais désigné qu'une
     personne — et ne touche à AUCUNE transaction. */
  const [merging, setMerging] = useState<RwParticipant | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState<string | null>(null);
  const mergeParticipant = useRwMergeParticipant(projectId);
  const runMerge = async (into: string) => {
    if (!merging) return;
    setMergeBusy(true); setMergeErr(null);
    try {
      await mergeParticipant.mutateAsync({ from: merging.id, into });
      setMerging(null);
    } catch (e: any) { setMergeErr(e?.message ?? 'Fusion impossible.'); }
    finally { setMergeBusy(false); }
  };

  const onInviteByCode = async () => {
    if (!inviteCode.trim()) return;
    setInviteBusy(true); setInviteErr(null);
    try {
      await inviteByCode.mutateAsync({ code: inviteCode.trim(), name: '' });
      setInviteCode(''); setShowInvite(false);
    } catch (e: any) { setInviteErr(e?.message ?? 'Invitation impossible.'); }
    finally { setInviteBusy(false); }
  };
  const onAddFreeName = async () => {
    if (!freeName.trim()) return;
    try {
      await addParticipant.mutateAsync(freeName.trim());
      setFreeName('');
    } catch (e: any) {
      Alert.alert('Un souci', e?.message ?? "Ce participant n'a pas pu être ajouté.");
    }
  };

  // ── Édition d'un participant NON INSCRIT (renommer + inviter par ID pour qu'il prenne sa place) ──
  const [editPart, setEditPart] = useState<RwParticipant | null>(null);
  const [partName, setPartName] = useState('');
  const [partCode, setPartCode] = useState('');
  const [partErr, setPartErr] = useState<string | null>(null);
  const [partBusy, setPartBusy] = useState(false);
  const openPartEdit = (p: RwParticipant) => {
    setEditPart(p); setPartName(p.display_name); setPartCode(''); setPartErr(null); setShowInvite(false);
  };
  const savePartName = async () => {
    if (!editPart || !partName.trim() || partName.trim() === editPart.display_name) return;
    setPartBusy(true); setPartErr(null);
    try {
      await updateParticipant.mutateAsync({ participantId: editPart.id, name: partName.trim() });
      setEditPart(null);
    } catch (e: any) { setPartErr(e?.message ?? 'Renommage impossible.'); }
    finally { setPartBusy(false); }
  };
  const reinvitePart = async () => {
    if (!editPart || !partCode.trim()) return;
    setPartBusy(true); setPartErr(null);
    try {
      // Renomme d'abord si l'utilisateur a aussi modifié le nom, puis envoie l'invitation.
      if (partName.trim() && partName.trim() !== editPart.display_name) {
        await updateParticipant.mutateAsync({ participantId: editPart.id, name: partName.trim() });
      }
      await reinviteParticipant.mutateAsync({ participantId: editPart.id, code: partCode.trim() });
      setEditPart(null);
    } catch (e: any) { setPartErr(e?.message ?? 'Invitation impossible.'); }
    finally { setPartBusy(false); }
  };

  const confirmDeleteProject = () => {
    const msg = hasPostedRealTx
      ? 'Le projet et ses dépenses sont supprimés pour tous les participants. Les transactions déjà passées (qui ont impacté un compte) sont conservées et deviennent de simples dépenses/recettes chez chaque participant. Seules les transactions non encore passées sont retirées (le solde est rétabli).'
      : 'Le projet et ses dépenses seront supprimés pour tous les participants (aucune dépense n\'a encore impacté de compte).';
    Alert.alert('Supprimer le projet', msg, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { try { await deleteProject.mutateAsync(projectId!); goBack(); } catch (e: any) { Alert.alert('Un souci', e?.message ?? "Le projet n'a pas pu être supprimé."); } } },
    ]);
  };

  const onToggleArchive = () => {
    if (isArchived) {
      setArchived.mutate({ projectId: projectId!, archived: false }, { onError: (e: any) => Alert.alert('Un souci', e?.message ?? "Le projet n'a pas pu être désarchivé.") });
      return;
    }
    Alert.alert('Archiver le projet', 'Le projet sera masqué de la liste active mais conservé tel quel (dépenses, transactions et historique intacts). Tu pourras le désarchiver à tout moment.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Archiver', onPress: async () => { try { await setArchived.mutateAsync({ projectId: projectId!, archived: true }); goBack(); } catch (e: any) { Alert.alert('Un souci', e?.message ?? "Le projet n'a pas pu être archivé."); } } },
    ]);
  };

  if (isLoading) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={[]}><ScreenHeader title="Projet" onBack={goBack} /><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }
  if (!project) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={[]}><ScreenHeader title="Projet" onBack={goBack} /><Text style={styles.empty}>Projet introuvable.</Text></SafeAreaView></View>;
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={[]}>
        <ScreenHeader title={`${project.emoji || '💸'} ${project.name}`} onBack={goBack} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Inviter */}
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(true)} activeOpacity={0.85}>
              <Ionicons name="person-add-outline" size={16} color="#3b82f6" />
              <Text style={styles.inviteBtnText}>Inviter / participants ({participants.length})</Text>
            </TouchableOpacity>
            {isOwner && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Modifier" style={styles.editProjBtn} onPress={openEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="create-outline" size={18} color={COLORS.text} />
              </TouchableOpacity>
            )}
          </View>

          {/* Actions propriétaire : archiver (toujours) + supprimer (seulement si aucune dépense
              n'a encore impacté un compte réel). Boutons clairs et libellés. */}
          {isOwner && (
            <>
              {isArchived && (
                <View style={styles.archivedBadge}>
                  <Ionicons name="archive" size={14} color="#f59e0b" />
                  <Text style={styles.archivedBadgeText}>Projet archivé</Text>
                </View>
              )}
              <View style={styles.ownerActionsRow}>
                <TouchableOpacity style={styles.archiveActionBtn} onPress={onToggleArchive} activeOpacity={0.85} disabled={setArchived.isPending}>
                  <Ionicons name={isArchived ? 'folder-open-outline' : 'archive-outline'} size={16} color="#f59e0b" />
                  <Text style={styles.archiveActionText}>{isArchived ? 'Désarchiver' : 'Archiver'}</Text>
                </TouchableOpacity>
                {!isArchived && expensesReady && (
                  <TouchableOpacity style={styles.deleteActionBtn} onPress={confirmDeleteProject} activeOpacity={0.85} disabled={deleteProject.isPending}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    <Text style={styles.deleteActionText}>Supprimer</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!isArchived && hasPostedRealTx && (
                <Text style={styles.archiveHint}>
                  À la suppression, les dépenses déjà passées sont conservées chez chaque participant (elles deviennent de simples transactions). L'archivage garde tout le projet intact.
                </Text>
              )}
            </>
          )}

          {/* Onglets */}
          <View style={styles.tabs}>
            <TouchableOpacity style={[styles.tab, tab === 'expenses' && styles.tabActive]} onPress={() => setTab('expenses')}>
              <Text style={[styles.tabText, tab === 'expenses' && styles.tabTextActive]}>Dépenses</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'balances' && styles.tabActive]} onPress={() => setTab('balances')}>
              <Text style={[styles.tabText, tab === 'balances' && styles.tabTextActive]}>Équilibres</Text>
            </TouchableOpacity>
            {/* « Par compte » : la vue de fin de projet — ce que chaque compte a réellement encaissé,
                et de quoi tout basculer d'un coup sur le bon. */}
            <TouchableOpacity style={[styles.tab, tab === 'accounts' && styles.tabActive]} onPress={() => setTab('accounts')}>
              <Text style={[styles.tabText, tab === 'accounts' && styles.tabTextActive]}>Par compte</Text>
            </TouchableOpacity>
          </View>

          {tab === 'accounts' ? (
            <>
              <Text style={styles.accHint}>
                Tes dépenses de ce projet, rangées par compte réellement impacté. Tu peux tout
                basculer d'un compte à l'autre en une fois — pratique au retour, pour que ces
                dépenses tombent enfin au bon endroit.
              </Text>
              {byAccount.length === 0 ? (
                <Text style={styles.empty}>Tu n'as encore saisi aucune dépense sur ce projet.</Text>
              ) : byAccount.map(([key, g]) => (
                <View key={key} style={styles.accCard}>
                  <View style={styles.accHead}>
                    <Ionicons name={key === 'cash' ? 'cash-outline' : 'card-outline'} size={17} color={key === 'cash' ? COLORS.textSecondary : COLORS.blue} />
                    <Text style={styles.accName} numberOfLines={1}>{key === 'cash' ? 'Cash (aucun compte impacté)' : myAccountName(key)}</Text>
                    {/* Total dans la devise du COMPTE : c'est ce qui doit correspondre au relevé. */}
                    <Text style={styles.accTotal}>{fmtIn(g.total, bucketCurrency(key))}</Text>
                  </View>
                  <Text style={styles.accCount}>{g.rows.length} dépense{g.rows.length > 1 ? 's' : ''}</Text>
                  {g.rows.slice(0, 4).map(({ expense: e }) => (
                    <TouchableOpacity key={e.id} style={styles.accLine} activeOpacity={0.75}
                      onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/add-expense?projectId=${projectId}&expenseId=${e.id}` as any)}>
                      <Text style={styles.accLineText} numberOfLines={1}>{e.emoji || '🧾'} {e.title || 'Dépense'}</Text>
                      <Text style={styles.accLineAmount}>{fmtIn(e.amount, e.currency || bucketCurrency(key))}</Text>
                    </TouchableOpacity>
                  ))}
                  {g.rows.length > 4 && <Text style={styles.accMore}>+ {g.rows.length - 4} autre{g.rows.length - 4 > 1 ? 's' : ''}</Text>}
                  <TouchableOpacity style={styles.accMoveBtn} onPress={() => setReassignFrom(key)} activeOpacity={0.85}>
                    <Ionicons name="swap-horizontal-outline" size={15} color={COLORS.emerald} />
                    <Text style={styles.accMoveText}>Déplacer ces {g.rows.length} dépenses</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          ) : tab === 'expenses' ? (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>J'ai avancé</Text><Text style={styles.totalValue}>{fmt(myPaid)}</Text></View>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>Ma part</Text><Text style={styles.totalValue}>{fmt(myShare)}</Text></View>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>Total projet</Text><Text style={styles.totalValue}>{fmt(total)}</Text></View>
              </View>
              {expenses.length === 0 ? (
                <Text style={styles.empty}>Aucune dépense. Ajoutes-en une !</Text>
              ) : grouped.map(([date, items]) => (
                <View key={date}>
                  <Text style={styles.dateHeader}>{new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                  {items.map((e) => (
                    <TouchableOpacity key={e.id} style={styles.expCard} activeOpacity={0.8}
                      onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/add-expense?projectId=${projectId}&expenseId=${e.id}` as any)}>
                      <Text style={styles.expEmoji}>{e.emoji || '🧾'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.expTitle} numberOfLines={1}>{e.title || 'Dépense'}</Text>
                        {/* Plusieurs payeurs : on les NOMME avec leurs montants. Afficher le seul
                            payeur principal donnerait une addition qui ne tombe pas juste sous les
                            yeux de celui qui a réglé l'autre moitié. */}
                        <Text style={styles.expSub}>
                          {(() => {
                            const paid = paidByParticipant(e, payers);
                            const cur = e.currency || projectCurrency;
                            return paid.length > 1
                              ? `Payé par ${paid.map((p) => `${nameOf(p.participant_id)} (${fmtIn(p.amount, cur)})`).join(' et ')}`
                              : `Payé par ${nameOf(paid[0]?.participant_id ?? e.paid_by)}`;
                          })()}
                          {e.account_id ? '' : ' · cash'}
                        </Text>
                      </View>
                      {/* Une dépense s'affiche dans la devise où elle a été PAYÉE — c'est le montant
                          que l'utilisateur retrouve sur son relevé. Sa contre-valeur en devise du
                          projet, celle des soldes, est rappelée juste en dessous. */}
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.expAmount}>{fmtIn(e.amount, e.currency || projectCurrency)}</Text>
                        {(e.currency || projectCurrency) !== projectCurrency && (
                          <Text style={styles.expConverted}>≈ {fmt(toProject(e.amount, e))}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={[styles.balanceHeadCard, { borderColor: (myBalance >= 0 ? COLORS.emerald : COLORS.danger) + '55' }]}>
                <Text style={styles.balanceHeadText}>
                  {Math.abs(myBalance) < 0.01 ? 'Tu es à jour ✅' : myBalance > 0 ? `On te doit ${fmt(myBalance)}` : `Tu dois ${fmt(-myBalance)}`}
                </Text>
              </View>
              <Text style={styles.sectionLabel}>Soldes par participant</Text>
              {participants.map((p) => {
                const b = balances.get(p.id) ?? 0;
                return (
                  <View key={p.id} style={styles.balRow}>
                    <Text style={styles.balName}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                    <Text style={[styles.balAmount, { color: Math.abs(b) < 0.01 ? COLORS.textSecondary : b > 0 ? COLORS.emerald : COLORS.danger }]}>
                      {b > 0 ? '+' : ''}{fmt(b)}
                    </Text>
                  </View>
                );
              })}
              {settlements.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Remboursements suggérés</Text>
                  {settlements.map((s, i) => (
                    <View key={i} style={styles.settleRow}>
                      <Text style={styles.settleText}><Text style={{ fontWeight: '800', color: COLORS.text }}>{nameOf(s.from)}</Text> doit <Text style={{ fontWeight: '800', color: COLORS.text }}>{fmt(s.amount)}</Text> à <Text style={{ fontWeight: '800', color: COLORS.text }}>{nameOf(s.to)}</Text></Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* Ajouter une dépense */}
        <TouchableOpacity style={styles.fab} activeOpacity={0.85}
          onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/add-expense?projectId=${projectId}` as any)}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.fabText}>Ajouter une dépense</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Modal inviter */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Participants</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setShowInvite(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Inviter un utilisateur Relyka (par son ID)</Text>
            <TextInput style={styles.input} value={inviteCode} onChangeText={(t) => setInviteCode(t.toUpperCase())} placeholder="Ex. A1B2C3D4" placeholderTextColor={COLORS.textSecondary} autoCapitalize="characters" />
            {!!inviteErr && <Text style={styles.errText}>{inviteErr}</Text>}
            <TouchableOpacity style={[styles.modalCta, (!inviteCode.trim() || inviteBusy) && { opacity: 0.5 }]} onPress={onInviteByCode} disabled={!inviteCode.trim() || inviteBusy}>
              {inviteBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalCtaText}>Envoyer l'invitation</Text>}
            </TouchableOpacity>

            <View style={styles.sep} />
            <Text style={styles.label}>Ou ajouter une personne non inscrit</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={freeName} onChangeText={setFreeName} placeholder="Ex. Julie" placeholderTextColor={COLORS.textSecondary} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ajouter" style={styles.addNameBtn} onPress={onAddFreeName} disabled={!freeName.trim()}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.sep} />
            <Text style={styles.label}>Participants actuels</Text>
            {participants.map((p) => {
              // Non inscrit (pas de compte lié, pas en attente) → modifiable (renommer / inviter par ID).
              const editable = !p.user_id && !p.pending;
              const isProjectOwner = p.user_id === project?.owner_id;
              /* Retirer : réservé au créateur du projet ; chacun peut en revanche se retirer
                 lui-même. Le créateur, lui, ne se retire pas — il supprime ou archive le projet
                 (sinon on obtiendrait un projet sans personne pour l'administrer). */
              const canRemove = !isProjectOwner && (isOwner || p.user_id === user?.id);
              return (
                <View key={p.id} style={styles.partRow}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    activeOpacity={editable ? 0.6 : 1}
                    disabled={!editable}
                    onPress={() => editable && openPartEdit(p)}
                  >
                    <Text style={styles.partItem}>• {p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}{p.pending ? ' · en attente' : ''}{editable ? ' · non inscrit' : ''}</Text>
                  </TouchableOpacity>
                  {editable && (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Modifier ${p.display_name}`} onPress={() => openPartEdit(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="create-outline" size={18} color={COLORS.emerald} />
                    </TouchableOpacity>
                  )}
                  {p.pending && isOwner && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Annuler l'invitation de ${p.display_name}`}
                      onPress={() => cancelInvitation.mutate(p.id, { onError: (e: any) => Alert.alert('Un souci', e?.message ?? "L'invitation n'a pas pu être annulée.") })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle-outline" size={19} color={COLORS.orange} />
                    </TouchableOpacity>
                  )}
                  {/* Deux lignes pour une seule personne → fusionner. Proposé uniquement sur une
                      ligne NON INSCRITE : absorber un compte Relyka reviendrait à donner ses
                      dépenses à quelqu'un d'autre. */}
                  {!p.user_id && isOwner && participants.length > 1 && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Fusionner ${p.display_name} avec un autre participant`}
                      onPress={() => { setShowInvite(false); setMergeErr(null); setMerging(p); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="git-merge-outline" size={18} color={COLORS.blue} />
                    </TouchableOpacity>
                  )}
                  {canRemove && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Retirer ${p.display_name}`}
                      onPress={() => { setShowInvite(false); setRemoveErr(null); setRemoving(p); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="person-remove-outline" size={18} color={COLORS.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Modal édition d'un participant non inscrit (renommer / inviter par ID) */}
      <Modal visible={!!editPart} transparent animationType="slide" onRequestClose={() => setEditPart(null)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Participant non inscrit</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setEditPart(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Nom</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={partName} onChangeText={setPartName} placeholder="Nom" placeholderTextColor={COLORS.textSecondary} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Valider le nom" style={[styles.addNameBtn, (partBusy || !partName.trim() || partName.trim() === editPart?.display_name) && { opacity: 0.5 }]} onPress={savePartName} disabled={partBusy || !partName.trim() || partName.trim() === editPart?.display_name}>
                <Ionicons name="checkmark" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.sep} />
            <Text style={styles.label}>Inviter cette personne par son ID Relyka</Text>
            <Text style={styles.partHint}>Si elle accepte, elle prend la place de ce participant : ses dépenses et parts déjà saisies lui sont rattachées.</Text>
            <TextInput style={styles.input} value={partCode} onChangeText={(t) => setPartCode(t.toUpperCase())} placeholder="Ex. A1B2C3D4" placeholderTextColor={COLORS.textSecondary} autoCapitalize="characters" />
            {!!partErr && <Text style={styles.errText}>{partErr}</Text>}
            <TouchableOpacity style={[styles.modalCta, (!partCode.trim() || partBusy) && { opacity: 0.5 }]} onPress={reinvitePart} disabled={!partCode.trim() || partBusy}>
              {partBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalCtaText}>Envoyer l'invitation</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Modal — retirer un participant (avec repreneur de ce qu'il laisse) */}
      <Modal visible={!!removing} transparent animationType="slide" onRequestClose={() => { setRemoving(null); setRemovePending(null); }}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Retirer {removing?.display_name}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => { setRemoving(null); setRemovePending(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* ARGENT RÉEL EN JEU → on ne propose même pas le retrait.
                Ses dépenses ont une transaction en face, sur SON compte bancaire : la réattribuer
                ferait diverger le projet et son Relyka. Seul son propriétaire peut y toucher. */}
            {removeRealTx > 0 ? (
              <>
                <View style={styles.blockNote}>
                  <Ionicons name="lock-closed-outline" size={16} color={COLORS.orange} />
                  <Text style={styles.blockNoteText}>
                    {removeRealTx} dépense{removeRealTx > 1 ? 's' : ''} de {removing?.display_name} {removeRealTx > 1 ? 'ont' : 'a'} été
                    réglée{removeRealTx > 1 ? 's' : ''} depuis le compte bancaire de quelqu'un d'autre.
                    Impossible de les transférer : la transaction reste sur SON compte, et le projet
                    dirait le contraire.
                  </Text>
                </View>
                <Text style={styles.partHint}>
                  Pour pouvoir la retirer, ces dépenses doivent d'abord être supprimées, ou repassées
                  en « cash » depuis l'onglet « Par compte » — par leur propriétaire, lui seul y a droit.
                </Text>
                {/* SORTIE DE SECOURS. Le refus était un cul-de-sac : il expliquait pourquoi c'était
                    impossible sans donner le geste qui, lui, l'est. Quand la ligne bloquée n'est
                    PAS un compte Relyka, le cas de loin le plus fréquent est qu'elle double une
                    personne déjà présente — et fusionner ne transfère rien, donc rien ne s'oppose
                    à le proposer ici. */}
                {!removing?.user_id && participants.length > 1 && (
                  <>
                    <Text style={styles.partHint}>
                      Si cette ligne et un autre participant sont en réalité la même personne, c'est
                      une fusion qu'il te faut : rien n'est transféré, aucune transaction ne bouge,
                      les deux lignes n'en font qu'une.
                    </Text>
                    <TouchableOpacity
                      style={styles.modalCta}
                      activeOpacity={0.85}
                      onPress={() => { const p = removing; setRemoving(null); setRemovePending(null); setMergeErr(null); setMerging(p); }}
                    >
                      <Text style={styles.modalCtaText}>Fusionner avec un autre participant</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.removeBack} onPress={() => setRemoving(null)} activeOpacity={0.85}>
                  <Text style={styles.removeBackText}>Fermer</Text>
                </TouchableOpacity>
              </>
            ) : removePending ? (
              <>
                <Text style={styles.partHint}>
                  {removePending.reassignTo
                    ? `${removing?.display_name} sera retiré du projet. ${nameOf(removePending.reassignTo)} reprend ses ${removeRefs} ligne${removeRefs > 1 ? 's' : ''} (dépenses avancées et quotes-parts) : les équilibres restent exacts, mais ce transfert ne s'annule pas.`
                    : `${removing?.display_name} sera retiré du projet. Cette action ne s'annule pas.`}
                </Text>
                {!!removeErr && <Text style={styles.errText}>{removeErr}</Text>}
                <TouchableOpacity
                  style={[styles.removeCta, removeBusy && { opacity: 0.5 }]}
                  onPress={() => runRemove(removePending.reassignTo)}
                  disabled={removeBusy}
                >
                  {removeBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalCtaText}>Oui, retirer définitivement</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeBack} onPress={() => setRemovePending(null)} disabled={removeBusy}>
                  <Text style={styles.removeBackText}>Revenir en arrière</Text>
                </TouchableOpacity>
              </>
            ) : removeRefs === 0 ? (
              <>
                <Text style={styles.partHint}>
                  {removing?.display_name} n'apparaît dans aucune dépense : le retrait est sans conséquence
                  sur les comptes du projet.
                </Text>
                {!!removeErr && <Text style={styles.errText}>{removeErr}</Text>}
                <TouchableOpacity style={styles.removeCta} onPress={() => setRemovePending({ reassignTo: null })}>
                  <Text style={styles.modalCtaText}>Retirer du projet</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* On ne peut pas se contenter de supprimer la ligne : `paid_by` est en cascade,
                    retirer quelqu'un effacerait les dépenses qu'il a avancées — chez TOUS les
                    participants. Il faut donc quelqu'un pour reprendre ce qu'il laisse. */}
                <Text style={styles.partHint}>
                  {removing?.display_name} apparaît dans {removeRefs} ligne{removeRefs > 1 ? 's' : ''} du projet
                  (dépenses avancées et/ou quotes-parts). Choisis qui les reprend : rien ne sera perdu, les
                  équilibres resteront exacts.
                </Text>
                {!!removeErr && <Text style={styles.errText}>{removeErr}</Text>}
                {participants.filter((p) => p.id !== removing?.id).map((p) => (
                  <TouchableOpacity key={p.id} style={styles.reassignRow} onPress={() => setRemovePending({ reassignTo: p.id })} disabled={removeBusy} activeOpacity={0.8}>
                    <Ionicons name="person-outline" size={17} color={COLORS.emerald} />
                    <Text style={styles.reassignName}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                    <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                ))}
                {removeBusy && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 10 }} />}
              </>
            )}
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Modal — fusionner deux lignes qui désignent la même personne */}
      <Modal visible={!!merging} transparent animationType="slide" onRequestClose={() => setMerging(null)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Fusionner {merging?.display_name}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setMerging(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.partHint}>
              À utiliser quand deux lignes désignent la même personne. Tout ce que porte
              « {merging?.display_name} » — dépenses avancées et quotes-parts — est repris par celle que
              tu choisis, et cette ligne disparaît.
            </Text>
            <Text style={styles.partHint}>
              Aucune transaction n'est touchée : chaque dépense garde la sienne, sur le compte de son
              propriétaire. Aucun solde ne bouge. En revanche, la fusion ne s'annule pas.
            </Text>
            {!!mergeErr && <Text style={styles.errText}>{mergeErr}</Text>}
            <ScrollView style={{ maxHeight: 300 }}>
              {participants.filter((p) => p.id !== merging?.id).map((p) => (
                <TouchableOpacity key={p.id} style={styles.reassignRow} onPress={() => runMerge(p.id)} disabled={mergeBusy} activeOpacity={0.8}>
                  <Ionicons name="person-outline" size={17} color={COLORS.blue} />
                  <Text style={styles.reassignName}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            {mergeBusy && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 10 }} />}
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Modal — déplacer en masse les dépenses d'un compte vers un autre */}
      <Modal visible={!!reassignFrom} transparent animationType="slide" onRequestClose={() => setReassignFrom(null)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Déplacer vers…</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setReassignFrom(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.partHint}>
              Les transactions actuelles sont supprimées (les soldes sont rétablis) et recréées sur le
              compte choisi, à la même date et pour le même montant. Les dépenses du projet, elles,
              ne bougent pas.
            </Text>
            {/* « Le même montant » n'a de sens qu'à devise égale : recréer une dépense de 100 CHF
                sur un compte en euros la transformerait en 100 €. On n'offre donc que les comptes
                de la MÊME devise que le regroupement d'origine, et on le dit s'il en manque. */}
            {reassignHiddenCount > 0 && (
              <Text style={styles.reassignNote}>
                {reassignHiddenCount === 1 ? '1 compte est masqué' : `${reassignHiddenCount} comptes sont masqués`} :
                {' '}ils ne sont pas dans la même devise ({currencySymbolFor(reassignCurrency)}) que ces dépenses.
                Déplacer un montant d'une devise à l'autre changerait ce qui a réellement été payé.
              </Text>
            )}
            <ScrollView style={{ maxHeight: 320 }}>
              {reassignTargets.map((a: any) => (
                <TouchableOpacity key={a.id} style={styles.reassignRow} onPress={() => runReassign(a.id)} disabled={reassignBusy} activeOpacity={0.8}>
                  <Ionicons name="card-outline" size={17} color={COLORS.blue} />
                  <Text style={styles.reassignName}>{a.name}</Text>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ))}
              {reassignFrom !== 'cash' && (
                <TouchableOpacity style={styles.reassignRow} onPress={() => runReassign(null)} disabled={reassignBusy} activeOpacity={0.8}>
                  <Ionicons name="cash-outline" size={17} color={COLORS.textSecondary} />
                  <Text style={styles.reassignName}>Cash — n'impacter aucun compte</Text>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </ScrollView>
            {reassignBusy && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 10 }} />}
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Modal édition projet */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Modifier le projet</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setShowEdit(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Icône</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {PROJ_EMOJIS.map((e) => (
                <TouchableOpacity key={e} style={[styles.editEmojiPick, editEmoji === e && { borderColor: COLORS.emerald, borderWidth: 2 }]} onPress={() => setEditEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Nom du projet *</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Nom" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.label}>Description</Text>
            <TextInput style={styles.input} value={editDesc} onChangeText={setEditDesc} placeholder="Description (optionnel)" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.label}>Devise du projet</Text>
            <CurrencyPicker value={editCurrency} onChange={setEditCurrency} />
            <Text style={styles.editCurrencyHint}>
              {editCurrency === (project?.currency || 'EUR')
                ? 'La devise dans laquelle se lisent les totaux et les soldes entre participants.'
                : `Les totaux passeront en ${editCurrency}. Les dépenses déjà saisies gardent la devise dans laquelle elles ont été payées : elles seront simplement converties à l'affichage.`}
            </Text>
            <TouchableOpacity style={[styles.modalCta, !editName.trim() && { opacity: 0.5 }]} onPress={saveEdit} disabled={!editName.trim()} activeOpacity={0.85}>
              <Text style={styles.modalCtaText}>Enregistrer</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    empty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 24 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    inviteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3b82f6' + '1A', borderWidth: 1, borderColor: '#3b82f6' + '55', borderRadius: 999, paddingVertical: 10 },
    inviteBtnText: { fontSize: 13, fontWeight: '700', color: '#3b82f6' },
    editProjBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    archivedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#f59e0b' + '1A', borderWidth: 1, borderColor: '#f59e0b' + '55', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginBottom: 10 },
    archivedBadgeText: { fontSize: 12, fontWeight: '800', color: '#f59e0b' },
    ownerActionsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    archiveActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#f59e0b' + '14', borderWidth: 1, borderColor: '#f59e0b' + '55', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
    archiveActionText: { fontSize: 14, fontWeight: '700', color: '#f59e0b' },
    deleteActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.danger + '14', borderWidth: 1, borderColor: c.danger + '55', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
    deleteActionText: { fontSize: 14, fontWeight: '700', color: c.danger },
    archiveHint: { fontSize: 12, color: c.textSecondary, lineHeight: 16, marginBottom: 12 },
    editCurrencyHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 8, marginBottom: 4 },
    editEmojiPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    tabs: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: c.cardBorder },
    tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
    tabActive: { backgroundColor: c.emerald },
    tabText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.onAccent },
    totalsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    totalCol: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
    totalLabel: { fontSize: 11, color: c.textSecondary, textAlign: 'center' },
    totalValue: { fontSize: 14.5, fontWeight: '800', color: c.text, marginTop: 4 },
    dateHeader: { fontSize: 13, fontWeight: '800', color: c.textSecondary, marginTop: 12, marginBottom: 8 },
    expCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    expEmoji: { fontSize: 22 },
    expTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    expSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    expAmount: { fontSize: 15, fontWeight: '800', color: c.text },
    expConverted: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
    balanceHeadCard: { backgroundColor: c.card, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
    balanceHeadText: { fontSize: 16, fontWeight: '800', color: c.text },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 },
    balRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, marginBottom: 8 },
    balName: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
    balAmount: { fontSize: 14, fontWeight: '800' },
    settleRow: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    settleText: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
    fab: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
    fabText: { fontSize: 15, fontWeight: '800', color: c.onAccent },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalCard: { ...sheetWidth, backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36, borderWidth: 1, borderColor: c.cardBorder, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 10, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    errText: { fontSize: 12, color: c.danger, marginBottom: 8 },
    modalCta: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 2 },
    modalCtaText: { fontSize: 15, fontWeight: '800', color: c.onAccent },
    addNameBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    sep: { height: 1, backgroundColor: c.cardBorder, marginVertical: 16 },
    partItem: { fontSize: 13, color: c.text, marginBottom: 4 },
    partRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
    partHint: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 10, marginTop: -2 },
    removeCta: { backgroundColor: c.danger, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    blockNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.orange + '14', borderWidth: 1, borderColor: c.orange + '4D', borderRadius: 12, padding: 12, marginBottom: 10 },
    blockNoteText: { flex: 1, fontSize: 12.5, color: c.text, lineHeight: 18 },
    removeBack: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
    removeBackText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    reassignRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8 },
    reassignName: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
    reassignNote: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginBottom: 10 },

    // Onglet « Par compte »
    accHint: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginBottom: 14 },
    accCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10, gap: 6 },
    accHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    accName: { flex: 1, fontSize: 14.5, fontWeight: '800', color: c.text },
    accTotal: { fontSize: 14.5, fontWeight: '800', color: c.text },
    accCount: { fontSize: 11.5, color: c.textSecondary },
    accLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
    accLineText: { flex: 1, fontSize: 13, color: c.textSecondary },
    accLineAmount: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    accMore: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic' },
    accMoveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '14' },
    accMoveText: { fontSize: 13, fontWeight: '800', color: c.emerald },
    detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    detailCard: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22, alignItems: 'center' },
    detailEmoji: { fontSize: 36 },
    detailTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginTop: 6 },
    detailAmount: { fontSize: 24, fontWeight: '900', color: c.emerald, marginTop: 4 },
    detailSub: { fontSize: 12.5, color: c.textSecondary, marginTop: 4, textAlign: 'center' },
    shareRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 6 },
    shareName: { fontSize: 14, color: c.text },
    shareAmount: { fontSize: 14, fontWeight: '700', color: c.text },
    detailActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
    editExpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    editExpText: { fontSize: 13, fontWeight: '700', color: c.text },
    deleteExpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.danger + '14' },
    deleteExpText: { fontSize: 13, fontWeight: '700', color: c.danger },
  });
}
