/**
 * Création d'un crédit (module Crédit, Lot C2 + raffinements).
 * Saisie des paramètres (avec calendrier pour les dates), frais détaillés, et montants ANNUELS
 * (assurance + mensualité qui peuvent évoluer chaque année). Prévisualise l'amortissement.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import { useAppColors } from '../../../hooks/useAppColors';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts } from '../../../hooks/useAccounts';
import { useProjects } from '../../../hooks/useProjects';
import { useAddCredit, useCredits, useUpdateCredit } from '../../../hooks/useCredits';
import { computeAmortization, resolvePaliers } from '../../../lib/amortization';
import { todayISO, formatDateFrench } from '../../../lib/dateUtils';
import type { CreditType } from '../../../types/database';

const TYPES: { key: CreditType; label: string; icon: string }[] = [
  { key: 'immobilier', label: 'Immobilier', icon: 'home-outline' },
  { key: 'consommation', label: 'Consommation', icon: 'cart-outline' },
  { key: 'auto', label: 'Crédit auto', icon: 'car-outline' },
  { key: 'autre', label: 'Autre', icon: 'ellipsis-horizontal' },
];

// Frais COMPTÉS dans le coût du prêt (s'ajoutent aux intérêts).
const LOAN_FEES: { key: string; label: string }[] = [
  { key: 'fees_guarantee', label: 'Frais de garantie' },
  { key: 'fees_notary', label: 'Frais de notaire' },
  { key: 'interim_interest', label: 'Intérêts intercalaires' },
  { key: 'management_fees', label: 'Intérêts de gestion' },
];
// Frais à payer À PART (hors coût du prêt / mensualité).
const EXTRA_FEES: { key: string; label: string }[] = [
  { key: 'fees_file', label: 'Frais de dossier' },
  { key: 'fees_bank', label: 'Frais de banque' },
  { key: 'other_fees', label: 'Autres frais' },
];

export default function CreditAddScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ simulation?: string; id?: string; shared?: string }>();
  const editId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const addCredit = useAddCredit(user?.id);
  const updateCredit = useUpdateCredit(user?.id);
  const { data: allCredits = [] } = useCredits(user?.id);
  const editing = editId ? allCredits.find((c) => c.id === editId) : undefined;
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const checking = accounts.filter((a) => a.type === 'checking');
  const { data: projects = [] } = useProjects(user?.id);
  const activeProjects = projects.filter((p) => p.status === 'active');
  const [projectId, setProjectId] = useState<string | null>(null);

  const [type, setType] = useState<CreditType>('immobilier');
  const [label, setLabel] = useState('');
  const [lender, setLender] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [duration, setDuration] = useState('');
  const [insurance, setInsurance] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [insDate, setInsDate] = useState('');       // 1ʳᵉ échéance d'assurance (vide = même que remboursement)
  const [showInsCal, setShowInsCal] = useState(false);
  const [isSimulation, setIsSimulation] = useState(params.simulation === '1');
  const [fees, setFees] = useState<Record<string, string>>({});
  const [interestManual, setInterestManual] = useState('');
  const [showFees, setShowFees] = useState(false);
  const [showYearly, setShowYearly] = useState(false);
  const [insYear, setInsYear] = useState<Record<number, string>>({});
  const [payYear, setPayYear] = useState<Record<number, string>>({});
  // #8b — mensualité : standard (calculée) OU semi-fixe par paliers (auto-calc d'un palier à l'autre).
  const [paymentMode, setPaymentMode] = useState<'standard' | 'paliers'>('standard');
  const [segments, setSegments] = useState<{ startYear: number; payment: string }[]>([{ startYear: 0, payment: '' }]);
  // Assurance par paliers (montant mensuel FIXE par période).
  const [insMode, setInsMode] = useState<'flat' | 'paliers'>('flat');
  const [insSegments, setInsSegments] = useState<{ startYear: number; amount: string }[]>([{ startYear: 0, amount: '' }]);
  const [showCal, setShowCal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Édition : pré-remplir le formulaire une fois le crédit chargé.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!editing || prefilled) return;
    setType(editing.type); setLabel(editing.label); setLender(editing.lender ?? '');
    setAccountId(editing.account_id ?? null); setProjectId(editing.project_id ?? null);
    setPrincipal(String(editing.principal)); setRate(String(editing.rate_annual));
    setDuration(String(editing.duration_months)); setInsurance(editing.insurance_monthly ? String(editing.insurance_monthly) : '');
    setStartDate((editing.first_payment_date as string) || editing.start_date);
    if (editing.first_insurance_date) setInsDate(editing.first_insurance_date as string);
    setIsSimulation(editing.is_simulation);
    setFees({
      fees_file: String(editing.fees_file ?? ''), fees_bank: String(editing.fees_bank ?? ''), fees_notary: String(editing.fees_notary ?? ''),
      fees_guarantee: String(editing.fees_guarantee ?? ''), personal_contribution: String(editing.personal_contribution ?? ''),
      interim_interest: String(editing.interim_interest ?? ''), management_fees: String(editing.management_fees ?? ''), other_fees: String(editing.other_fees ?? ''),
    });
    if (editing.interest_total_manual != null) setInterestManual(String(editing.interest_total_manual));
    if (Array.isArray(editing.insurance_yearly) || Array.isArray(editing.payment_yearly)) {
      const ins: Record<number, string> = {}; const pay: Record<number, string> = {};
      (editing.insurance_yearly ?? []).forEach((v, i) => { if (v != null) ins[i] = String(v); });
      (editing.payment_yearly ?? []).forEach((v, i) => { if (v != null) pay[i] = String(v); });
      setInsYear(ins); setPayYear(pay); setShowYearly(true);
    }
    setPrefilled(true);
  }, [editing, prefilled]);

  const num = (s: string | undefined) => (s ? parseFloat(s.replace(',', '.')) : NaN);
  const numOr0 = (s: string | undefined) => { const v = num(s); return Number.isNaN(v) ? 0 : v; };
  const years = useMemo(() => { const n = parseInt(duration, 10); return n > 0 ? Math.ceil(n / 12) : 0; }, [duration]);

  // #8b — paliers résolus (mensualités auto-calculées d'un palier à l'autre).
  const paliers = useMemo(() => {
    const C = num(principal), n = parseInt(duration, 10), r = num(rate);
    if (paymentMode !== 'paliers' || !C || !n || Number.isNaN(C) || Number.isNaN(n)) return null;
    return resolvePaliers(C, Number.isNaN(r) ? 0 : r, n, segments.map((s) => ({ startYear: s.startYear, payment: num(s.payment) })));
  }, [paymentMode, segments, principal, duration, rate]);

  const buildInsArray = (): (number | null)[] =>
    Array.from({ length: years }, (_, y) => { const v = num(insYear[y]); return Number.isNaN(v) ? numOr0(insurance) : v; });
  const buildPayArray = (): (number | null)[] =>
    Array.from({ length: years }, (_, y) => { const v = num(payYear[y]); return Number.isNaN(v) || v <= 0 ? null : v; });
  // Assurance par paliers : chaque année prend le montant du palier actif (montant FIXE, pas d'auto-calc).
  const buildInsFromSegments = (): (number | null)[] => {
    const sorted = [...insSegments].sort((a, b) => a.startYear - b.startYear);
    return Array.from({ length: years }, (_, y) => {
      let amt = numOr0(insurance);
      for (const s of sorted) { if (s.startYear <= y) amt = numOr0(s.amount); }
      return amt;
    });
  };
  // payment_yearly effectif : paliers (si actif) sinon l'éditeur par année.
  const effPaymentYearly = (): (number | null)[] | null =>
    paymentMode === 'paliers' && paliers ? paliers.paymentYearly : (showYearly && years > 0 ? buildPayArray() : null);
  const effInsuranceYearly = (): (number | null)[] | null =>
    insMode === 'paliers' && years > 0 ? buildInsFromSegments() : (showYearly && years > 0 ? buildInsArray() : null);

  const amort = useMemo(() => {
    const C = num(principal), n = parseInt(duration, 10), r = num(rate);
    if (!C || !n || Number.isNaN(C) || Number.isNaN(n)) return null;
    return computeAmortization({
      principal: C, rate_annual: Number.isNaN(r) ? 0 : r, duration_months: n,
      start_date: startDate, insurance_monthly: numOr0(insurance),
      insurance_yearly: effInsuranceYearly(),
      payment_yearly: effPaymentYearly(),
    });
  }, [principal, duration, rate, insurance, startDate, showYearly, insYear, payYear, years, paymentMode, paliers, insMode, insSegments]);

  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const stdPayment = amort ? Math.round(amort.monthlyPayment) : 0;

  const save = async () => {
    setError(null);
    const C = num(principal), n = parseInt(duration, 10);
    if (!label.trim()) return setError('Donne un libellé au crédit.');
    if (!C || C <= 0) return setError('Renseigne le capital emprunté.');
    if (!n || n <= 0) return setError('Renseigne la durée (en mois).');
    setSaving(true);
    const payload: any = {
      type, label: label.trim(), lender: lender.trim() || null, account_id: accountId, project_id: projectId,
      principal: C, duration_months: n, rate_annual: numOr0(rate), rate_type: 'fixe',
      insurance_monthly: numOr0(insurance), start_date: startDate, first_payment_date: startDate,
      is_simulation: isSimulation,
      fees_file: numOr0(fees.fees_file), fees_bank: numOr0(fees.fees_bank), fees_notary: numOr0(fees.fees_notary),
      fees_guarantee: numOr0(fees.fees_guarantee), personal_contribution: numOr0(fees.personal_contribution),
      interim_interest: numOr0(fees.interim_interest), management_fees: numOr0(fees.management_fees), other_fees: numOr0(fees.other_fees),
      insurance_yearly: effInsuranceYearly(),
      payment_yearly: effPaymentYearly(),
      // Colonnes des migrations récentes : envoyées seulement si renseignées → l'enregistrement ne casse
      // pas si une migration tarde (107 = interest_total_manual, 109 = first_insurance_date).
      ...(insDate ? { first_insurance_date: insDate } : {}),
      ...(!Number.isNaN(num(interestManual)) ? { interest_total_manual: num(interestManual) } : {}),
    };
    try {
      if (editId) { await updateCredit.mutateAsync({ id: editId, ...payload }); router.back(); }
      else {
        const created = await addCredit.mutateAsync({ ...payload, is_active: true });
        // Crédit « partagé » → on ouvre son détail pour envoyer les invitations.
        if (params.shared === '1' && created?.id) router.replace(`/(tabs)/comptes/credit/${created.id}` as any);
        else router.back();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Impossible d\'enregistrer.');
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenGradient />
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={editId ? 'Modifier le crédit' : 'Nouveau crédit'} onBack={() => router.back()} />
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBanner}><Ionicons name="alert-circle" size={16} color={COLORS.danger} /><Text style={styles.errorText}>{error}</Text></View>}

          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t.key} style={[styles.typeChip, type === t.key && styles.typeChipActive]} onPress={() => setType(t.key)}>
                <Ionicons name={t.icon as any} size={18} color={type === t.key ? COLORS.blue : COLORS.textSecondary} />
                <Text style={[styles.typeLabel, type === t.key && { color: COLORS.blue }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Libellé *</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Ex : Prêt résidence principale" placeholderTextColor={COLORS.textSecondary} />

          <Text style={styles.label}>Établissement prêteur</Text>
          <TextInput style={styles.input} value={lender} onChangeText={setLender} placeholder="Ex : Crédit Agricole" placeholderTextColor={COLORS.textSecondary} />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Capital emprunté (€) *</Text>
              <TextInput style={styles.input} value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" placeholder="200000" placeholderTextColor={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Durée (mois) *</Text>
              <TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="240" placeholderTextColor={COLORS.textSecondary} />
            </View>
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Taux annuel (%)</Text>
              <TextInput style={styles.input} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="3.5" placeholderTextColor={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Assurance (€/mois)</Text>
              <TextInput style={styles.input} value={insurance} onChangeText={setInsurance} keyboardType="decimal-pad" placeholder="30" placeholderTextColor={COLORS.textSecondary} />
            </View>
          </View>

          <Text style={styles.label}>Date de 1ʳᵉ échéance</Text>
          <TouchableOpacity style={[styles.input, styles.dateBtn]} onPress={() => setShowCal(true)} activeOpacity={0.7}>
            <Text style={{ color: COLORS.text, fontSize: 15 }}>{formatDateFrench(startDate)}</Text>
            <Ionicons name="calendar-outline" size={18} color={COLORS.blue} />
          </TouchableOpacity>

          {checking.length > 0 && (
            <>
              <Text style={styles.label}>Compte de prélèvement</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {checking.map((a) => (
                  <TouchableOpacity key={a.id} style={[styles.acctChip, accountId === a.id && styles.acctChipActive]} onPress={() => setAccountId(accountId === a.id ? null : a.id)}>
                    <Text style={[styles.acctChipText, accountId === a.id && { color: COLORS.blue }]}>{a.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* Affectation à un projet masquée pour le moment (peu utile). */}
          {false && activeProjects.length > 0 && (
            <>
              <Text style={styles.label}>Financer un projet (optionnel)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {activeProjects.map((p) => (
                  <TouchableOpacity key={p.id} style={[styles.acctChip, projectId === p.id && styles.acctChipActive]} onPress={() => setProjectId(projectId === p.id ? null : p.id)}>
                    <Text style={[styles.acctChipText, projectId === p.id && { color: COLORS.blue }]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* #5 — Frais & apport (repliable) : 2 groupes distincts + intérêts manuels. */}
          <TouchableOpacity style={styles.section} onPress={() => setShowFees((v) => !v)} activeOpacity={0.7}>
            <Ionicons name="receipt-outline" size={18} color={COLORS.text} />
            <Text style={styles.sectionTitle}>Frais & apport</Text>
            <Ionicons name={showFees ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {showFees && (
            <View style={{ gap: 8, marginTop: 4 }}>
              {/* Intérêts : calculés depuis le taux, bypassables manuellement. */}
              <View style={styles.feeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.feeLabel}>Intérêts (total)</Text>
                  <Text style={styles.feeSubHint}>Calculé : {amort ? fmt(amort.totalInterest) : '—'}. Laisse vide pour l'auto.</Text>
                </View>
                <TextInput style={styles.feeInput} value={interestManual} onChangeText={setInterestManual} keyboardType="decimal-pad" placeholder={amort ? String(Math.round(amort.totalInterest)) : '0'} placeholderTextColor={COLORS.textSecondary} />
              </View>

              <Text style={styles.feeGroup}>Intérêts & frais du prêt <Text style={styles.feeGroupHint}>(comptés dans le coût du prêt)</Text></Text>
              {LOAN_FEES.map((f) => (
                <View key={f.key} style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{f.label}</Text>
                  <TextInput style={styles.feeInput} value={fees[f.key] ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, [f.key]: v }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
                </View>
              ))}

              <Text style={styles.feeGroup}>Frais à payer à part <Text style={styles.feeGroupHint}>(hors coût du prêt)</Text></Text>
              {EXTRA_FEES.map((f) => (
                <View key={f.key} style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{f.label}</Text>
                  <TextInput style={styles.feeInput} value={fees[f.key] ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, [f.key]: v }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
                </View>
              ))}

              <Text style={styles.feeGroup}>Apport</Text>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Apport personnel</Text>
                <TextInput style={styles.feeInput} value={fees.personal_contribution ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, personal_contribution: v }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
              </View>
            </View>
          )}

          {/* #8b — Mensualité : standard (calculée) OU semi-fixe par paliers (auto-calculés). */}
          {years > 0 && (
            <>
              <View style={styles.section}>
                <Ionicons name="trending-up-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Mensualité</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {([['standard', 'Calculée'], ['paliers', 'Par paliers']] as const).map(([m, lbl]) => (
                  <TouchableOpacity key={m} style={[styles.modeChip, paymentMode === m && styles.modeChipActive]} onPress={() => setPaymentMode(m)}>
                    <Text style={[styles.modeText, paymentMode === m && { color: COLORS.blue }]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {paymentMode === 'paliers' && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.hint}>Mensualité FIXE par période. Laisse une mensualité vide → calcul auto pour solder le prêt sur la durée restante.</Text>
                  {segments.map((s, i) => (
                    <View key={i} style={styles.segRow}>
                      <Text style={styles.segFrom}>À partir de l'an</Text>
                      <TextInput
                        style={styles.segYear} keyboardType="number-pad"
                        value={i === 0 ? '1' : String(s.startYear + 1)} editable={i !== 0}
                        onChangeText={(v) => { const y = Math.max(1, parseInt(v, 10) || 1) - 1; setSegments((p) => p.map((seg, j) => j === i ? { ...seg, startYear: y } : seg)); }}
                      />
                      <TextInput
                        style={styles.segPay} keyboardType="decimal-pad"
                        value={s.payment} onChangeText={(v) => setSegments((p) => p.map((seg, j) => j === i ? { ...seg, payment: v } : seg))}
                        placeholder={paliers ? String(paliers.resolved[i] ?? '') + ' (auto)' : 'auto'} placeholderTextColor={COLORS.textSecondary}
                      />
                      {i > 0 && (
                        <TouchableOpacity onPress={() => setSegments((p) => p.filter((_, j) => j !== i))}><Ionicons name="close-circle" size={20} color={COLORS.danger} /></TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.segAdd} onPress={() => setSegments((p) => [...p, { startYear: Math.min(years - 1, (p[p.length - 1]?.startYear ?? 0) + 1), payment: '' }])}>
                    <Ionicons name="add" size={16} color={COLORS.blue} />
                    <Text style={styles.segAddText}>Ajouter un palier</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Assurance : fixe OU par paliers (montant mensuel fixe par période). */}
              <View style={styles.section}>
                <Ionicons name="shield-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Assurance</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {([['flat', 'Fixe'], ['paliers', 'Par paliers']] as const).map(([m, lbl]) => (
                  <TouchableOpacity key={m} style={[styles.modeChip, insMode === m && styles.modeChipActive]} onPress={() => setInsMode(m)}>
                    <Text style={[styles.modeText, insMode === m && { color: COLORS.blue }]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Date de 1ʳᵉ échéance d'assurance (peut différer du remboursement). */}
              <Text style={styles.label}>1ʳᵉ échéance d'assurance</Text>
              <TouchableOpacity style={[styles.input, styles.dateBtn]} onPress={() => setShowInsCal(true)} activeOpacity={0.7}>
                <Text style={{ color: insDate ? COLORS.text : COLORS.textSecondary, fontSize: 15 }}>
                  {insDate ? formatDateFrench(insDate) : `Même que le remboursement (${formatDateFrench(startDate)})`}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={COLORS.blue} />
              </TouchableOpacity>
              {insMode === 'paliers' && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.hint}>Assurance mensuelle FIXE par période (vide = montant « Assurance (€/mois) » saisi plus haut).</Text>
                  {insSegments.map((s, i) => (
                    <View key={i} style={styles.segRow}>
                      <Text style={styles.segFrom}>À partir de l'an</Text>
                      <TextInput
                        style={styles.segYear} keyboardType="number-pad"
                        value={i === 0 ? '1' : String(s.startYear + 1)} editable={i !== 0}
                        onChangeText={(v) => { const y = Math.max(1, parseInt(v, 10) || 1) - 1; setInsSegments((p) => p.map((seg, j) => j === i ? { ...seg, startYear: y } : seg)); }}
                      />
                      <TextInput
                        style={styles.segPay} keyboardType="decimal-pad"
                        value={s.amount} onChangeText={(v) => setInsSegments((p) => p.map((seg, j) => j === i ? { ...seg, amount: v } : seg))}
                        placeholder={insurance || '0'} placeholderTextColor={COLORS.textSecondary}
                      />
                      {i > 0 && (
                        <TouchableOpacity onPress={() => setInsSegments((p) => p.filter((_, j) => j !== i))}><Ionicons name="close-circle" size={20} color={COLORS.danger} /></TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.segAdd} onPress={() => setInsSegments((p) => [...p, { startYear: Math.min(years - 1, (p[p.length - 1]?.startYear ?? 0) + 1), amount: '' }])}>
                    <Ionicons name="add" size={16} color={COLORS.blue} />
                    <Text style={styles.segAddText}>Ajouter un palier</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.section} onPress={() => setShowYearly((v) => !v)} activeOpacity={0.7}>
                <Ionicons name="calendar-number-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Montants par année ({years} ans)</Text>
                <Ionicons name={showYearly ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showYearly && (
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.hint}>Vide = valeur standard (mensualité calculée, assurance ci-dessus). Renseigne pour faire varier une année.</Text>
                  <View style={[styles.yRow, { borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder }]}>
                    <Text style={[styles.yHead, { width: 48 }]}>Année</Text>
                    <Text style={[styles.yHead, { flex: 1 }]}>Mensualité</Text>
                    <Text style={[styles.yHead, { flex: 1 }]}>Assurance</Text>
                  </View>
                  {Array.from({ length: years }, (_, y) => (
                    <View key={y} style={styles.yRow}>
                      <Text style={[styles.yYear, { width: 48 }]}>{y + 1}</Text>
                      <TextInput style={styles.yInput} value={payYear[y] ?? ''} onChangeText={(v) => setPayYear((p) => ({ ...p, [y]: v }))} keyboardType="decimal-pad" placeholder={stdPayment ? String(stdPayment) : '—'} placeholderTextColor={COLORS.textSecondary} />
                      <TextInput style={styles.yInput} value={insYear[y] ?? ''} onChangeText={(v) => setInsYear((p) => ({ ...p, [y]: v }))} keyboardType="decimal-pad" placeholder={insurance || '0'} placeholderTextColor={COLORS.textSecondary} />
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          <TouchableOpacity style={styles.simRow} onPress={() => setIsSimulation((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={isSimulation ? 'flask' : 'flask-outline'} size={20} color={isSimulation ? COLORS.orange : COLORS.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.simLabel}>Simulation</Text>
              <Text style={styles.simHint}>Scénario non signé. Activable → compté dans projection/trésorerie.</Text>
            </View>
            <View style={[styles.check, isSimulation && { backgroundColor: COLORS.orange, borderColor: COLORS.orange }]}>{isSimulation && <Ionicons name="checkmark" size={14} color={COLORS.bg} />}</View>
          </TouchableOpacity>

          {amort && (() => {
            // #5 — décomposition des coûts.
            const interest = !Number.isNaN(num(interestManual)) ? num(interestManual) : amort.totalInterest;
            const loanFees = LOAN_FEES.reduce((s, f) => s + numOr0(fees[f.key]), 0);
            const extraFees = EXTRA_FEES.reduce((s, f) => s + numOr0(fees[f.key]), 0);
            const coutPret = interest + loanFees;                          // constitue la mensualité (hors assurance)
            const coutTotal = coutPret + amort.totalInsurance + extraFees; // 100% des coûts
            return (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>Estimation</Text>
                <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (hors assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyPayment)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (1ʳᵉ année, avec assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyWithInsurance)}</Text></View>
                <View style={[styles.previewRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.cardBorder, paddingTop: 8, marginTop: 2 }]}><Text style={styles.previewK}>Intérêts{!Number.isNaN(num(interestManual)) ? ' (manuel)' : ''}</Text><Text style={styles.previewV}>{fmt(interest)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Coût du prêt (intérêts + frais du prêt)</Text><Text style={styles.previewV}>{fmt(coutPret)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Coût total (tout compris)</Text><Text style={[styles.previewV, { color: COLORS.danger }]}>{fmt(coutTotal)}</Text></View>
              </View>
            );
          })()}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.saveLabel}>{editId ? 'Enregistrer les modifications' : 'Enregistrer le crédit'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* Calendrier (date de déblocage) */}
      <Modal visible={showCal} transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
        <View style={styles.calOverlay}>
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <TouchableOpacity onPress={() => setShowCal(false)}><Text style={{ color: COLORS.emerald, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
              <Text style={{ fontWeight: '700', color: COLORS.text }}>Date de 1ʳᵉ échéance</Text>
              <View style={{ width: 50 }} />
            </View>
            <CalendarWithPicker
              current={startDate}
              maxDate="2060-12-31"
              onDayPress={(day: any) => { setStartDate(day.dateString); setShowCal(false); }}
              markedDates={{ [startDate]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#fff' } }}
              accentColor={COLORS.blue}
            />
          </View>
        </View>
      </Modal>

      {/* Calendrier (1ʳᵉ échéance d'assurance) */}
      <Modal visible={showInsCal} transparent animationType="fade" onRequestClose={() => setShowInsCal(false)}>
        <View style={styles.calOverlay}>
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <TouchableOpacity onPress={() => { setInsDate(''); setShowInsCal(false); }}><Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>Réinit.</Text></TouchableOpacity>
              <Text style={{ fontWeight: '700', color: COLORS.text }}>1ʳᵉ échéance d'assurance</Text>
              <TouchableOpacity onPress={() => setShowInsCal(false)}><Text style={{ color: COLORS.emerald, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={insDate || startDate}
              maxDate="2060-12-31"
              onDayPress={(day: any) => { setInsDate(day.dateString); setShowInsCal(false); }}
              markedDates={{ [insDate || startDate]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#fff' } }}
              accentColor={COLORS.blue}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.danger + '14', borderWidth: 1, borderColor: c.danger + '44', borderRadius: 12, padding: 12, marginBottom: 12 },
    errorText: { color: c.danger, fontSize: 13, flex: 1 },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 12 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text },
    dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    row2: { flexDirection: 'row', gap: 12 },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    typeChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    typeLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    acctChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    acctChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    acctChipText: { fontSize: 13, fontWeight: '600', color: c.text },
    section: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    sectionTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: c.text },
    feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    feeLabel: { flex: 1, fontSize: 13.5, color: c.text },
    feeSubHint: { fontSize: 10.5, color: c.textSecondary, marginTop: 1 },
    feeGroup: { fontSize: 12, fontWeight: '800', color: c.text, marginTop: 8 },
    feeGroupHint: { fontSize: 11, fontWeight: '500', color: c.textSecondary },
    modeChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    modeChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    modeText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    segRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    segFrom: { fontSize: 12.5, color: c.textSecondary },
    segYear: { width: 46, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingVertical: 6, fontSize: 13.5, color: c.text, textAlign: 'center' },
    segPay: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13.5, color: c.text, textAlign: 'right' },
    segAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    segAddText: { color: c.blue, fontWeight: '700', fontSize: 13 },
    feeInput: { width: 110, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: c.text, textAlign: 'right' },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 8, lineHeight: 16 },
    yRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
    yHead: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
    yYear: { fontSize: 13, fontWeight: '700', color: c.text },
    yInput: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13.5, color: c.text, textAlign: 'right' },
    simRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginTop: 16 },
    simLabel: { fontSize: 14.5, fontWeight: '700', color: c.text },
    simHint: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    preview: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, gap: 8 },
    previewTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    previewK: { fontSize: 13, color: c.textSecondary, flex: 1 },
    previewV: { fontSize: 14, fontWeight: '700', color: c.text },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
    saveLabel: { color: c.bg, fontSize: 15, fontWeight: '800' },
    calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 18 },
    calCard: { backgroundColor: c.cardSolid ?? c.card, borderRadius: 18, padding: 12 },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 8 },
  });
}
