import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './contexts/AuthContext';
import { useAccounts } from './hooks/useAccounts';
import { useProfile, useUpdateProfile } from './hooks/useProfile';
import type { FinancialProfile } from './types/database';

const PROFILE_LABELS: Record<FinancialProfile, string> = {
  economiser: 'Économiser',
  suivi: 'Suivi',
  optimiser: 'Optimiser',
  investir: 'Investir',
};

const PROFILE_SUMMARY: Record<FinancialProfile, string> = {
  economiser: 'Renforcez vos réserves, réduisez les dépenses et privilégiez la sécurité.',
  suivi: 'Suivez votre trésorerie en gardant un équilibre entre épargne, dépenses et projet.',
  optimiser: 'Priorité aux projets et investissements tout en gardant un matelas de sécurité.',
  investir: 'Accélérez vos placements après avoir sécurisé votre trésorerie de base.',
};

const DEFAULT_ALLOCATIONS: Record<FinancialProfile, { save: number; invest: number; enjoy: number; keep: number }> = {
  economiser: { save: 55, invest: 5, enjoy: 15, keep: 25 },
  suivi: { save: 30, invest: 15, enjoy: 25, keep: 30 },
  optimiser: { save: 25, invest: 30, enjoy: 25, keep: 20 },
  investir: { save: 15, invest: 45, enjoy: 20, keep: 20 },
};

const STEP_TITLES = ['Comptes & soldes', 'Votre profil', 'Votre allocation', 'Résumé'];

