/**
 * Création d'un crédit (module Crédit, Lot C2 + raffinements).
 * Saisie des paramètres (avec calendrier pour les dates), frais détaillés, et montants ANNUELS
 * (assurance + mensualité qui peuvent évoluer chaque année). Prévisualise l'amortissement.
 */
import { useMemo, useState } from 'react';
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
import { useAddCredit } from '../../../hooks/useCredits';
import { computeAmortization } from '../../../lib/amortization';
import { todayISO, formatDateFrench } from '../../../lib/dateUtils';
import type { CreditType } from '../../../types/database';

const TYPES: { key: CreditType; label: string; icon: string }[] = [
  { key: 'immobilier', label: 'Immobilier', icon: 'home-outline' },
  { key: 'consommation', label: 'Consommation', icon: 'cart-outline' },
  { key: 'auto', label: 'Crédit auto', icon: 'car-outline' },
  { key: 'autre', label: 'Autre', icon: 'ellipsis-horizontal' },
];

const FEES: { key: string; label: string }[] = [
  { key: 'fees_file', label: 'Frais de dossier' },
  { key: 'fees_bank', label: 'Frais de banque' },
  { key: 'fees_notary', label: 'Frais de notaire' },
  { key: 'fees_guarantee', label: 'Frais de garantie' },
  { key: 'personal_contribution', label: 'Apport personnel' },
  { key: 'interim_interest', label: 'Intérêts intercalaires' },
  { key: 'management_fees', label: 'Frais de gestion' },
  { key: 'other_fees', label: 'Autres frais' },
];

export default function CreditAddScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ simulation?: string }>();
  const { user } = useAuth();
  const addCredit = useAddCredit(user?.id);
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
  const [isSimulation, setIsSimulation] = useState(params.simulation === '1');
  const [fees, setFees] = useState<Record<string, string>>({});
  const [showFees, setShowFees] = useState(false);
  const [showYearly, setShowYearly] = useState(false);
  const [insYear, setInsYear] = useState<Record<number, string>>({});
  const [payYear, setPayYear] = useState<Record<number, string>>({});
  const [showCal, setShowCal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const num = (s: string | undefined) => (s ? parseFloat(s.replace(',', '.')) : NaN);
  const numOr0 = (s: string | undefined) => { const v = num(s); return Number.isNaN(v) ? 0 : v; };
  const years = useMemo(() => { const n = parseInt(duration, 10); return n > 0 ? Math.ceil(n / 12) : 0; }, [duration]);

  const amort = useMemo(() => {
    const C = num(principal), n = parseInt(duration, 10), r = num(rate);
    if (!C || !n || Number.isNaN(C) || Number.isNaN(n)) return null;
    return computeAmortization({
      principal: C, rate_annual: Number.isNaN(r) ? 0 : r, duration_months: n,
      start_date: startDate, insurance_monthly: numOr0(insurance),
      insurance_yearly: showYearly && years > 0 ? buildInsArray() : null,
      payment_yearly: showYearly && years > 0 ? buildPayArray() : null,
    });
  }, [principal, duration, rate, insurance, startDate, showYearly, insYear, payYear, years]);

  function buildInsArray(): (number | null)[] {
    return Array.from({ length: years }, (_, y) => { const v = num(insYear[y]); return Number.isNaN(v) ? numOr0(insurance) : v; });
  }
  function buildPayArray(): (number | null)[] {
    return Array.from({ length: years }, (_, y) => { const v = num(payYear[y]); return Number.isNaN(v) || v <= 0 ? null : v; });
  }

  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const stdPayment = amort ? Math.round(amort.monthlyPayment) : 0;

  const save = async () => {
    setError(null);
    const C = num(principal), n = parseInt(duration, 10);
    if (!label.trim()) return setError('Donne un libellé au crédit.');
    if (!C || C <= 0) return setError('Renseigne le capital emprunté.');
    if (!n || n <= 0) return setError('Renseigne la durée (en mois).');
    setSaving(true);
    try {
      await addCredit.mutateAsync({
        type, label: label.trim(), lender: lender.trim() || null, account_id: accountId, project_id: projectId,
        principal: C, duration_months: n, rate_annual: numOr0(rate), rate_type: 'fixe',
        insurance_monthly: numOr0(insurance), start_date: startDate, is_simulation: isSimulation, is_active: true,
        fees_file: numOr0(fees.fees_file), fees_bank: numOr0(fees.fees_bank), fees_notary: numOr0(fees.fees_notary),
        fees_guarantee: numOr0(fees.fees_guarantee), personal_contribution: numOr0(fees.personal_contribution),
        interim_interest: numOr0(fees.interim_interest), management_fees: numOr0(fees.management_fees), other_fees: numOr0(fees.other_fees),
        insurance_yearly: showYearly && years > 0 ? buildInsArray() : null,
        payment_yearly: showYearly && years > 0 ? buildPayArray() : null,
      } as any);
      router.back();
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
        <ScreenHeader title="Nouveau crédit" onBack={() => router.back()} />
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
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

          <Text style={styles.label}>Date de déblocage</Text>
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

          {activeProjects.length > 0 && (
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

          {/* #4 — Frais & apport (repliable) */}
          <TouchableOpacity style={styles.section} onPress={() => setShowFees((v) => !v)} activeOpacity={0.7}>
            <Ionicons name="receipt-outline" size={18} color={COLORS.text} />
            <Text style={styles.sectionTitle}>Frais & apport</Text>
            <Ionicons name={showFees ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {showFees && (
            <View style={{ gap: 8, marginTop: 4 }}>
              {FEES.map((f) => (
                <View key={f.key} style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{f.label}</Text>
                  <TextInput style={styles.feeInput} value={fees[f.key] ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, [f.key]: v }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
                </View>
              ))}
            </View>
          )}

          {/* #5/#6 — Montants par année (assurance + mensualité qui évoluent) */}
          {years > 0 && (
            <>
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

          {amort && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>Estimation</Text>
              <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (hors assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyPayment)}</Text></View>
              <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (1ʳᵉ année, avec assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyWithInsurance)}</Text></View>
              <View style={styles.previewRow}><Text style={styles.previewK}>Coût total du crédit</Text><Text style={[styles.previewV, { color: COLORS.danger }]}>{fmt(amort.totalCost)}</Text></View>
            </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.saveLabel}>Enregistrer le crédit</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* Calendrier (date de déblocage) */}
      <Modal visible={showCal} transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
        <View style={styles.calOverlay}>
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <TouchableOpacity onPress={() => setShowCal(false)}><Text style={{ color: COLORS.emerald, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
              <Text style={{ fontWeight: '700', color: COLORS.text }}>Date de déblocage</Text>
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
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1 },
    scroll: { flex: 1, paddingHorizontal: 16 },
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
