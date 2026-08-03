/**
 * MonthlyClosure — bannière de clôture + modale de clôture + pop-up de bilan éphémère.
 * Activé seulement si le drapeau admin monthly_closure_enabled est vrai (sinon rien ne s'affiche).
 * Monté sur le Pilotage.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useAddTransaction, useTransactions } from '../hooks/useTransactions';
import { useMonthlyClosure, monthLabel, lastDayOfMonthKey, addMonthKey, ym } from '../hooks/useMonthlyClosure';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { prorateClosureGap, isRegul } from '../lib/regul';
import { todayISO, formatDateFrench, parseDateFromFrench } from '../lib/dateUtils';
import { sheetWidth } from '../lib/appLayout';
import { useRecalibrateReliability } from '../hooks/useReliability';
import { useInterruptSlot } from '../hooks/useInterruptSlot';
import { openPulse } from './PulseHost';

interface Props {
  /** Estimation du surplus du mois (enveloppe variable restante + budget libre). */
  surplusEstimate: number;
  /** Tous les comptes courants (clôture du solde réel possible compte par compte). */
  checkingAccounts?: { id: string; name: string; balance: number }[];
  /** Ouvre directement la modale (deeplink « Clôture ton mois » du bandeau prochain geste). */
  autoOpen?: boolean;
}

/**
 * Bannière d'invitation à la clôture (présentation pure) — partagée entre le Pilotage et
 * l'aperçu admin (admin/banners-preview) pour que l'aperçu reste le rendu de production.
 */
export function ClosureBannerCard({ pendingMonths, onPress }: { pendingMonths: string[]; onPress?: () => void }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  if (pendingMonths.length === 0) return null;
  const multiple = pendingMonths.length > 1;
  return (
    <TouchableOpacity style={styles.banner} activeOpacity={onPress ? 0.85 : 1} onPress={onPress}>
      <Ionicons name="lock-closed-outline" size={18} color={COLORS.yellow} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>Clôturer {multiple ? `${pendingMonths.length} mois` : monthLabel(pendingMonths[0])}</Text>
        <Text style={styles.bannerText}>Fige le passé pour fiabiliser tes calculs et recommandations.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.yellow} />
    </TouchableOpacity>
  );
}

/**
 * Ouverture IMPÉRATIVE de la modale (bandeau « prochain geste »).
 *
 * Le bandeau naviguait vers `/(tabs)/pilotage?closure=1`. Depuis le Pilotage — c'est-à-dire là où
 * le bandeau s'affiche — cette navigation ne change rien : même route, même paramètre, aucun
 * remontage. La modale, elle, ne se rouvre qu'au montage : après l'avoir fermée une fois, le
 * bandeau devenait inerte jusqu'à un rechargement complet. Un appel direct règle ça sans dépendre
 * du routeur (même schéma que `openPulse`).
 */
let openImperative: (() => void) | null = null;
export function openClosureModal(): boolean {
  if (!openImperative) return false;
  openImperative();
  return true;
}