export default function SetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const accountsQuery = useAccounts(user?.id);
  const { data: accounts = [], isLoading: accountsLoading } = accountsQuery;
  const updateProfile = useUpdateProfile(user?.id);
  const [step, setStep] = useState(1);
  const [selectedStrategy, setSelectedStrategy] = useState<FinancialProfile>(profile?.financial_profile ?? 'suivi');
  const [marginInput, setMarginInput] = useState<string>(String(profile?.safety_margin_percent ?? 10));
  const [savePct, setSavePct] = useState<string>(String(profile?.allocation_save_percent ?? DEFAULT_ALLOCATIONS[selectedStrategy].save));
  const [investPct, setInvestPct] = useState<string>(String(profile?.allocation_invest_percent ?? DEFAULT_ALLOCATIONS[selectedStrategy].invest));
  const [enjoyPct, setEnjoyPct] = useState<string>(String(profile?.allocation_enjoy_percent ?? DEFAULT_ALLOCATIONS[selectedStrategy].enjoy));
  const [keepPct, setKeepPct] = useState<string>(String(profile?.allocation_keep_percent ?? DEFAULT_ALLOCATIONS[selectedStrategy].keep));
  const [loading, setLoading] = useState(false);

  const totalAccounts = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);
  const hasChecking = accounts.some((acc) => acc.type === 'checking');
  const hasSaving = accounts.some((acc) => acc.type === 'savings');

  const allocations = useMemo(() => ({
    save: Number(savePct) || 0,
    invest: Number(investPct) || 0,
    enjoy: Number(enjoyPct) || 0,
    keep: Number(keepPct) || 0,
  }), [savePct, investPct, enjoyPct, keepPct]);

  const totalAllocation = allocations.save + allocations.invest + allocations.enjoy + allocations.keep;

  function applyStrategy(strategy: FinancialProfile) {
    setSelectedStrategy(strategy);
    const preset = DEFAULT_ALLOCATIONS[strategy];
    setSavePct(String(preset.save));
    setInvestPct(String(preset.invest));
    setEnjoyPct(String(preset.enjoy));
    setKeepPct(String(preset.keep));
  }

  async function handleNext() {
    if (step === 2 && !selectedStrategy) {
      Alert.alert('Choix requis', 'Choisissez un profil pour continuer.');
      return;
    }
    if (step === 3 && totalAllocation !== 100) {
      Alert.alert('Allocation', 'Le total des pourcentages doit être égal à 100 %.');
      return;
    }
    setStep((prev) => Math.min(4, prev + 1));
  }

  async function handleFinish() {
    if (!user?.id) return;
    if (totalAllocation !== 100) {
      Alert.alert('Allocation', 'Le total des pourcentages doit être égal à 100 %.');
      return;
    }
    const margin = Math.max(0, Math.min(50, Number(marginInput) || 10));
    setLoading(true);
    try {
      await updateProfile.mutateAsync({
        financial_profile: selectedStrategy,
        safety_margin_percent: margin,
        allocation_save_percent: allocations.save,
        allocation_invest_percent: allocations.invest,
        allocation_enjoy_percent: allocations.enjoy,
        allocation_keep_percent: allocations.keep,
        initial_onboarding_completed: true,
      });
      router.replace('/(tabs)/home');
    } catch (error: unknown) {
      Alert.alert('Erreur', error instanceof Error ? error.message : 'Impossible de terminer la configuration.');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyText}>Connectez-vous pour configurer votre profil financier.</Text>
      </View>
    );
  }

  if (profileLoading || accountsLoading) {
    return (
      <View style={styles.emptyRoot}>
        <ActivityIndicator size="large" color="#34d399" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Configuration initiale</Text>
            <Text style={styles.subtitle}>4 étapes pour que votre trésorerie soit cohérente et actionable.</Text>
          </View>

          <View style={styles.stepsBar}>
            {STEP_TITLES.map((label, index) => (
              <View key={label} style={[styles.stepItem, step === index + 1 && styles.stepActive]}>
                <Text style={[styles.stepNumber, step === index + 1 && styles.stepNumberActive]}>{index + 1}</Text>
                <Text style={[styles.stepLabel, step === index + 1 && styles.stepLabelActive]} numberOfLines={1}>{label}</Text>
              </View>
            ))}
          </View>

          {step === 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>1. Vos comptes</Text>
              <Text style={styles.cardText}>La base du pilotage, c’est votre solde courant, votre épargne et vos investissements.</Text>
              <View style={styles.accountRow}>
                <View style={styles.accountItem}>
                  <Text style={styles.accountLabel}>Comptes</Text>
                  <Text style={styles.accountValue}>{accounts.length}</Text>
                </View>
                <View style={styles.accountItem}>
                  <Text style={styles.accountLabel}>Total</Text>
                  <Text style={styles.accountValue}>{totalAccounts.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</Text>
                </View>
              </View>
              <Text style={styles.cardText}>Comptes trouvés : {hasChecking ? '✅ courant' : '⚠️ pas de compte courant'} · {hasSaving ? '✅ épargne' : '⚠️ pas de compte épargne'}</Text>
              <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(tabs)/comptes')}>
                <Ionicons name="wallet-outline" size={18} color="#fff" />
                <Text style={styles.actionButtonText}>Vérifier mes comptes</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>2. Choisissez votre profil</Text>
              <Text style={styles.cardText}>Ce profil pilote les recommandations et votre allocation cible.</Text>
              {(['economiser', 'suivi', 'optimiser', 'investir'] as FinancialProfile[]).map((profileKey) => {
                const active = selectedStrategy === profileKey;
                return (
                  <TouchableOpacity
                    key={profileKey}
                    style={[styles.strategyCard, active && styles.strategyCardActive]}
                    onPress={() => applyStrategy(profileKey)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.strategyHeader}>
                      <Text style={[styles.strategyLabel, active && styles.strategyLabelActive]}>{PROFILE_LABELS[profileKey]}</Text>
                      {active ? <Ionicons name="checkmark-circle" size={18} color="#34d399" /> : null}
                    </View>
                    <Text style={styles.strategyText}>{PROFILE_SUMMARY[profileKey]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {step === 3 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3. Ajustez vos pourcentages</Text>
              <Text style={styles.cardText}>Les pourcentages doivent totaliser 100 %.</Text>
              <View style={styles.allocationRow}>
                <Text style={styles.allocationLabel}>Épargner</Text>
                <TextInput
                  style={styles.allocationInput}
                  keyboardType="number-pad"
                  value={savePct}
                  onChangeText={(text) => setSavePct(text.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                />
              </View>
              <View style={styles.allocationRow}>
                <Text style={styles.allocationLabel}>Investir</Text>
                <TextInput
                  style={styles.allocationInput}
                  keyboardType="number-pad"
                  value={investPct}
                  onChangeText={(text) => setInvestPct(text.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                />
              </View>
              <View style={styles.allocationRow}>
                <Text style={styles.allocationLabel}>Se faire plaisir</Text>
                <TextInput
                  style={styles.allocationInput}
                  keyboardType="number-pad"
                  value={enjoyPct}
                  onChangeText={(text) => setEnjoyPct(text.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                />
              </View>
              <View style={styles.allocationRow}>
                <Text style={styles.allocationLabel}>Conserver</Text>
                <TextInput
                  style={styles.allocationInput}
                  keyboardType="number-pad"
                  value={keepPct}
                  onChangeText={(text) => setKeepPct(text.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                />
              </View>
              <Text style={[styles.cardText, totalAllocation !== 100 && styles.allocationWarning]}>
                Total actuel : {totalAllocation} % {totalAllocation !== 100 ? '– ajustez pour atteindre 100 %' : '✅' }
              </Text>
              <View style={styles.marginInputRow}>
                <Text style={styles.allocationLabel}>Marge de sécurité</Text>
                <View style={styles.marginControl}>
                  <TextInput
                    style={styles.marginInput}
                    keyboardType="number-pad"
                    value={marginInput}
                    onChangeText={(text) => setMarginInput(text.replace(/[^0-9]/g, ''))}
                    maxLength={2}
                  />
                  <Text style={styles.marginSuffix}>%</Text>
                </View>
              </View>
            </View>
          )}

          {step === 4 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>4. Résumé</Text>
              <Text style={styles.cardText}>Votre profil et vos allocations vont être utilisés pour générer des recommandations personnalisées.</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Profil</Text>
                <Text style={styles.summaryValue}>{PROFILE_LABELS[selectedStrategy]}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Sécurité</Text>
                <Text style={styles.summaryValue}>{Math.max(0, Math.min(50, Number(marginInput) || 10))}%</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Épargner</Text>
                <Text style={styles.summaryValue}>{allocations.save}%</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Investir</Text>
                <Text style={styles.summaryValue}>{allocations.invest}%</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Loisirs</Text>
                <Text style={styles.summaryValue}>{allocations.enjoy}%</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Réserve</Text>
                <Text style={styles.summaryValue}>{allocations.keep}%</Text>
              </View>
              <Text style={styles.cardText}>Vous pouvez revenir modifier ces choix depuis les paramètres ou le tableau de bord plus tard.</Text>
            </View>
          )}

          <View style={styles.footer}> 
            <TouchableOpacity
              style={[styles.footerButton, step === 1 && styles.footerButtonSecondary]}
              onPress={() => setStep((prev) => Math.max(1, prev - 1))}
              disabled={step === 1}
            >
              <Text style={[styles.footerText, step === 1 && styles.footerTextDisabled]}>Précédent</Text>
            </TouchableOpacity>
            {step < 4 ? (
              <TouchableOpacity style={styles.footerButton} onPress={handleNext}>
                <Text style={styles.footerText}>Suivant</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.footerButton} onPress={handleFinish} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerText}>Terminer</Text>}
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617' },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  scroll: { flex: 1 },
  content: { paddingBottom: 80, gap: 18 },
  header: { gap: 10, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#ffffff' },
  subtitle: { fontSize: 14, color: '#94a3b8' },
  stepsBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  stepItem: { flex: 1, minWidth: 70, backgroundColor: '#0f172a', borderRadius: 14, padding: 10, alignItems: 'center' },
  stepActive: { backgroundColor: '#1f2937' },
  stepNumber: { color: '#64748b', fontWeight: '700' },
  stepNumberActive: { color: '#34d399' },
  stepLabel: { color: '#94a3b8', fontSize: 11, marginTop: 4, textAlign: 'center' },
  stepLabelActive: { color: '#fff' },
  card: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b', borderRadius: 20, padding: 18, gap: 14 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  cardText: { color: '#cbd5e1', lineHeight: 20 },
  accountRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  accountItem: { flex: 1, backgroundColor: '#111827', borderRadius: 16, padding: 14 },
  accountLabel: { color: '#94a3b8', marginBottom: 6, fontSize: 12 },
  accountValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  actionButton: { marginTop: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: '#34d399', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  actionButtonText: { color: '#020617', fontWeight: '700' },
  strategyCard: { backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155', borderRadius: 18, padding: 14, gap: 10 },
  strategyCardActive: { borderColor: '#34d399', backgroundColor: '#112f1c' },
  strategyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  strategyLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  strategyLabelActive: { color: '#34d399' },
  strategyText: { color: '#cbd5e1', lineHeight: 20 },
  allocationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  allocationLabel: { color: '#fff', fontSize: 15 },
  allocationInput: { width: 72, backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155', borderRadius: 12, color: '#fff', paddingHorizontal: 12, paddingVertical: 10, textAlign: 'center' },
  allocationWarning: { color: '#fb7185' },
  marginInputRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  marginControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marginInput: { width: 72, backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155', borderRadius: 12, color: '#fff', paddingHorizontal: 12, paddingVertical: 10, textAlign: 'center' },
  marginSuffix: { color: '#94a3b8' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  summaryLabel: { color: '#94a3b8' },
  summaryValue: { color: '#fff', fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  footerButton: { flex: 1, backgroundColor: '#34d399', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  footerButtonSecondary: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  footerText: { color: '#020617', fontWeight: '700' },
  footerTextDisabled: { color: '#475569' },
  emptyRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020617' },
  emptyText: { color: '#fff', fontSize: 16, textAlign: 'center', marginHorizontal: 24 },
});
