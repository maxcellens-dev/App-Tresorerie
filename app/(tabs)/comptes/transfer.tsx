import { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import CalculatorButton from '../../../components/CalculatorButton';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts } from '../../../hooks/useAccounts';
import { createTransferLegs, useAddTransaction, useDeleteTransaction, useReleaseReservedByProject, useTransactions } from '../../../hooks/useTransactions';
import { computeContributed } from '../../../lib/contributed';
import { useResetPreSaving } from '../../../hooks/usePreSavings';
import ScreenHeader from '../../../components/ScreenHeader';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../../lib/dateUtils';
import type { RecurrenceRule, PreSavingType } from '../../../types/database';
import type { RecoType } from '../../../lib/recommendationEngine';
import { useRecoDismissals } from '../../../hooks/useUiPrefs';
import { useAppColors } from '../../../hooks/useAppColors';
import { currencySymbolFor, convertAmount } from '../../../lib/currency';
import { useCurrencyRates } from '../../../hooks/useCurrencyRates';
import { useKeyboardAwareScroll } from '../../../hooks/useKeyboardAwareScroll';


export default function TransferScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { scrollRef, handleFocus, onScroll } = useKeyboardAwareScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{
    from?: string; to?: string; amount?: string; label?: string; date?: string;
    destType?: string; recoComplete?: string; resetPreSaving?: string; origin?: string;
    releaseProject?: string;
  }>();
  const { user } = useAuth();
  const { data: allAccounts = [] } = useAllAccounts(user?.id);
  // On ne peut virer que vers/depuis des comptes où l'on a le droit d'ÉCRIRE (perso, joint, ou partagé
  // en écriture) — pas les comptes reçus en consultation seule.
  const accounts = allAccounts.filter((a) => a._role !== 'read');
  const { data: allTransactions = [] } = useTransactions(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  const deleteTransaction = useDeleteTransaction(user?.id);
  const resetPreSaving = useResetPreSaving(user?.id);
  const releaseReserved = useReleaseReservedByProject(user?.id);

  // Filtre du compte cible : si destType fourni (depuis une reco), n'autoriser que ce type
  const destAccounts = params.destType
    ? accounts.filter((a) => a.type === params.destType)
    : accounts;

  const [fromAccountId, setFromAccountId] = useState(params.from || '');
  const [toAccountId, setToAccountId] = useState(params.to || '');
  const [amount, setAmount] = useState(params.amount || '');
  // Virement cross-devises : montant réellement reçu sur la destination (devise dest).
  const [amountTo, setAmountTo] = useState('');
  const amountToTouched = useRef(false);
  const [date, setDate] = useState(params.date || todayISO());
  const [dateDisplay, setDateDisplay] = useState(formatDateFrench(params.date || todayISO()));
  const [note, setNote] = useState(params.label || 'Virement interne');
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end'>(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState('');
  // Saisie en 2 étapes (style banque). Si les comptes sont préremplis (depuis une reco), on va direct à l'étape 2.
  const [step, setStep] = useState<1 | 2>(params.from && params.to ? 2 : 1);

  // Taux pour pré-remplir le montant reçu en cross-devises (modifiable ensuite par l'utilisateur).
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  useEffect(() => {
    const fromC = accounts.find((a) => a.id === fromAccountId)?.currency || 'EUR';
    const toC = accounts.find((a) => a.id === toAccountId)?.currency || 'EUR';
    if (fromC === toC) return;                 // mono-devise : pas de 2ᵉ champ
    if (amountToTouched.current) return;        // l'utilisateur a saisi son vrai montant reçu
    const n = parseFloat((amount || '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { setAmountTo(''); return; }
    const conv = convertAmount(n, fromC, toC, rates);
    setAmountTo(conv != null ? conv.toFixed(2) : '');
  }, [amount, fromAccountId, toAccountId, accounts, rates]);

  function goNext() {
    if (!fromAccountId) { Alert.alert('Compte source requis', 'Choisissez un compte source.'); return; }
    if (!toAccountId) { Alert.alert('Compte cible requis', 'Choisissez un compte cible.'); return; }
    if (fromAccountId === toAccountId) { Alert.alert('Comptes différents', 'Le compte source et le compte cible doivent être différents.'); return; }
    setStep(2);
  }

  // Re-synchroniser depuis les params à chaque navigation (l'écran peut être réutilisé
  // entre onglets, auquel cas les valeurs initiales de useState ne se réappliquent pas).
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = [params.from, params.to, params.amount, params.label, params.date, params.destType, params.recoComplete, params.resetPreSaving].join('|');
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (params.from !== undefined) setFromAccountId(params.from);
    if (params.to !== undefined) setToAccountId(params.to);
    if (params.amount !== undefined) setAmount(params.amount);
    if (params.label !== undefined) setNote(params.label);
    if (params.date !== undefined) { setDate(params.date); setDateDisplay(formatDateFrench(params.date)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.from, params.to, params.amount, params.label, params.date, params.destType, params.recoComplete, params.resetPreSaving]);

  // Retour robuste. Quand on arrive ici depuis le Pilotage (reco/cumul), c'est une navigation
  // INTER-ONGLETS : router.back() dépilerait dans l'onglet « Comptes » (→ atterrit sur Comptes)
  // au lieu de revenir au Pilotage. On honore donc l'origine explicite EN PREMIER.
  function goBack() {
    if (params.origin === 'pilotage') { router.replace('/(tabs)/pilotage' as any); return; }
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/(tabs)/comptes' as any);
  }

  async function handleSubmit() {
    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num <= 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant positif.');
      return;
    }
    if (!fromAccountId || !toAccountId) {
      Alert.alert('Comptes requis', 'Choisissez le compte source et le compte cible.');
      return;
    }
    if (fromAccountId === toAccountId) {
      Alert.alert('Comptes différents', 'Le compte source et le compte cible doivent être différents.');
      return;
    }
    // Cross-devises : comptes de devises différentes → jambes ASYMÉTRIQUES (−num sur la source /
    // +numTo sur la destination). numTo = montant réellement crédité (saisi, pré-rempli au taux).
    const fromCur = accounts.find((a) => a.id === fromAccountId)?.currency || 'EUR';
    const dstAcc = accounts.find((a) => a.id === toAccountId);
    const toCur = dstAcc?.currency || 'EUR';
    const cross = fromCur !== toCur;
    let numTo = num;
    if (cross) {
      numTo = parseFloat(amountTo.replace(',', '.'));
      if (Number.isNaN(numTo) || numTo <= 0) {
        Alert.alert('Montant reçu requis', `Saisissez le montant réellement crédité sur « ${dstAcc?.name ?? 'la destination'} » (en ${toCur}).`);
        return;
      }
      if (isRecurring) {
        Alert.alert('Récurrence indisponible', 'Un virement récurrent doit relier deux comptes de la même devise (les taux de change varient dans le temps).');
        return;
      }
    }

    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;

    // Atomicité (2 jambes + rollback) centralisée dans createTransferLegs — logique unique
    // partagée avec l'écran « Ajouter une transaction ».
    try {
      await createTransferLegs(addTransaction, deleteTransaction, {
        fromAccountId,
        toAccountId,
        amount: num,
        amountTo: cross ? numTo : undefined,
        date,
        noteFrom: note || 'Virement interne',
        noteTo: note || 'Virement interne',
        isRecurring,
        recurrenceRule,
        recurrenceEndDate: endDateISO,
        checkRegulConflict: true,
      });
      // L'apport « actuel » est dérivé des transactions (cf. computeContributed) :
      // l'ajout/suppression d'un virement est donc automatiquement répercuté, rien à mettre à jour ici.

      // Virement validé depuis une reco : on NE la marque PAS « traitée ». Le montant viré est
      // déjà compté dans le suivi du mois (alreadyAllocated) → la reco se réduit naturellement du
      // montant placé et réapparaît diminuée si un reste subsiste (ou pour le mois ciblé si futur).
      // Virement global d'un cumul → remettre le cumul à 0
      if (params.resetPreSaving) {
        await resetPreSaving.mutateAsync(params.resetPreSaving as PreSavingType);
      }
      // Virement issu d'un montant réservé de projet → libérer (supprimer) les brouillons réservés
      if (params.releaseProject) {
        await releaseReserved.mutateAsync(params.releaseProject);
      }
      goBack();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’effectuer le virement.');
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={[]}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.text}>Connectez-vous pour effectuer un virement.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Retrait d'un compte d'investissement : règle du prorata (capital vs plus-value) ──
  // Virement mono-devise (Phase 1) → tout est dans la devise du compte source.
  const fmtEur = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + currencySymbolFor(fromAcc?.currency);
  const fromAcc = accounts.find((a) => a.id === fromAccountId);
  const toAcc = accounts.find((a) => a.id === toAccountId);
  // Cross-devises : comptes de devises différentes → on affiche un 2ᵉ champ « montant reçu ».
  const isCross = !!fromAcc && !!toAcc && (fromAcc.currency || 'EUR') !== (toAcc.currency || 'EUR');
  const withdrawalNum = parseFloat((amount || '').replace(',', '.'));
  const fromApport = fromAcc ? computeContributed(fromAcc, allTransactions as any) : null;
  const isInvestWithdrawal = fromAcc?.type === 'investment' && fromApport != null && !isRecurring;
  let prorata: { capital: number; plus: number; remainingApport: number; remainingBalance: number; capitalPct: number } | null = null;
  if (isInvestWithdrawal && fromAcc && fromApport != null && fromAcc.balance > 0 && withdrawalNum > 0) {
    const ratio = Math.min(1, fromApport / fromAcc.balance);
    const capital = withdrawalNum * ratio;
    prorata = {
      capital,
      plus: withdrawalNum - capital,
      remainingApport: Math.max(0, fromApport - capital),
      remainingBalance: fromAcc.balance - withdrawalNum,
      capitalPct: Math.round(ratio * 100),
    };
  }

  const canSubmit =
    fromAccountId &&
    toAccountId &&
    fromAccountId !== toAccountId &&
    amount &&
    parseFloat(amount.replace(',', '.')) > 0 &&
    !addTransaction.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScreenHeader title="Virement entre comptes" onBack={goBack} />
        <Text style={styles.subtitle}>Débit sur un compte, crédit sur un autre. Les soldes sont mis à jour.</Text>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          {/* Fil d'étapes */}
          <View style={styles.stepsRow}>
            <View style={[styles.stepDot, styles.stepDotActive]}><Text style={styles.stepDotText}>1</Text></View>
            <View style={[styles.stepBar, step >= 2 && styles.stepBarActive]} />
            <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]}><Text style={[styles.stepDotText, step < 2 && { color: COLORS.textSecondary }]}>2</Text></View>
          </View>
          <Text style={styles.stepTitle}>{step === 1 ? 'De quel compte vers quel compte ?' : 'Montant, date et libellé'}</Text>

          {step === 1 ? (
          <>
          <Text style={styles.label}>Compte source (débit)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.chip, fromAccountId === acc.id && styles.chipActive]}
                onPress={() => setFromAccountId(acc.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, fromAccountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
                <Text style={[styles.chipSubtext, fromAccountId === acc.id && styles.chipSubtextActive]}>
                  {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {accounts.length === 0 && (
            <Text style={styles.hint}>Aucun compte. Ajoutez-en un depuis l’onglet Comptes.</Text>
          )}

          <Text style={styles.label}>Compte cible (crédit)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {destAccounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.chip, toAccountId === acc.id && styles.chipActive]}
                onPress={() => setToAccountId(acc.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, toAccountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
                <Text style={[styles.chipSubtext, toAccountId === acc.id && styles.chipSubtextActive]}>
                  {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {params.destType && destAccounts.length === 0 && (
            <Text style={styles.hint}>
              Aucun compte {params.destType === 'savings' ? 'épargne' : params.destType === 'investment' ? 'investissement' : ''}. Créez-en un depuis l’onglet Comptes.
            </Text>
          )}

          <TouchableOpacity style={[styles.submitBtn, { marginTop: 8 }]} onPress={goNext} accessibilityRole="button">
            <Text style={styles.submitLabel}>Suivant</Text>
          </TouchableOpacity>
          </>
          ) : (
          <>
          <TouchableOpacity style={styles.prevLink} onPress={() => setStep(1)} accessibilityRole="button">
            <Ionicons name="chevron-back" size={16} color={COLORS.emerald} />
            <Text style={styles.prevLinkText}>Étape précédente</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Montant {isCross ? 'envoyé ' : ''}({currencySymbolFor(fromAcc?.currency)})</Text>
          <TextInput
            style={styles.input}
            value={amount}
            // Changer le montant ENVOYÉ ré-active la proposition automatique du montant reçu
            // (au taux) → évite de garder un « reçu » figé, devenu incohérent, par oubli.
            onChangeText={(v) => { amountToTouched.current = false; setAmount(v); }}
            onFocus={handleFocus}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
          />

          {isCross && (
            <>
              <Text style={styles.label}>Montant reçu ({currencySymbolFor(toAcc?.currency)})</Text>
              <TextInput
                style={styles.input}
                value={amountTo}
                onChangeText={(v) => { amountToTouched.current = true; setAmountTo(v); }}
                onFocus={handleFocus}
                placeholder="0,00"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="decimal-pad"
              />
              <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: -10, marginBottom: 16, lineHeight: 17 }}>
                Proposé au taux du jour. Ajuste-le avec le montant RÉELLEMENT crédité sur ton relevé ({currencySymbolFor(fromAcc?.currency)} → {currencySymbolFor(toAcc?.currency)}).
              </Text>
            </>
          )}

          {prorata && (
            <View style={styles.withdrawCard}>
              <View style={styles.withdrawHeader}>
                <Ionicons name="trending-down-outline" size={18} color={COLORS.orange} />
                <Text style={styles.withdrawTitle}>Retrait d'un compte d'investissement</Text>
              </View>
              <Text style={styles.withdrawText}>
                Règle du prorata : ce retrait se compose de <Text style={styles.withdrawStrong}>{prorata.capitalPct}% de capital</Text> ({fmtEur(prorata.capital)}) et {100 - prorata.capitalPct}% de plus-value ({fmtEur(prorata.plus)}).
              </Text>
              <View style={styles.withdrawRow}>
                <Text style={styles.withdrawLabel}>Apport restant</Text>
                <Text style={styles.withdrawVal}>{fmtEur(prorata.remainingApport)}</Text>
              </View>
              <View style={styles.withdrawRow}>
                <Text style={styles.withdrawLabel}>Solde restant</Text>
                <Text style={styles.withdrawVal}>{fmtEur(prorata.remainingBalance)}</Text>
              </View>
            </View>
          )}

          <Text style={styles.label}>Date</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={dateDisplay}
              onChangeText={(text) => {
                setDateDisplay(text);
                const parsed = parseDateFromFrench(text);
                if (parsed) setDate(parsed);
              }}
              onBlur={() => { if (date) setDateDisplay(formatDateFrench(date)); }}
              onFocus={handleFocus}
              placeholder="jj-mm-aaaa"
              placeholderTextColor={COLORS.textSecondary}
            />
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => setShowCalendar('date')}
            >
              <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            onFocus={handleFocus}
            placeholder="Ex. Virement interne"
            placeholderTextColor={COLORS.textSecondary}
          />

          {/* Récurrence */}
          <View style={styles.recurringSection}>
            <TouchableOpacity
              style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>Virement récurrent</Text>
            </TouchableOpacity>
            {isRecurring && (
              <>
                <Text style={styles.label}>Période</Text>
                <View style={styles.chipRow}>
                  {(['weekly', 'monthly', 'quarterly', 'yearly'] as RecurrenceRule[]).map((rule) => (
                    <TouchableOpacity
                      key={rule}
                      style={[styles.chip, recurrenceRule === rule && styles.chipActive]}
                      onPress={() => setRecurrenceRule(rule)}
                    >
                      <Text style={[styles.chipText, recurrenceRule === rule && styles.chipTextActive]}>
                        {rule === 'weekly' ? 'Hebdo' : rule === 'monthly' ? 'Mensuel' : rule === 'quarterly' ? 'Trim.' : 'Annuel'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>Fin (optionnel, vide = sans fin)</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={recurrenceEndDateInput}
                    onChangeText={setRecurrenceEndDateInput}
                    onFocus={handleFocus}
                    placeholder="jj-mm-aaaa ou vide"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowCalendar('end')}>
                    <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, (!canSubmit || addTransaction.isPending) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || addTransaction.isPending}
            accessibilityRole="button"
          >
            {addTransaction.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.submitLabel}>Effectuer le virement</Text>
            )}
          </TouchableOpacity>
          </>
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
                textSecondaryColor="#334155"
              />
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
      <CalculatorButton />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24 },
  stepsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
  stepDotActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  stepDotText: { fontSize: 13, fontWeight: '800', color: c.bg },
  stepBar: { width: 60, height: 2, backgroundColor: c.cardBorder },
  stepBarActive: { backgroundColor: c.emerald },
  stepTitle: { fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 20 },
  prevLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 14 },
  prevLinkText: { fontSize: 14, fontWeight: '700', color: c.emerald },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
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
  withdrawCard: { backgroundColor: c.orange + '14', borderWidth: 1, borderColor: c.orange + '55', borderRadius: 12, padding: 14, marginBottom: 20 },
  withdrawHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  withdrawTitle: { fontSize: 14, fontWeight: '800', color: c.text },
  withdrawText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginBottom: 10 },
  withdrawStrong: { fontWeight: '700', color: c.text },
  withdrawRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  withdrawLabel: { fontSize: 13, color: c.textSecondary },
  withdrawVal: { fontSize: 15, fontWeight: '800', color: c.text },
  chipScroll: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  chipSubtext: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  chipSubtextActive: { color: c.bg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  recurringSection: { marginTop: 4, marginBottom: 8 },
  recurringToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  recurringToggleActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  recurringLabel: { fontSize: 15, color: c.textSecondary },
  recurringLabelActive: { color: c.bg, fontWeight: '600' },
  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 16 },
  text: { color: c.text, marginBottom: 16 },
  btn: {
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 12,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  btnLabel: { color: c.text, fontWeight: '600' },
  submitBtn: {
    backgroundColor: c.emerald,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: c.bg, textAlign: 'center' },
  calendarBtn: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  calendarContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    overflow: 'hidden',
    padding: 8,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
});
}
