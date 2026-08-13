/**
 * MonthlyClosure — bannière de clôture + modale de clôture + pop-up de bilan éphémère.
 * Activé seulement si le drapeau admin monthly_closure_enabled est vrai (sinon rien ne s'affiche).
 * Monté sur le Pilotage.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAddTransaction, useTransactions } from '../../hooks/data/useTransactions';
import { useMonthlyClosure, monthLabel, lastDayOfMonthKey, addMonthKey, ym } from '../../hooks/pilotage/useMonthlyClosure';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { prorateClosureGap, findRegulCategoryId } from '../../lib/finance/regul';
import { useCategories } from '../../hooks/data/useCategories';
import { todayISO, formatDateFrench, parseDateFromFrench } from '../../lib/dateUtils';
import { sheetWidth } from '../../lib/ui/appLayout';
import { useRecalibrateReliability } from '../../hooks/pilotage/useReliability';
import { useInterruptSlot } from '../../hooks/engagement/useInterruptSlot';
import { openPulse } from '../pulse/PulseHost';
import ClosureBilanModal from './ClosureBilanModal';
import { balanceAtEnd, lastVerifiedDate, unknownGap, unknownTotalGap as totalGap, hasAnyTypedBalance, closingSharePct } from '../../lib/finance/closureForm';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';

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
  // Catégories du profil : la régularisation de clôture est rangée selon son sens (cf. lib/regul).
  const { data: categories = [] } = useCategories(user?.id);
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

  /* ── REPORT ────────────────────────────────────────────────────────────────────────────────────
     La clôture s'ouvrait d'elle-même à CHAQUE ouverture de l'app tant qu'un mois restait en
     attente. L'intention est bonne — un mois non clôturé dégrade les moyennes de tous les suivants,
     et une bannière qu'on peut ignorer ne fait pas le travail — mais sans échappatoire, quelqu'un
     qui n'a pas ses relevés sous la main se prend la même modale plusieurs fois par jour. Au mieux
     il la referme sans lire, au pire il n'ouvre plus l'app.
     On garde donc l'ouverture automatique, avec un report explicite de 24 h : l'invitation reste
     insistante (elle revient le lendemain, et la bannière ne disparaît jamais), sans se répéter
     dans la même journée. Le report est LOCAL à l'appareil et porte sur le mois concerné — un
     nouveau mois à clôturer reprend la main immédiatement. */
  const SNOOZE_KEY = 'closure_snooze_v1';
  const SNOOZE_MS = 24 * 60 * 60 * 1000;
  const [snoozeChecked, setSnoozeChecked] = React.useState(false);
  const [snoozedMonth, setSnoozedMonth] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SNOOZE_KEY);
        if (cancelled) return;
        const o = raw ? JSON.parse(raw) : null;
        // Report périmé, ou posé sur un AUTRE mois → il ne protège plus rien.
        if (o?.month && typeof o.until === 'number' && o.until > Date.now()) setSnoozedMonth(o.month);
      } catch { /* stockage indisponible : on retombe sur le comportement d'origine */ }
      if (!cancelled) setSnoozeChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const snoozeAndClose = () => {
    const m = oldest;
    if (m) {
      setSnoozedMonth(m);
      AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ month: m, until: Date.now() + SNOOZE_MS })).catch(() => {});
    }
    closeModal();
  };

  /* La clôture est la PREMIÈRE des sollicitations : tout ce qui suit (bilan mensuel, profil,
     succès) s'appuie sur des chiffres qu'elle vient consolider. Elle prend donc la main en premier,
     et ne la rend qu'une fois fermée (cf. lib/interruptQueue). */
  const myTurn = useInterruptSlot('closure', enabled && pendingMonths.length > 0 && !isImpersonating);

  /* Ouverture automatique (arrivée dans l'app / deeplink) : une fois par montage, quand c'est notre
     tour — et seulement si le mois le plus ancien n'a pas été REPORTÉ dans les 24 h.
     On attend `snoozeChecked` : la lecture du report est asynchrone, et conclure avant sa réponse
     rouvrirait la modale précisément à celui qui vient de demander à être laissé tranquille.
     Un deeplink explicite (`?closure=1`) ou le bouton de la bannière passent outre : là,
     l'utilisateur DEMANDE la clôture. */
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (!autoOpen || !myTurn || autoOpened.current || !snoozeChecked) return;
    if (oldest && snoozedMonth === oldest) return;
    autoOpened.current = true;
    openModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, myTurn, snoozeChecked, snoozedMonth, oldest]);

  // Ouverture à la demande depuis le bandeau « prochain geste » — sans passer par le routeur.
  React.useEffect(() => {
    openImperative = () => openModal();
    return () => { openImperative = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalibrate = useRecalibrateReliability(user?.id);

  /* Le CALCUL de ce formulaire vit dans lib/closureForm : il décide de MONTANTS (solde de fin de
     mois reconstitué, écart constaté, répartition entre deux mois), donc il est testé — une erreur
     y écrit une régularisation fausse en base. Ici on ne fait plus que le brancher à l'état.
     Cf. docs/PLAN_REFACTOR_TESTS.md, phase D. */
  const targetKey = monthsToClose[monthsToClose.length - 1] ?? oldest;
  const balanceAtEndFor = (accId: string, accBalance: number) => balanceAtEnd(allTx as any[], accId, accBalance, targetKey);
  const lastVerifiedFor = (accId: string, closeKey: string) => lastVerifiedDate(allTx as any[], accId, closeKey);
  const unknownGapOf = (acc: { id: string; balance: number }) => unknownGap(allTx as any[], acc, balances[acc.id], unknownDate);
  const unknownTotalGap = () => totalGap(allTx as any[], checkingAccounts, balances, unknownDate);
  const hasAnyAmount = hasAnyTypedBalance(checkingAccounts, balances);
  /** Les modes « solde réel » et « je ne sais pas » ne veulent rien dire sans montant saisi. */
  const needsAmount = mode === 'balance' || mode === 'unknown';
  const unknownSharePct = (accId: string) => closingSharePct(allTx as any[], accId, targetKey, unknownDate, unknownShare);

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
               mois). L'écart est mesuré contre le solde REMONTÉ à cette date (cf. `unknownGapOf`,
               définition unique partagée avec le curseur et l'aperçu), puis réparti selon le
               curseur — c'est l'utilisateur qui tranche, pas une règle qu'il n'a pas choisie. */
            const raw = balances[acc.id];
            if (raw == null || raw.trim() === '') continue;
            const gap = unknownGapOf(acc);
            if (Math.abs(gap) <= 0.005) continue;
            const pct = unknownSharePct(acc.id) / 100;
            const closingPart = gap * pct;
            const currentPart = gap - closingPart;
            if (Math.abs(closingPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, closingPart), amount: closingPart, date: monthEnd,
                note: 'Régularisation clôture (mois)', is_recurring: false,
              } as any);
            }
            if (Math.abs(currentPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, currentPart), amount: currentPart, date: unknownDate,
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
              account_id: acc.id, category_id: findRegulCategoryId(categories, diff), amount: diff, date: monthEnd,
              note: 'Régularisation solde', regul_target: newBalance, is_recurring: false,
            } as any);
          } else {
            // Option C — mois passé, solde saisi = AUJOURD'HUI → PRORATA par jours entre la dernière
            // vérification et aujourd'hui : la part du mois clos reste sur ce mois, le reste sur le courant.
            const pr = prorateClosureGap(diff, lastVerifiedFor(acc.id, closeKey), t0, closeKey);
            if (Math.abs(pr.closingShare) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, pr.closingShare), amount: pr.closingShare, date: pr.closingDate,
                note: 'Régularisation clôture (mois)', is_recurring: false,
              } as any);
            }
            if (Math.abs(pr.currentShare) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, pr.currentShare), amount: pr.currentShare, date: t0,
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
          setTimeout(() => openPulse(), 450);
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
        <KeyboardAwareOverlay style={styles.overlay} scroll={false}>
          {/* `maxHeight` porté par la FEUILLE elle-même (et non par un conteneur au-dessus) : une View
              a `flexShrink: 0` par défaut, donc une feuille enveloppée dans un parent plafonné ne se
              rétrécit PAS — elle débordait sous le bas de l'écran et emportait le bouton « Clôturer »
              avec elle (constaté sur navigateur mobile / iPhone). Même schéma que ProfileChangeModal
              et SupportThreadModal : plafond sur la feuille, SafeAreaView autour du seul pied. */}
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Clôture mensuelle</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={closeModal} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {/* Contenu défilant : le mode « je ne sais pas » ajoute une date, un champ par compte
                et un curseur — sur un petit écran, la feuille dépassait sans qu'on puisse atteindre
                le bouton. */}
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">

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
                {/* Le parcours est annoncé AVANT d'être parcouru. Sans ça, l'écran s'ouvrait sur
                    deux champs et un bouton « Clôturer » : rien ne laissait deviner qu'une étape de
                    répartition allait surgir une fois les montants saisis, et on validait sans
                    l'avoir vue. Trois étapes numérotées, visibles d'emblée, dont la dernière
                    s'affiche en attente tant qu'elle ne peut pas être calculée. */}
                <Text style={styles.hint}>
                  Tu ne sais plus ce que valait ton compte fin {targetKey ? monthLabel(targetKey) : ''} ? Pas besoin de
                  le retrouver : donne le solde que tu as sous les yeux, et on remonte le temps ensemble.
                </Text>
                <View style={styles.stepsPreview}>
                  <Text style={styles.stepsPreviewText}>
                    <Text style={styles.stepsPreviewNum}>1.</Text> La date de ce solde{'  '}
                    <Text style={styles.stepsPreviewNum}>2.</Text> Le montant{'  '}
                    <Text style={styles.stepsPreviewNum}>3.</Text> À quel mois l'écart appartient
                  </Text>
                </View>

                <Text style={styles.stepLabel}>1 · Date de ce solde</Text>
                <TextInput
                  style={styles.input}
                  value={formatDateFrench(unknownDate)}
                  onChangeText={(v) => { const iso = parseDateFromFrench(v); if (iso) setUnknownDate(iso); }}
                  placeholder="jj-mm-aaaa"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.stepLabel}>
                  {checkingAccounts.length > 1 ? '2 · Solde de chaque compte à cette date' : '2 · Solde de ton compte à cette date'}
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

                <Text style={styles.stepLabel}>3 · À quel mois appartient l'écart ?</Text>
                {/* Répartition — la position de départ est le prorata par jours, mais c'est
                    l'utilisateur qui tranche : lui seul sait si l'écart vient de juillet ou d'août.
                    Pas de Slider natif dans l'app → 5 crans, tapables.
                    L'étape reste AFFICHÉE en attente tant qu'on ne peut pas la calculer : c'est ce
                    qui la rend prévisible au lieu de la faire surgir après coup. */}
                {(() => {
                  const firstAcc = checkingAccounts[0];
                  if (!firstAcc) return null;
                  const totalGap = unknownTotalGap();

                  if (!hasAnyAmount) {
                    return (
                      <View style={styles.splitPending}>
                        <Ionicons name="hourglass-outline" size={15} color={COLORS.textSecondary} />
                        <Text style={styles.splitPendingText}>
                          Saisis un solde ci-dessus : on calcule l'écart, et tu diras ici ce qui revient
                          à {targetKey ? monthLabel(targetKey) : 'ce mois'} et ce qui revient au mois en cours.
                        </Text>
                      </View>
                    );
                  }
                  if (Math.abs(totalGap) < 0.005) {
                    return (
                      <View style={styles.splitPending}>
                        <Ionicons name="checkmark-circle-outline" size={15} color={COLORS.emerald} />
                        <Text style={[styles.splitPendingText, { color: COLORS.emerald }]}>
                          Aucun écart : ce que tu as saisi correspond exactement à ce que Relyka avait
                          calculé. Rien à répartir.
                        </Text>
                      </View>
                    );
                  }

                  const pct = unknownSharePct(firstAcc.id);
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
              } else if (mode === 'unknown') {
                /* ⚠️ Le mode « je ne sais pas » a sa PROPRE arithmétique : l'écart se mesure contre
                   le solde à `unknownDate`, et se répartit selon le curseur choisi plus haut.
                   L'aperçu appliquait ici la formule du mode « solde réel » (écart contre la FIN DU
                   MOIS, réparti au prorata des jours) : il annonçait donc un montant différent de
                   celui affiché quelques lignes plus haut — parfois de signe opposé. Deux réponses
                   contradictoires à la même question, dans la même fenêtre. */
                if (!hasAnyAmount) return null;
                /* Réparti COMPTE PAR COMPTE, comme le fera `confirm()`. Tant que le curseur n'a pas
                   été touché, chaque compte reçoit son propre prorata (il dépend de sa dernière
                   vérification) : appliquer le pourcentage du premier compte à la somme donnerait un
                   aperçu faux dès qu'il y a deux comptes aux historiques différents. */
                let closingTotal = 0, currentTotal = 0;
                for (const acc of checkingAccounts) {
                  const gap = unknownGapOf(acc);
                  if (Math.abs(gap) <= 0.005) continue;
                  const part = gap * (unknownSharePct(acc.id) / 100);
                  closingTotal += part;
                  currentTotal += gap - part;
                }
                rows.push({ label: monthLabel(targetKey), regul: closingTotal, closed: true });
                if (Math.abs(currentTotal) > 0.005) rows.push({ label: monthLabel(ym(new Date())), regul: currentTotal });
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
            {/* Le bouton reste HORS du défilement : il doit être atteignable sans dérouler.
                SafeAreaView NATIF (edges bottom) : il mesure les insets de SA fenêtre — celle du
                Modal — donc le bouton reste au-dessus de la barre de navigation du téléphone. */}
            <SafeAreaView edges={['bottom']}>
              {/* Un mode qui réclame un montant et n'en a pas ne clôture RIEN : `confirm()` saute
                  chaque compte vide et se contente de fermer le mois, sans la moindre vérification.
                  L'utilisateur croyait avoir donné son solde. On bloque donc le bouton, et on dit
                  ce qui manque plutôt que de laisser valider un geste creux. */}
              {needsAmount && !hasAnyAmount && (
                <Text style={styles.confirmHint}>
                  Saisis d'abord {checkingAccounts.length > 1 ? 'au moins un solde' : 'ton solde'} ci-dessus.
                </Text>
              )}
              <TouchableOpacity
                style={[styles.confirmBtn, (busy || (needsAmount && !hasAnyAmount)) && { opacity: 0.45 }]}
                onPress={() => { setError(null); confirm(); }}
                disabled={busy || (needsAmount && !hasAnyAmount)}
              >
                {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.confirmText}>Clôturer{flash ? ' tout' : ''}</Text>}
              </TouchableOpacity>
              {/* Échappatoire assumée : clôturer demande d'avoir ses relevés sous les yeux, ce qui
                  n'est pas toujours le cas au moment où l'app s'ouvre. Sans elle, la seule sortie
                  était la croix — qui ne mémorise rien et ramène la modale à l'ouverture suivante. */}
              <TouchableOpacity
                style={styles.laterBtn}
                onPress={snoozeAndClose}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Me le rappeler demain"
              >
                <Text style={styles.laterText}>Me le rappeler demain</Text>
              </TouchableOpacity>
            </SafeAreaView>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Pop-up de bilan éphémère — masquée en consultation admin (ne pas consommer le bilan du compte cible) */}
      <ClosureBilanModal
        visible={!isImpersonating && !!bilan}
        surplus={bilan?.surplus ?? 0}
        formatAmount={fmt}
        onClose={() => markBilanSeen.mutate()}
        colors={COLORS}
      />
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
    // paddingBottom réduit : c'est le SafeAreaView du pied qui ajoute désormais la hauteur réelle de
    // la barre système. Cumuler les deux repoussait le bouton hors de l'écran sur les petits mobiles.
    sheet: {
      ...sheetWidth, maxHeight: '92%',
      backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 16, gap: 6,
    },
    /* Le défilement absorbe TOUT le rétrécissement : `flexGrow: 0` (ne pousse pas le pied vers le bas
       quand le contenu est court) + `flexShrink: 1` (cède la place au pied quand il est long). Sans
       ça, la ScrollView web garde sa hauteur de contenu et chasse le bouton hors du cadre. */
    scroll: { flexGrow: 0, flexShrink: 1 },
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

    /* Mode « je ne sais pas » — le parcours annoncé d'avance, puis chaque étape numérotée. */
    stepsPreview: {
      marginTop: 10, marginBottom: 2, paddingVertical: 8, paddingHorizontal: 11,
      borderRadius: 10, backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '33',
    },
    stepsPreviewText: { fontSize: 11.5, color: c.textSecondary, lineHeight: 18 },
    stepsPreviewNum: { fontWeight: '800', color: c.emerald },
    stepLabel: { fontSize: 13, fontWeight: '800', color: c.text, marginTop: 16, marginBottom: 6 },
    /* L'étape 3 en attente : visible mais inactive, pour qu'on sache qu'elle vient. */
    splitPending: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
      borderColor: c.cardBorder, backgroundColor: c.card, marginBottom: 10,
    },
    splitPendingText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

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
    segRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
    // `justifyContent: center` + libellé centré : à trois segments sur un écran de téléphone, un
    // libellé qui passe sur deux lignes reste lisible et tous les boutons gardent la même hauteur.
    seg: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    segActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    segText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, textAlign: 'center' },
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
    confirmHint: { fontSize: 11.5, color: c.textSecondary, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
    confirmBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
    confirmText: { fontSize: 16, fontWeight: '700', color: c.bg },
    // Volontairement discret : c'est une sortie, pas une action concurrente de la clôture.
    laterBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
    laterText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  });
}
