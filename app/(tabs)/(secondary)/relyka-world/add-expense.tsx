/**
 * Relyka World — ajout / modification d'une dépense partagée.
 *
 * Trois décisions, dans cet ordre : QUI a payé, DEPUIS QUOI (un ou plusieurs comptes, ou cash), et
 * POUR QUI (la répartition de la dette).
 *
 * ── Les deux répartitions ────────────────────────────────────────────────────────────────────
 * Elles n'ont rien à voir et étaient toutes les deux bloquées sur « en parts égales, un seul
 * compte » :
 *   • la DETTE (`rw_expense_shares`) — ce que chaque participant doit. Trois personnes au
 *     restaurant ne mangent pas le même menu : on peut désormais saisir 42 € / 18 € / 25 €.
 *   • le PAIEMENT (`rw_expense_accounts`, migration 178) — d'où l'argent est sorti. Une même
 *     dépense peut être réglée pour partie sur le compte courant, pour partie ailleurs.
 * Chacune a son mode « égal / personnalisé » : le mode égal reste le chemin par défaut, en un tap.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useAccounts } from '../../../../hooks/data/useAccounts';
import { useCategories } from '../../../../hooks/data/useCategories';
import { currencySymbolFor, convertAmount } from '../../../../lib/finance/currency';
import { useCurrencyRates } from '../../../../hooks/data/useCurrencyRates';
import { todayISO, formatDateFrench } from '../../../../lib/dateUtils';
import CalendarWithPicker from '../../../../components/transaction/CalendarWithPicker';
import {
  useRwProject, useRwExpenses, useAddRwExpense, useUpdateRwExpense, useDeleteRwExpense,
  splitEvenly, type RwAccountSplit,
} from '../../../../hooks/engagement/useRelykaWorld';
import { Alert } from 'react-native';

const EMOJIS = ['🧾', '🍽️', '🛒', '🚕', '🏨', '🎟️', '⛽', '🍺', '🎁', '✈️'];

/** Lit un montant tapé au clavier (virgule décimale acceptée). */
const num = (raw: string | undefined): number => {
  const v = parseFloat(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};
const fmt2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export default function AddRwExpense() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ projectId: string; expenseId?: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const expenseId = Array.isArray(params.expenseId) ? params.expenseId[0] : params.expenseId;

  // Retour vers le projet : on dépile l'écran d'ajout pour RÉVÉLER l'instance [id] déjà montée
  // (router.back) — pas de remontage (donc pas de re-souscription realtime), et on retombe
  // toujours sur le projet, jamais sur le Pilotage. Repli explicite si pile vide (ouverture directe).
  const backToProject = React.useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/(tabs)/(secondary)/relyka-world/${projectId}` as any);
  }, [router, projectId]);

  const { data: projData } = useRwProject(projectId);
  const { data: expData } = useRwExpenses(projectId);
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const addExpense = useAddRwExpense(projectId, user?.id);
  const updateExpense = useUpdateRwExpense(projectId, user?.id);
  const deleteExpense = useDeleteRwExpense(projectId, user?.id);
  const editing = expData?.expenses.find((e) => e.id === expenseId) ?? null;

  const onDelete = () => {
    if (!editing) return;
    Alert.alert('Supprimer la dépense', 'Cette dépense (et les transactions liées à tes comptes) sera supprimée.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await deleteExpense.mutateAsync(editing); backToProject(); }
        catch (e: any) { Alert.alert('Erreur', e?.message ?? 'Suppression impossible. Réessaie.'); }
      } },
    ]);
  };
  // Catégorie « Projets » (comme une transaction de projet classique).
  const projetsCategoryId = useMemo(() => (categories as any[]).find((c) => c.name === 'Projets' && c.type === 'expense')?.id ?? null, [categories]);

  const project = projData?.project;
  const participants = projData?.participants ?? [];
  const myParticipantId = participants.find((p) => p.user_id === user?.id)?.id;
  const checkingAccounts = useMemo(() => accounts.filter((a) => a.type === 'checking'), [accounts]);

  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🧾');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | undefined>(myParticipantId);
  /** Répartition du PAIEMENT entre participants : 'one' = une personne a tout réglé, 'many' = à plusieurs. */
  const [payerMode, setPayerMode] = useState<'one' | 'many'>('one');
  const [payerDraft, setPayerDraft] = useState<Record<string, string>>({});
  const [involved, setInvolved] = useState<Set<string>>(new Set(participants.map((p) => p.id)));
  /** Répartition de la DETTE : 'even' = parts égales, 'custom' = montants saisis. */
  const [shareMode, setShareMode] = useState<'even' | 'custom'>('even');
  const [shareDraft, setShareDraft] = useState<Record<string, string>>({});
  /** Répartition du PAIEMENT : 'single' = un compte (ou cash), 'multi' = plusieurs comptes. */
  const [payMode, setPayMode] = useState<'single' | 'multi'>('single');
  const [accountId, setAccountId] = useState<string | 'cash'>('cash');
  const [payDraft, setPayDraft] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayISO());
  const [showCal, setShowCal] = useState(false);
  const [busy, setBusy] = useState(false);

  // Initialise les sélections quand les participants arrivent (création seulement).
  React.useEffect(() => {
    if (editing) return;
    if (participants.length && involved.size === 0) setInvolved(new Set(participants.map((p) => p.id)));
    if (!paidBy && myParticipantId) setPaidBy(myParticipantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.length, editing]);

  // Pré-remplissage en mode édition (une seule fois).
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (!editing || !expData || prefilled.current) return;
    setTitle(editing.title); setEmoji(editing.emoji || '🧾');
    setAmount(String(editing.amount).replace('.', ',')); setDate(editing.date);
    setPaidBy(editing.paid_by);
    // Payeurs enregistrés : au-delà d'un seul, on rouvre directement en « plusieurs payeurs » —
    // sinon le premier ré-enregistrement écraserait la répartition sans rien dire.
    const pays = expData.payers.filter((p) => p.expense_id === editing.id);
    if (pays.length > 1) {
      setPayerMode('many');
      setPayerDraft(Object.fromEntries(pays.map((p) => [p.participant_id, fmt2(p.amount)])));
    }
    const sh = expData.shares.filter((s) => s.expense_id === editing.id);
    if (sh.length) {
      setInvolved(new Set(sh.map((s) => s.participant_id)));
      setShareDraft(Object.fromEntries(sh.map((s) => [s.participant_id, fmt2(s.amount)])));
      /* Ouvrir directement en « montants personnalisés » si les parts enregistrées ne sont PAS
         égales : rouvrir une dépense finement répartie en mode « parts égales » l'aurait aplatie
         au premier enregistrement, sans que rien ne le signale. */
      const evenly = splitEvenly(editing.amount, sh.length);
      const isEven = sh.every((s, i) => Math.abs(s.amount - (evenly[i] ?? 0)) < 0.02);
      if (!isEven) setShareMode('custom');
    }
    // Répartition du paiement : lignes de la migration 178, sinon le compte unique historique.
    const mine = expData.accounts.filter((a) => a.expense_id === editing.id);
    if (mine.length > 1) {
      setPayMode('multi');
      setPayDraft(Object.fromEntries(mine.map((a) => [a.account_id, fmt2(a.amount)])));
    } else if (mine.length === 1) {
      setAccountId(mine[0].account_id);
    } else {
      setAccountId(editing.account_id ?? 'cash');
    }
    prefilled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, expData]);

  const amountNum = num(amount);
  const involvedList = participants.filter((p) => involved.has(p.id));

  // ── Répartition du PAIEMENT entre participants (qui a avancé quoi) ─────────────────────────
  const payerList = useMemo(() => {
    if (payerMode === 'one') {
      return paidBy ? [{ participant_id: paidBy, amount: amountNum }] : [];
    }
    return participants
      .map((p) => ({ participant_id: p.id, amount: num(payerDraft[p.id]) }))
      .filter((p) => p.amount > 0);
  }, [payerMode, paidBy, amountNum, participants, payerDraft]);

  const payersTotal = payerList.reduce((s, p) => s + p.amount, 0);
  const payersGap = Math.round((amountNum - payersTotal) * 100) / 100;
  const payersBalanced = payerList.length > 0 && Math.abs(payersGap) < 0.02;
  /** Payeur PRINCIPAL : celui qui a le plus avancé — c'est lui que porte la colonne historique. */
  const mainPayer = payerList.length
    ? payerList.reduce((a, b) => (b.amount > a.amount ? b : a)).participant_id
    : paidBy;
  /** Ce que MOI j'ai avancé : c'est cette somme-là que je répartis entre MES comptes, pas le total. */
  const myPaidAmount = payerList.find((p) => p.participant_id === myParticipantId)?.amount ?? 0;
  const paidByMe = myPaidAmount > 0;

  const toggle = (id: string) => setInvolved((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── Répartition de la DETTE ────────────────────────────────────────────────────────────────
  /** Parts effectives, dans l'ordre d'affichage. Mode égal → calculées ; sinon → saisies. */
  const shareAmounts = useMemo<Record<string, number>>(() => {
    if (shareMode === 'even') {
      const parts = splitEvenly(amountNum, involvedList.length);
      return Object.fromEntries(involvedList.map((p, i) => [p.id, parts[i] ?? 0]));
    }
    return Object.fromEntries(involvedList.map((p) => [p.id, num(shareDraft[p.id])]));
  }, [shareMode, amountNum, involvedList, shareDraft]);

  const sharesTotal = useMemo(
    () => involvedList.reduce((s, p) => s + (shareAmounts[p.id] ?? 0), 0),
    [involvedList, shareAmounts],
  );
  const sharesGap = Math.round((amountNum - sharesTotal) * 100) / 100;
  const sharesBalanced = Math.abs(sharesGap) < 0.02;

  /** Répartit le reste sur le premier participant sans montant (ou sur le dernier). */
  const fillShareGap = () => {
    if (involvedList.length === 0) return;
    const target = involvedList.find((p) => num(shareDraft[p.id]) === 0) ?? involvedList[involvedList.length - 1];
    setShareDraft((d) => ({ ...d, [target.id]: fmt2(num(d[target.id]) + sharesGap) }));
  };

  /** Passage en « montants personnalisés » : on part des parts égales, pas de champs vides. */
  const enterCustomShares = () => {
    const parts = splitEvenly(amountNum, involvedList.length);
    setShareDraft(Object.fromEntries(involvedList.map((p, i) => [p.id, fmt2(parts[i] ?? 0)])));
    setShareMode('custom');
  };

  // ── Répartition du PAIEMENT ────────────────────────────────────────────────────────────────
  const accountSplits = useMemo<RwAccountSplit[]>(() => {
    if (!paidByMe) return [];                       // seul un payeur engage ses comptes
    if (payMode === 'single') {
      // Le compte reçoit CE QUE J'AI AVANCÉ, pas le total de la dépense : à deux payeurs, débiter
      // mon compte du montant entier ferait sortir de chez moi l'argent avancé par quelqu'un d'autre.
      return accountId === 'cash' ? [] : [{ account_id: accountId, amount: myPaidAmount }];
    }
    return checkingAccounts
      .map((a) => ({ account_id: a.id, amount: num(payDraft[a.id]) }))
      .filter((s) => s.amount > 0);
  }, [paidByMe, payMode, accountId, myPaidAmount, checkingAccounts, payDraft]);

  /* ── DEVISE DE LA DÉPENSE ───────────────────────────────────────────────────────────────────
     Une dépense est libellée dans la devise où elle a RÉELLEMENT été payée :
       • réglée depuis un compte → la devise de ce compte (c'est ce montant-là qui sera débité, et
         c'est celui que l'utilisateur lit sur son relevé) ;
       • réglée en cash, ou saisie par quelqu'un qui n'engage aucun compte → la devise du PROJET.
     Les parts (`shares`) et les avances (`payers`) sont dans cette même devise : la dépense reste
     atomique, et l'affichage du projet convertit ensuite vers la devise du projet.
     ⚠️ Rien n'est converti à l'ENREGISTREMENT : les taux bougent, seuls les faits saisis sont
     stockés. */
  const projectCurrency = project?.currency || 'EUR';
  const engagedCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const s of accountSplits) {
      if (s.amount <= 0) continue;
      const acc = checkingAccounts.find((a) => a.id === s.account_id);
      if (acc?.currency) set.add(acc.currency);
    }
    return [...set];
  }, [accountSplits, checkingAccounts]);
  /* Plusieurs comptes de devises DIFFÉRENTES sur une même dépense : le total saisi n'aurait plus
     de sens (on additionnerait des francs et des euros), et le « reste à régler en cash » non plus.
     On refuse, en le disant — même garde-fou que le virement récurrent cross-devises. */
  const mixedCurrencies = engagedCurrencies.length > 1;
  const expenseCurrency = engagedCurrencies[0] ?? projectCurrency;
  const expenseSymbol = currencySymbolFor(expenseCurrency);
  /** Vraie conversion à afficher : seulement quand la dépense n'est pas déjà dans la devise du projet. */
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const convertedToProject = useMemo(() => {
    if (expenseCurrency === projectCurrency || !(amountNum > 0)) return null;
    return convertAmount(amountNum, expenseCurrency, projectCurrency, rates);
  }, [amountNum, expenseCurrency, projectCurrency, rates]);

  const payTotal = accountSplits.reduce((s, a) => s + a.amount, 0);
  const payRest = Math.round((myPaidAmount - payTotal) * 100) / 100;
  /** On accepte un reste : il est simplement réglé en cash. On refuse en revanche le dépassement. */
  const payOver = payRest < -0.02;

  const canSave = title.trim().length > 0 && amountNum > 0 && !!mainPayer
    && payersBalanced && involvedList.length > 0 && sharesBalanced && !payOver && !mixedCurrencies && !busy;

  /* VERROU SYNCHRONE contre la double soumission.
     `busy` est un état React : il ne devient vrai qu'au rendu SUIVANT. Deux taps rapprochés sur
     « Enregistrer » passaient donc tous les deux le test, et lançaient deux enregistrements — donc
     deux transactions sur le compte. Une référence, elle, est posée immédiatement. */
  const saving = React.useRef(false);
  const onSave = async () => {
    if (!canSave || !projectId || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const shares = involvedList
        .map((p) => ({ participant_id: p.id, amount: Math.round((shareAmounts[p.id] ?? 0) * 100) / 100 }))
        .filter((s) => s.amount > 0);
      const common = {
        title: title.trim(), emoji, amount: amountNum, currency: expenseCurrency, date, paidBy: mainPayer!,
        payers: payerList.map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 })),
        shares,
        accountSplits,
        projectName: project?.name ?? 'Projet',
        categoryId: projetsCategoryId,
      };
      if (editing) await updateExpense.mutateAsync({ expense: editing, ...common });
      else await addExpense.mutateAsync(common);
      backToProject();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible d\'enregistrer la dépense. Vérifie ta connexion et réessaie.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title={editing ? 'Modifier la dépense' : 'Ajouter une dépense'} onBack={backToProject} />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Icône</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              {EMOJIS.map((e) => (
                <TouchableOpacity key={e} style={[styles.emojiPick, emoji === e && styles.emojiPickActive]} onPress={() => setEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Titre</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ex. Restaurant" placeholderTextColor={COLORS.textSecondary} />

            <Text style={styles.label}>Montant ({expenseSymbol})</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" />
            {/* Le montant se saisit dans la devise du COMPTE utilisé : c'est ce qui sera débité, et
                c'est ce que l'utilisateur lira sur son relevé. On annonce alors la contre-valeur
                dans la devise du projet, celle des soldes entre participants. */}
            {expenseCurrency !== projectCurrency && (
              <Text style={styles.currencyNote}>
                Saisi dans la devise du compte ({expenseCurrency}).{' '}
                {convertedToProject != null
                  ? `Compté ${fmt2(convertedToProject)} ${currencySymbolFor(projectCurrency)} dans le projet, au taux du jour.`
                  : `Taux ${expenseCurrency} → ${projectCurrency} indisponible : la conversion s'affichera plus tard.`}
              </Text>
            )}
            {mixedCurrencies && (
              <Text style={styles.currencyBlock}>
                Les comptes choisis ne sont pas dans la même devise ({engagedCurrencies.join(', ')}).
                Une dépense ne peut porter qu'une seule devise : règle-la depuis des comptes d'une
                même devise, ou crée une dépense par devise.
              </Text>
            )}

            <Text style={styles.label}>Date</Text>
            <TouchableOpacity style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]} onPress={() => setShowCal(true)} activeOpacity={0.7}>
              <Text style={{ color: COLORS.text, fontSize: 15 }}>{formatDateFrench(date)}</Text>
              <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* QUI A AVANCÉ L'ARGENT — une personne, ou plusieurs.
                Au restaurant à quatre, il arrive que deux personnes règlent (60 € par carte, 40 €
                en espèces). Il fallait jusqu'ici inventer deux dépenses, ce qui décorrèle les parts
                de l'addition réelle. C'est une répartition à part entière, distincte de « qui doit
                quoi » plus bas : on peut avancer sans rien devoir, et devoir sans avoir avancé. */}
            <View style={styles.sectionHead}>
              <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Payé par</Text>
              <TouchableOpacity
                style={styles.modeToggle}
                onPress={() => {
                  if (payerMode === 'one') {
                    // On amorce avec le payeur déjà choisi : jamais une liste vide à remplir.
                    setPayerDraft(paidBy ? { [paidBy]: fmt2(amountNum) } : {});
                    setPayerMode('many');
                  } else setPayerMode('one');
                }}
                activeOpacity={0.75}
              >
                <Ionicons name={payerMode === 'many' ? 'person-outline' : 'people-outline'} size={13} color={COLORS.emerald} />
                <Text style={styles.modeToggleText}>{payerMode === 'many' ? 'Une seule personne' : 'Plusieurs payeurs'}</Text>
              </TouchableOpacity>
            </View>

            {payerMode === 'one' ? (
              <View style={styles.chipsWrap}>
                {participants.map((p) => (
                  <TouchableOpacity key={p.id} style={[styles.chip, paidBy === p.id && styles.chipActive]} onPress={() => setPaidBy(p.id)}>
                    <Text style={[styles.chipText, paidBy === p.id && styles.chipTextActive]}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <>
                {participants.map((p) => (
                  <View key={p.id} style={styles.splitRow}>
                    <Text style={styles.splitName} numberOfLines={1}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                    <TextInput
                      style={styles.splitInput}
                      value={payerDraft[p.id] ?? ''}
                      onChangeText={(v) => setPayerDraft((d) => ({ ...d, [p.id]: v.replace(/[^0-9.,]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                    <Text style={styles.splitUnit}>{expenseSymbol}</Text>
                  </View>
                ))}
                <View style={[styles.tallyBox, payersBalanced ? { borderColor: COLORS.emerald + '55' } : { borderColor: COLORS.orange + '66' }]}>
                  <Text style={styles.tallyText}>
                    Avancé : <Text style={styles.tallyStrong}>{fmt2(payersTotal)} {expenseSymbol}</Text> sur {fmt2(amountNum)} {expenseSymbol}
                    {payersBalanced ? ' — c’est juste ✅' : payersGap > 0 ? ` — il manque ${fmt2(payersGap)} ${expenseSymbol}` : ` — ${fmt2(-payersGap)} ${expenseSymbol} de trop`}
                  </Text>
                  {!payersBalanced && participants.length > 0 && (
                    <TouchableOpacity
                      style={styles.tallyBtn}
                      activeOpacity={0.8}
                      onPress={() => {
                        // On complète sur la première personne déjà renseignée, sinon sur moi.
                        const target = participants.find((p) => num(payerDraft[p.id]) > 0)
                          ?? participants.find((p) => p.id === myParticipantId)
                          ?? participants[0];
                        setPayerDraft((d) => ({ ...d, [target.id]: fmt2(num(d[target.id]) + payersGap) }));
                      }}
                    >
                      <Text style={styles.tallyBtnText}>{payersGap > 0 ? 'Attribuer le reste' : 'Retirer le surplus'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {/* Compte(s) — seulement si payé par moi : c'est mon argent, donc mes transactions. */}
            {paidByMe && (
              <>
                <View style={styles.sectionHead}>
                  <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Depuis quel compte ?</Text>
                  <TouchableOpacity
                    style={styles.modeToggle}
                    onPress={() => {
                      if (payMode === 'single') {
                        // On amorce la répartition avec le compte déjà choisi : jamais une page vide.
                        setPayDraft(accountId === 'cash' ? {} : { [accountId]: fmt2(myPaidAmount) });
                        setPayMode('multi');
                      } else setPayMode('single');
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={payMode === 'multi' ? 'git-merge-outline' : 'git-branch-outline'} size={13} color={COLORS.emerald} />
                    <Text style={styles.modeToggleText}>{payMode === 'multi' ? 'Un seul compte' : 'Plusieurs comptes'}</Text>
                  </TouchableOpacity>
                </View>

                {payMode === 'single' ? (
                  <>
                    <View style={styles.chipsWrap}>
                      <TouchableOpacity style={[styles.chip, accountId === 'cash' && styles.chipActive]} onPress={() => setAccountId('cash')}>
                        <Ionicons name="cash-outline" size={14} color={accountId === 'cash' ? COLORS.bg : COLORS.textSecondary} />
                        <Text style={[styles.chipText, accountId === 'cash' && styles.chipTextActive]}>  Cash (aucune transaction)</Text>
                      </TouchableOpacity>
                      {checkingAccounts.map((a) => (
                        <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                          <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {accountId !== 'cash' && <Text style={styles.hint}>Une dépense de {fmt2(myPaidAmount)} {expenseSymbol} sera enregistrée sur ce compte — ce que TU as avancé.</Text>}
                  </>
                ) : (
                  <>
                    {checkingAccounts.map((a) => (
                      <View key={a.id} style={styles.splitRow}>
                        <Text style={styles.splitName} numberOfLines={1}>{a.name}</Text>
                        <TextInput
                          style={styles.splitInput}
                          value={payDraft[a.id] ?? ''}
                          onChangeText={(v) => setPayDraft((d) => ({ ...d, [a.id]: v.replace(/[^0-9.,]/g, '') }))}
                          keyboardType="decimal-pad"
                          placeholder="0,00"
                          placeholderTextColor={COLORS.textSecondary}
                        />
                        <Text style={styles.splitUnit}>{expenseSymbol}</Text>
                      </View>
                    ))}
                    <Text style={[styles.hint, payOver && { color: COLORS.danger }]}>
                      {payOver
                        ? `Tu répartis ${fmt2(payTotal)} ${expenseSymbol} alors que tu n'as avancé que ${fmt2(myPaidAmount)} ${expenseSymbol} : retire ${fmt2(-payRest)} ${expenseSymbol}.`
                        : payRest > 0.02
                          ? `${fmt2(payTotal)} ${expenseSymbol} depuis tes comptes, ${fmt2(payRest)} ${expenseSymbol} en cash (aucune transaction).`
                          : `Une transaction sera créée sur chaque compte renseigné.`}
                    </Text>
                  </>
                )}
              </>
            )}

            {/* Répartition de la dette */}
            <View style={styles.sectionHead}>
              <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Partagé entre</Text>
              <TouchableOpacity
                style={styles.modeToggle}
                onPress={() => (shareMode === 'even' ? enterCustomShares() : setShareMode('even'))}
                activeOpacity={0.75}
              >
                <Ionicons name={shareMode === 'custom' ? 'reorder-two-outline' : 'create-outline'} size={13} color={COLORS.emerald} />
                <Text style={styles.modeToggleText}>{shareMode === 'custom' ? 'Parts égales' : 'Montants différents'}</Text>
              </TouchableOpacity>
            </View>

            {participants.map((p) => {
              const on = involved.has(p.id);
              return (
                <View key={p.id} style={styles.partRow}>
                  <TouchableOpacity onPress={() => toggle(p.id)} activeOpacity={0.7} style={styles.partTap}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? COLORS.emerald : COLORS.textSecondary} />
                    <Text style={styles.partName} numberOfLines={1}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                  </TouchableOpacity>
                  {!on ? (
                    <Text style={styles.partShare}>—</Text>
                  ) : shareMode === 'even' ? (
                    <Text style={styles.partShare}>{fmt2(shareAmounts[p.id] ?? 0)} {expenseSymbol}</Text>
                  ) : (
                    <View style={styles.shareInputWrap}>
                      <TextInput
                        style={styles.splitInput}
                        value={shareDraft[p.id] ?? ''}
                        onChangeText={(v) => setShareDraft((d) => ({ ...d, [p.id]: v.replace(/[^0-9.,]/g, '') }))}
                        keyboardType="decimal-pad"
                        placeholder="0,00"
                        placeholderTextColor={COLORS.textSecondary}
                      />
                      <Text style={styles.splitUnit}>{expenseSymbol}</Text>
                    </View>
                  )}
                </View>
              );
            })}

            {/* Le compte est TOUJOURS affiché en mode personnalisé : c'est la seule chose qui dit
                si la répartition tombe juste, et l'enregistrement en dépend. */}
            {shareMode === 'custom' && (
              <View style={[styles.tallyBox, sharesBalanced ? { borderColor: COLORS.emerald + '55' } : { borderColor: COLORS.orange + '66' }]}>
                <Text style={styles.tallyText}>
                  Réparti : <Text style={styles.tallyStrong}>{fmt2(sharesTotal)} {expenseSymbol}</Text> sur {fmt2(amountNum)} {expenseSymbol}
                  {sharesBalanced ? ' — c’est juste ✅' : sharesGap > 0 ? ` — il manque ${fmt2(sharesGap)} ${expenseSymbol}` : ` — ${fmt2(-sharesGap)} ${expenseSymbol} de trop`}
                </Text>
                {!sharesBalanced && (
                  <TouchableOpacity style={styles.tallyBtn} onPress={fillShareGap} activeOpacity={0.8}>
                    <Text style={styles.tallyBtnText}>{sharesGap > 0 ? 'Attribuer le reste' : 'Retirer le surplus'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity style={[styles.cta, !canSave && { opacity: 0.5 }]} onPress={onSave} disabled={!canSave} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.ctaText}>{editing ? 'Enregistrer' : 'Sauvegarder'}</Text>}
            </TouchableOpacity>
            {editing && (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={styles.deleteBtnText}>Supprimer la dépense</Text>
              </TouchableOpacity>
            )}
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={showCal} transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
        <TouchableOpacity style={styles.calOverlay} activeOpacity={1} onPress={() => setShowCal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.calCard} onPress={() => {}}>
            <CalendarWithPicker
              current={date}
              accentColor={COLORS.emerald}
              bgColor={COLORS.cardSolid ?? COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor={COLORS.textSecondary}
              onDayPress={(d) => { setDate(d.dateString); setShowCal(false); }}
            />
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
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6, marginTop: 8 },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 8, marginTop: -2, lineHeight: 16 },
    currencyNote: { fontSize: 11.5, color: c.blue, marginBottom: 10, marginTop: -4, lineHeight: 16 },
    currencyBlock: {
      fontSize: 11.5, color: c.danger, lineHeight: 16, marginBottom: 10, marginTop: -4,
      borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12',
      borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    emojiPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    emojiPickActive: { borderColor: c.emerald, borderWidth: 2 },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    chipTextActive: { color: c.bg },

    // En-tête de section : le libellé à gauche, la bascule de mode à droite.
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, marginBottom: 8 },
    modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '14' },
    modeToggleText: { fontSize: 11.5, fontWeight: '800', color: c.emerald },

    partRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    partTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    partName: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
    partShare: { fontSize: 13, fontWeight: '700', color: c.text },
    shareInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },

    splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    splitName: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
    splitInput: { minWidth: 84, textAlign: 'right', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: c.text, fontSize: 14, fontWeight: '700', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    splitUnit: { fontSize: 13, fontWeight: '700', color: c.textSecondary },

    tallyBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, marginTop: 2, marginBottom: 4, backgroundColor: c.card },
    tallyText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    tallyStrong: { fontWeight: '800', color: c.text },
    tallyBtn: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: c.emerald + '1A', borderWidth: 1, borderColor: c.emerald + '55' },
    tallyBtnText: { fontSize: 12, fontWeight: '800', color: c.emerald },

    cta: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
    ctaText: { fontSize: 15, fontWeight: '800', color: c.bg },
    deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, marginTop: 10, borderRadius: 12, backgroundColor: c.danger + '14' },
    deleteBtnText: { fontSize: 14, fontWeight: '700', color: c.danger },
    calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    calCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 18, borderWidth: 1, borderColor: c.cardBorder, padding: 10 },
  });
}