export default function MonthlyClosure({ surplusEstimate, checkingAccounts = [], autoOpen = false }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user, isImpersonating } = useAuth();
  const { enabled, pendingMonths, bilan, closeMonths, markBilanSeen } = useMonthlyClosure(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  const { data: allTx = [] } = useTransactions(user?.id);

  const [open, setOpen] = useState(false);
  /* 'unknown' — « je ne sais pas ce que valait mon compte à la fin du mois ». L'utilisateur donne
     le solde qu'il a AUJOURD'HUI (ou à une date de son choix, forcément postérieure à la fin du
     mois) et dit lui-même comment il pense que l'écart se répartit entre le mois qu'on clôture et
     le mois en cours. Sans ce mode, clôturer un mois ancien exigeait de reconstituer un solde
     passé — ce que personne ne fait — ou de subir un prorata par jours qu'on ne lui demandait pas. */
  const [mode, setMode] = useState<'direct' | 'balance' | 'unknown'>('direct');
  /** Part de l'écart attribuée au mois CLÔTURÉ, en % (curseur). Défaut : le prorata par jours. */
  const [unknownShare, setUnknownShare] = useState<number | null>(null);
  const [unknownDate, setUnknownDate] = useState(todayISO());
  const [flash, setFlash] = useState(false);
  const [balances, setBalances] = useState<Record<string, string>>({}); // par compte courant
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mois déjà clôturés dans cette session (avance immédiate au mois suivant, avant le refetch).
  const [closedLocally, setClosedLocally] = useState<string[]>([]);

  const effectivePending = pendingMonths.filter((m) => !closedLocally.includes(m));
  const oldest = effectivePending[0];
  const multiple = effectivePending.length > 1;
  const monthsToClose = flash ? effectivePending : (oldest ? [oldest] : []);
  const hasChecking = checkingAccounts.length > 0;
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

  const resetForm = () => { setMode('direct'); setFlash(false); setBalances({}); setUnknownShare(null); setUnknownDate(todayISO()); setError(null); };
  const openModal = () => { setClosedLocally([]); resetForm(); setOpen(true); };
  const closeModal = () => { setOpen(false); setClosedLocally([]); resetForm(); };

  /* La clôture est la PREMIÈRE des sollicitations : tout ce qui suit (bilan mensuel, profil,
     succès) s'appuie sur des chiffres qu'elle vient consolider. Elle prend donc la main en premier,
     et ne la rend qu'une fois fermée (cf. lib/interruptQueue). */
  const myTurn = useInterruptSlot('closure', enabled && pendingMonths.length > 0 && !isImpersonating);

  // Ouverture automatique (arrivée dans l'app / deeplink) : une fois par montage, et seulement
  // quand c'est notre tour.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (autoOpen && myTurn && !autoOpened.current) {
      autoOpened.current = true;
      openModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, myTurn]);

  // Ouverture à la demande depuis le bandeau « prochain geste » — sans passer par le routeur.
  React.useEffect(() => {
    openImperative = () => openModal();
    return () => { openImperative = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalibrate = useRecalibrateReliability(user?.id);

  // Solde d'un compte à la fin du mois concerné (= solde actuel − transactions postérieures).
  const targetKey = monthsToClose[monthsToClose.length - 1] ?? oldest;
  const balanceAtEndFor = (accId: string, accBalance: number) => {
    if (!targetKey) return accBalance;
    const cutoff = lastDayOfMonthKey(targetKey);
    // Même logique que le « solde à date » du détail de compte : on exclut les brouillons
    // et les lignes récurrentes (occurrences projetées) → solde réel à la fin du mois.
    const after = (allTx as any[])
      .filter((t) => t.account_id === accId && !t.is_draft && !t.is_recurring && t.date > cutoff)
      .reduce((s, t) => s + Number(t.amount), 0);
    return accBalance - after;
  };

  // Dernière « vérification » (régul) datée ≤ aujourd'hui pour un compte, sinon 1er jour du mois clos.
  const lastVerifiedFor = (accId: string, closeKey: string): string => {
    const t0 = todayISO();
    let best: string | null = null;
    for (const t of allTx as any[]) {
      if (t.account_id !== accId || !isRegul(t)) continue;
      const d = String(t.date ?? '').slice(0, 10);
      if (d && d <= t0 && (!best || d > best)) best = d;
    }
    return best ?? `${closeKey}-01`;
  };

  /** Part (%) attribuée au mois clôturé : celle du curseur, sinon le prorata par jours suggéré. */
  const unknownSharePct = (accId: string): number => {
    if (unknownShare != null) return unknownShare;
    if (!targetKey) return 50;
    const pr = prorateClosureGap(100, lastVerifiedFor(accId, targetKey), unknownDate, targetKey);
    return Math.round(Math.max(0, Math.min(100, pr.closingShare)));
  };

  const confirm = async () => {
    if (!monthsToClose.length) return;
    setBusy(true);
    try {
      const closeKey = monthsToClose[monthsToClose.length - 1];
      const prevMonth = addMonthKey(ym(new Date()), -1);
      const isLatest = closeKey >= prevMonth; // clôture qui atteint le mois précédent (solde réel = solde actuel)
      const monthEnd = lastDayOfMonthKey(closeKey);
      const t0 = todayISO();
      if (hasChecking) {
        for (const acc of checkingAccounts) {
          const balAtEnd = balanceAtEndFor(acc.id, acc.balance);
          if (mode === 'direct') {
            // Option A — « Je suis à jour » : ancre de VÉRIFICATION (écart 0) datée de la fin du mois.
            // Calibre la dérive vers 0 et compte comme une vérification récente.
            await addTransaction.mutateAsync({
              account_id: acc.id, category_id: null, amount: 0, date: monthEnd,
              note: 'Régularisation (à jour)', regul_target: balAtEnd, is_recurring: false,
            } as any);
            continue;
          }
          if (mode === 'unknown') {
            /* « Je ne sais pas » : le solde donné vaut à `unknownDate` (postérieure à la fin du
               mois). L'écart est mesuré contre le solde REMONTÉ à cette date, puis réparti selon
               le curseur — c'est l'utilisateur qui tranche, pas une règle qu'il n'a pas choisie. */
            const raw = balances[acc.id];
            if (raw == null || raw.trim() === '') continue;
            const stated = parseFloat(raw.replace(',', '.'));
            if (Number.isNaN(stated)) continue;
            const afterDate = (allTx as any[])
              .filter((t) => t.account_id === acc.id && !t.is_draft && !t.is_recurring && t.date > unknownDate && t.date <= t0)
              .reduce((s, t) => s + Number(t.amount), 0);
            const knownAtDate = acc.balance - afterDate;
            const gap = stated - knownAtDate;
            if (Math.abs(gap) <= 0.005) continue;
            const pct = unknownSharePct(acc.id) / 100;
            const closingPart = gap * pct;
            const currentPart = gap - closingPart;
            if (Math.abs(closingPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: null, amount: closingPart, date: monthEnd,
                note: 'Régularisation clôture (mois)', is_recurring: false,
              } as any);
            }
            if (Math.abs(currentPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: null, amount: currentPart, date: unknownDate,
                note: 'Régularisation clôture (mois courant)', is_recurring: false,
              } as any);
            }
            continue;
          }

          // Mode « solde réel ».
          const raw = balances[acc.id];
          if (raw == null || raw.trim() === '') continue;
          const newBalance = parseFloat(raw.replace(',', '.'));
          if (Number.isNaN(newBalance)) continue;
          const diff = newBalance - balAtEnd;
          if (Math.abs(diff) <= 0.005) {
            await addTransaction.mutateAsync({
              account_id: acc.id, category_id: null, amount: 0, date: monthEnd,
              note: 'Régularisation (à jour)', regul_target: balAtEnd, is_recurring: false,
            } as any);
            continue;
          }
          if (isLatest) {
            // Option B — solde réel constaté = solde ACTUEL → régul ancre datée de la fin du mois.
            await addTransaction.mutateAsync({
              account_id: acc.id, category_id: null, amount: diff, date: monthEnd,
              note: 'Régularisation solde', regul_target: newBalance, is_recurring: false,
            } as any);
          } else {
            // Option C — mois passé, solde saisi = AUJOURD'HUI → PRORATA par jours entre la dernière
            // vérification et aujourd'hui : la part du mois clos reste sur ce mois, le reste sur le courant.
            const pr = prorateClosureGap(diff, lastVerifiedFor(acc.id, closeKey), t0, closeKey);
            if (Math.abs(pr.closingShare) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: null, amount: pr.closingShare, date: pr.closingDate,
                note: 'Régularisation clôture (mois)', is_recurring: false,
              } as any);
            }
            if (Math.abs(pr.currentShare) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: null, amount: pr.currentShare, date: t0,
                note: 'Régularisation clôture (mois courant)', is_recurring: false,
              } as any);
            }
          }
        }
      }
      await closeMonths.mutateAsync({ monthKeys: monthsToClose, surplus: Math.max(0, surplusEstimate), status: 'confirmed' });
      // Clôture confirmée = vérification → recalibrer la dérive du user (silencieux).
      recalibrate.mutate();
      // Mois par mois : s'il reste des mois en attente, on enchaîne directement sur le suivant.
      const remaining = effectivePending.filter((m) => !monthsToClose.includes(m));
      if (!flash && remaining.length > 0) {
        setClosedLocally((prev) => [...prev, ...monthsToClose]);
        setBalances({});
        setMode('direct');
      } else {
        closeModal();
        /* PLUS RIEN À CLÔTURER → on ENCHAÎNE sur l'état des lieux du mois.
           C'était jusqu'ici laissé à l'ouverture automatique, qui dépend d'une pile de conditions
           ambiantes (période déjà « vue » dans la session, signaux jugés, données rechargées…) :
           il suffisait qu'une seule ne passe pas pour que le bilan n'arrive jamais, sans rien dire.
           Ici on SAIT qu'il doit venir — l'utilisateur vient de valider le mois — donc on le
           demande explicitement. L'ouverture automatique reste le chemin des lancements suivants.
           Le petit délai laisse la modale se refermer et les données se rafraîchir. */
        if (closeKey === addMonthKey(ym(new Date()), -1)) {
          setTimeout(() => openPulse('month'), 450);
        }
      }
    } catch (e) {
      /* ⚠️ NE PLUS AVALER L'ÉCHEC. C'est ce `console.warn` muet qui a rendu le bug de la policy
         UPDATE manquante (migration 162) invisible pendant des mois : les régularisations étaient
         créées, la clôture échouait, et l'écran se contentait de ne pas avancer — sans rien dire. */
      console.warn('[closure] échec clôture:', e);
      setError(e instanceof Error ? e.message : "La clôture n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    // Même si désactivé, on peut avoir un bilan à montrer (cas où on désactive après coup) : on l'ignore.
    return null;
  }

  return (
    <>
      {/* Bannière d'invitation */}
      <ClosureBannerCard pendingMonths={effectivePending} onPress={openModal} />

      {/* Modale de clôture */}
      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={closeModal}>
        <View style={styles.overlay}>
          {/* SafeAreaView NATIF (edges bottom) : il mesure les insets de SA fenêtre — celle du Modal.
              Sans lui, le bas de la feuille (le bouton « Clôturer ») passait sous la barre de
              navigation du téléphone, exactement comme l'ancienne version du modal de profil.
              `maxHeight` + défilement : sur un petit écran, la feuille ne déborde plus de l'écran. */}
          <SafeAreaView edges={['bottom']} style={styles.sheetSafe}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Clôture mensuelle</Text>
              <TouchableOpacity onPress={closeModal} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {/* Contenu défilant : le mode « je ne sais pas » ajoute une date, un champ par compte
                et un curseur — sur un petit écran, la feuille dépassait sans qu'on puisse atteindre
                le bouton. */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">

            <View style={styles.monthRow}>
              <Text style={styles.sub}>{flash ? `Clôture de ${effectivePending.length} mois, jusqu'à` : 'Mois à clôturer :'}</Text>
              <Text style={styles.monthHighlight}>
                {flash ? monthLabel(effectivePending[effectivePending.length - 1] ?? oldest ?? '') : (oldest ? monthLabel(oldest) : '—')}
              </Text>
            </View>

            {multiple && (
              <View style={styles.segRow}>
                <TouchableOpacity style={[styles.seg, !flash && styles.segActive]} onPress={() => setFlash(false)}>
                  <Text style={[styles.segText, !flash && styles.segTextActive]}>Mois par mois</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.seg, flash && styles.segActive]} onPress={() => setFlash(true)}>
                  <Text style={[styles.segText, flash && styles.segTextActive]}>Tout d'un coup</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.segRow}>
              <TouchableOpacity style={[styles.seg, mode === 'direct' && styles.segActive]} onPress={() => setMode('direct')}>
                <Text style={[styles.segText, mode === 'direct' && styles.segTextActive]}>Validation directe</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.seg, mode === 'balance' && styles.segActive]} onPress={() => setMode('balance')} disabled={!hasChecking}>
                <Text style={[styles.segText, mode === 'balance' && styles.segTextActive]}>Solde réel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.seg, mode === 'unknown' && styles.segActive]} onPress={() => setMode('unknown')} disabled={!hasChecking}>
                <Text style={[styles.segText, mode === 'unknown' && styles.segTextActive]}>Je ne sais pas</Text>
              </TouchableOpacity>
            </View>

            {mode === 'unknown' ? (
              <>
                <Text style={styles.hint}>
                  Tu ne sais plus ce que valait ton compte fin {targetKey ? monthLabel(targetKey) : ''} ? Donne simplement
                  le solde que tu as sous les yeux : on le date, et tu dis toi-même quelle part de l'écart appartient
                  à ce mois-là.
                </Text>
                <Text style={styles.label}>Date de ce solde</Text>
                <TextInput
                  style={styles.input}
                  value={formatDateFrench(unknownDate)}
                  onChangeText={(v) => { const iso = parseDateFromFrench(v); if (iso) setUnknownDate(iso); }}
                  placeholder="jj-mm-aaaa"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.label}>
                  {checkingAccounts.length > 1 ? 'Solde de chaque compte à cette date' : 'Solde de ton compte à cette date'}
                </Text>
                {checkingAccounts.map((acc) => (
                  <View key={acc.id} style={styles.acctInputRow}>
                    {checkingAccounts.length > 1 && <Text style={styles.acctName} numberOfLines={1}>{acc.name}</Text>}
                    <TextInput
                      style={[styles.input, checkingAccounts.length > 1 && { flex: 1, marginBottom: 0 }]}
                      value={balances[acc.id] ?? ''}
                      onChangeText={(v) => setBalances((p) => ({ ...p, [acc.id]: v.replace(/[^0-9.,-]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholder={`Ex. ${Math.round(acc.balance)}`}
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                {/* Curseur de répartition — la position de départ est le prorata par jours, mais
                    c'est l'utilisateur qui tranche : lui seul sait si l'écart vient d'août ou de
                    septembre. Pas de Slider natif dans l'app → 5 crans, tapables. */}
                {(() => {
                  const firstAcc = checkingAccounts[0];
                  if (!firstAcc) return null;
                  const pct = unknownSharePct(firstAcc.id);
                  const gapOf = (acc: { id: string; balance: number }) => {
                    const raw = balances[acc.id];
                    if (raw == null || raw.trim() === '') return 0;
                    const stated = parseFloat(raw.replace(',', '.'));
                    if (Number.isNaN(stated)) return 0;
                    const t0 = todayISO();
                    const after = (allTx as any[])
                      .filter((t) => t.account_id === acc.id && !t.is_draft && !t.is_recurring && t.date > unknownDate && t.date <= t0)
                      .reduce((s, t) => s + Number(t.amount), 0);
                    return stated - (acc.balance - after);
                  };
                  const totalGap = checkingAccounts.reduce((s, a) => s + gapOf(a), 0);
                  if (Math.abs(totalGap) < 0.005) return null;
                  return (
                    <View style={styles.splitBox}>
                      <Text style={styles.splitTitle}>
                        Écart constaté : {fmt(totalGap)}. Quelle part était en {targetKey ? monthLabel(targetKey) : 'ce mois'} ?
                      </Text>
                      <View style={styles.splitSteps}>
                        {[0, 25, 50, 75, 100].map((v) => (
                          <TouchableOpacity
                            key={v}
                            style={[styles.splitStep, Math.abs(pct - v) < 13 && styles.splitStepOn]}
                            onPress={() => setUnknownShare(v)}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.splitStepText, Math.abs(pct - v) < 13 && styles.splitStepTextOn]}>{v} %</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.splitResult}>
                        <Text style={styles.splitResultItem}>
                          {targetKey ? monthLabel(targetKey) : ''} : <Text style={styles.splitResultVal}>{fmt(totalGap * (pct / 100))}</Text>
                        </Text>
                        <Text style={styles.splitResultItem}>
                          Mois en cours : <Text style={styles.splitResultVal}>{fmt(totalGap * (1 - pct / 100))}</Text>
                        </Text>
                      </View>
                      {unknownShare == null && (
                        <Text style={styles.splitHint}>Proposition calculée au prorata des jours — corrige-la si tu sais mieux.</Text>
                      )}
                    </View>
                  );
                })()}
              </>
            ) : mode === 'direct' ? (
              <>
                <Text style={styles.hint}>Tu as saisi toutes tes transactions ? Valide simplement la clôture.</Text>
                {hasChecking && targetKey && (
                  <View style={styles.balanceList}>
                    {checkingAccounts.map((acc) => (
                      <View key={acc.id} style={styles.balanceBox}>
                        <Text style={styles.balanceLabel} numberOfLines={1}>{checkingAccounts.length > 1 ? acc.name : 'Solde du compte courant'} à fin {monthLabel(targetKey)}</Text>
                        <Text style={styles.balanceValue}>{fmt(balanceAtEndFor(acc.id, acc.balance))}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.label}>
                  {checkingAccounts.length > 1 ? 'Solde réel de chaque compte courant' : 'Solde réel de ton compte courant'} à fin {targetKey ? monthLabel(targetKey) : ''}
                </Text>
                {checkingAccounts.map((acc) => (
                  <View key={acc.id} style={styles.acctInputRow}>
                    {checkingAccounts.length > 1 && <Text style={styles.acctName} numberOfLines={1}>{acc.name}</Text>}
                    <TextInput
                      style={[styles.input, checkingAccounts.length > 1 && { flex: 1, marginBottom: 0 }]}
                      value={balances[acc.id] ?? ''}
                      onChangeText={(v) => setBalances((p) => ({ ...p, [acc.id]: v.replace(/[^0-9.,-]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholder={`Ex. ${Math.round(balanceAtEndFor(acc.id, acc.balance))}`}
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                <Text style={styles.hint}>Une transaction d'ajustement sera créée au {lastDayOfMonthKey(targetKey ?? '')} pour chaque compte renseigné.</Text>
              </>
            )}

            {/* ── Aperçu AVANT validation : impact exact par mois (bloc structuré, pas de surprise) ── */}
            {(() => {
              if (!targetKey) return null;
              const prevMonth = addMonthKey(ym(new Date()), -1);
              const isLatest = targetKey >= prevMonth;
              const t0 = todayISO();
              type Row = { label: string; regul: number; closed?: boolean };
              const rows: Row[] = [];
              if (mode === 'direct') {
                rows.push({ label: monthLabel(targetKey), regul: 0, closed: true });
              } else {
                let closingTotal = 0, currentTotal = 0, any = false;
                for (const acc of checkingAccounts) {
                  const raw = balances[acc.id];
                  if (raw == null || raw.trim() === '') continue;
                  const nb = parseFloat(raw.replace(',', '.'));
                  if (Number.isNaN(nb)) continue;
                  any = true;
                  const diff = nb - balanceAtEndFor(acc.id, acc.balance);
                  if (isLatest) closingTotal += diff;
                  else {
                    const pr = prorateClosureGap(diff, lastVerifiedFor(acc.id, targetKey), t0, targetKey);
                    closingTotal += pr.closingShare;
                    currentTotal += pr.currentShare;
                  }
                }
                if (!any) return null;
                rows.push({ label: monthLabel(targetKey), regul: closingTotal, closed: true });
                if (Math.abs(currentTotal) > 0.005) rows.push({ label: monthLabel(ym(new Date())), regul: currentTotal });
              }
              return (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>Si tu valides :</Text>
                  {rows.map((r) => (
                    <View key={r.label} style={styles.previewRow}>
                      <Text style={styles.previewMonth}>{r.label}</Text>
                      <Text style={[styles.previewValue, { color: Math.abs(r.regul) < 0.005 ? COLORS.emerald : r.regul < 0 ? COLORS.danger : COLORS.green }]}>
                        {Math.abs(r.regul) < 0.005 ? 'écart 0 — solde confirmé' : `régularisation : ${r.regul > 0 ? '+' : '−'}${fmt(Math.abs(r.regul))}`}
                      </Text>
                      {r.closed && (
                        <View style={styles.previewBadge}>
                          <Ionicons name="checkmark" size={10} color={COLORS.emerald} />
                          <Text style={styles.previewBadgeText}>mois fermé</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              );
            })()}

            <View style={styles.lockNote}>
              <Ionicons name="information-circle-outline" size={15} color={COLORS.textSecondary} />
              <Text style={styles.lockNoteText}>La clôture enregistre une régularisation datée pour fiabiliser tes calculs. Rien n'est verrouillé : tu pourras toujours corriger plus tard.</Text>
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            </ScrollView>
            {/* Le bouton reste HORS du défilement : il doit être atteignable sans dérouler. */}
            <TouchableOpacity style={[styles.confirmBtn, busy && { opacity: 0.6 }]} onPress={() => { setError(null); confirm(); }} disabled={busy}>
              {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.confirmText}>Clôturer{flash ? ' tout' : ''}</Text>}
            </TouchableOpacity>
          </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Pop-up de bilan éphémère — masquée en consultation admin (ne pas consommer le bilan du compte cible) */}
      <Modal visible={!isImpersonating && !!bilan} transparent animationType="fade" statusBarTranslucent onRequestClose={() => markBilanSeen.mutate()}>
        <View style={styles.bilanOverlay}>
          <View style={styles.bilanCard}>
            {bilan && bilan.surplus > 0 ? (
              <>
                <Text style={styles.bilanEmoji}>💰</Text>
                <Text style={styles.bilanTitle}>Félicitations !</Text>
                <Text style={styles.bilanText}>
                  Il te restait <Text style={{ color: COLORS.green, fontWeight: '800' }}>{fmt(bilan.surplus)}</Text> sur ton enveloppe le mois dernier. Tes recommandations ont été mises à jour pour intégrer ce surplus.
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={COLORS.emerald} />
                <Text style={styles.bilanTitle}>Période clôturée</Text>
                <Text style={styles.bilanText}>Ton mois est figé. Place au mois en cours !</Text>
              </>
            )}
            <TouchableOpacity style={styles.bilanBtn} onPress={() => markBilanSeen.mutate()}>
              <Text style={styles.bilanBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.yellow + '1A', borderWidth: 1, borderColor: c.yellow + '55',
      borderRadius: 14, padding: 14, marginHorizontal: 8, marginBottom: 10,
    },
    bannerTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    bannerText: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheetSafe: { ...sheetWidth, maxHeight: '92%' },
    // paddingBottom réduit : c'est le SafeAreaView qui ajoute désormais la hauteur réelle de la
    // barre système. Cumuler les deux repoussait le bouton hors de l'écran sur les petits mobiles.
    sheet: { backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 16, gap: 6 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { fontSize: 19, fontWeight: '800', color: c.text },
    sub: { fontSize: 14, color: c.textSecondary },
    monthRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    monthHighlight: { fontSize: 19, fontWeight: '800', color: c.emerald, textTransform: 'capitalize' },
    balanceList: { marginTop: 8, gap: 6 },
    balanceBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, paddingVertical: 12, paddingHorizontal: 14 },
    balanceLabel: { fontSize: 13, color: c.textSecondary, flex: 1, marginRight: 8 },
    balanceValue: { fontSize: 17, fontWeight: '800', color: c.text },
    acctInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    acctName: { fontSize: 13, fontWeight: '600', color: c.text, width: 110 },

    // Mode « je ne sais pas » : répartition de l'écart entre le mois clôturé et le mois en cours.
    splitBox: {
      marginTop: 4, marginBottom: 10, gap: 8, padding: 12,
      borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    },
    splitTitle: { fontSize: 12.5, color: c.text, fontWeight: '700', lineHeight: 18 },
    splitSteps: { flexDirection: 'row', gap: 6 },
    splitStep: {
      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10,
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    splitStepOn: { borderColor: c.emerald, backgroundColor: c.emerald + '20' },
    splitStepText: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary },
    splitStepTextOn: { color: c.emerald },
    splitResult: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    splitResultItem: { fontSize: 12, color: c.textSecondary },
    splitResultVal: { fontWeight: '800', color: c.text },
    splitHint: { fontSize: 11, color: c.textSecondary, fontStyle: 'italic' },
    segRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    seg: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    segActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    segText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    segTextActive: { color: c.bg },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '700', color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 10, lineHeight: 17 },
    previewBox: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '44', padding: 12, marginTop: 14, gap: 8 },
    previewTitle: { fontSize: 12.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    previewMonth: { fontSize: 13.5, fontWeight: '800', color: c.text, textTransform: 'capitalize', minWidth: 74 },
    previewValue: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
    previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.emerald + '18', borderWidth: 1, borderColor: c.emerald + '55', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
    previewBadgeText: { fontSize: 10, fontWeight: '800', color: c.emerald },
    lockNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderRadius: 10, padding: 10, marginTop: 16 },
    lockNoteText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 16 },
    errorBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10,
      borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12',
      borderRadius: 12, padding: 11,
    },
    errorText: { flex: 1, fontSize: 12.5, color: c.danger, lineHeight: 17 },
    confirmBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
    confirmText: { fontSize: 16, fontWeight: '700', color: c.bg },
    bilanOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 28 },
    bilanCard: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder, padding: 28, alignItems: 'center', gap: 12 },
    bilanEmoji: { fontSize: 52 },
    bilanTitle: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
    bilanText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },
    bilanBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 40, marginTop: 8 },
    bilanBtnText: { fontSize: 15, fontWeight: '700', color: c.bg },
  });
}
